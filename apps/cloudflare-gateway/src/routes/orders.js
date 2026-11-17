// apps/cloudflare-gateway/src/routes/orders.js
// Customer order API. Identity comes only from the verified JWT (lib/auth.js).

import { requireAuth, requireCustomer, authenticate } from '../lib/auth.js';
import { json, readJson, bad, conflict, forbidden, notFound, str, safeUrl, idempotencyKey } from '../lib/http.js';
import { newId, sqlNow } from '../lib/ids.js';
import { REASON_CODES, faultOf, partnerReturnFees, returnFeeFor, isFullReturn } from '../services/claims.js';
import {
  createOrder, cancelOrder, cancelSubOrder, confirmPurchase, loadOrderBundle, autoConfirmDelivered, expireStaleOrders
} from '../services/orders.js';

export const RETURN_WINDOW_DAYS_DEFAULT = 7;
// 5-5 (decision-15): the lowest-price compensation scheme is retired. New
// PRICE_ADJUSTMENT/PRICE_MATCH claims are rejected below; rows stored before
// the closure stay readable/settleable via the admin claims endpoints.

// A claim blocks new claims until it is finished; an exchange is finished once the replacement has shipped.
export const OPEN_CLAIM_SQL = "SELECT COUNT(*) c FROM returns WHERE sub_order_id = ? AND (status = 'REQUESTED' OR (status = 'APPROVED' AND COALESCE(exchange_status, '') != 'RESHIPPED'))";

function presentOrder(b) {
  const { order, subs, items } = b;
  // Wave E: the fraud verdict travels with the order, but rule detail never leaks to buyers.
  const { fds_rules_json: _fdsRules, ...orderOut } = order;
  const subsOut = subs.map((s) => ({
    id: s.id, sub_order_no: s.sub_order_no, partner_id: s.partner_id, business_name: s.business_name, sales_model: s.sales_model,
    status: s.status, goods_amount: s.goods_amount, shipping_fee: s.shipping_fee, total_amount: s.total_amount,
    coupon_discount_allocated: s.coupon_discount_allocated, carrier_code: s.carrier_code, tracking_number: s.tracking_number,
    shipped_at: s.shipped_at, delivered_at: s.delivered_at, purchase_confirmed_at: s.purchase_confirmed_at,
    estimated_delivery_date: s.estimated_delivery_date, is_late_compensated: s.is_late_compensated,
    // Shown before a return is requested (단순변심 반품 시 차감되는 편도 배송비)
    return_shipping_fee: s.partner_return_fee ?? s.partner_base_fee ?? null,
    outbound_shipping_fee_basis: s.partner_base_fee ?? null, // added to the fee when a free-shipping order is fully returned for a customer reason
    items: items.filter((i) => i.sub_order_id === s.id)
  }));
  return {
    ...orderOut,
    checkout_idempotency_key: undefined,
    sub_orders: subsOut,
    items: subsOut.flatMap((s) => s.items.map((i) => ({ ...i, status: s.status, partner_name: s.business_name, partner_id: s.partner_id, carrier: s.carrier_code, tracking_number: s.tracking_number })))
  };
}

async function ownedBundle(request, env, ordId) {
  const me = await requireAuth(request, env);
  const b = await loadOrderBundle(env, ordId);
  if (!b) throw notFound('주문을 찾을 수 없습니다.');
  if (me.role !== 'ROLE_ADMIN' && b.order.customer_id !== me.userId) throw forbidden('본인 주문만 조회할 수 있습니다.');
  return { me, b };
}

export async function handleOrderRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;
  if (!p.startsWith('/api/v1/orders')) return null;

  // Scheduler hooks (admin-triggered; the Worker cron calls the services directly)
  if (p === '/api/v1/orders/cron/auto-confirm' && request.method === 'POST') {
    await requireAuth(request, env, ['ROLE_ADMIN']);
    return json(corsHeaders, { success: true, confirmed_count: await autoConfirmDelivered(env) });
  }
  if (p === '/api/v1/orders/cron/expire' && request.method === 'POST') {
    await requireAuth(request, env, ['ROLE_ADMIN']);
    return json(corsHeaders, { success: true, expired_count: await expireStaleOrders(env) });
  }

  // 0. Quote: exact server-side totals for the checkout screen (no writes)
  if (p === '/api/v1/orders/quote' && request.method === 'POST') {
    const me = await requireCustomer(request, env);
    const r = await createOrder(env, me, await readJson(request), null, { dryRun: true });
    return json(corsHeaders, { success: true, data: r.quote });
  }

  // 1. Checkout -> READY order (stock/coupon/credit reserved for 30 minutes)
  if ((p === '/api/v1/orders/checkout' || p === '/api/v1/orders') && request.method === 'POST') {
    const me = await requireCustomer(request, env);
    const body = await readJson(request);
    const r = await createOrder(env, me, body, request.headers.get('X-Idempotency-Key'), {
      ip: request.headers.get('CF-Connecting-IP') || null, ipCountry: request.headers.get('CF-IPCountry') || null
    });
    const o = r.order;
    const data = {
      order_id: o.id, order_no: o.order_no, payment_status: o.payment_status, status: o.payment_status,
      total_goods_amount: o.total_goods_amount, total_shipping_amount: o.total_shipping_amount,
      volume_discount_amount: o.volume_discount_amount, coupon_discount_amount: o.coupon_discount_amount,
      platform_discount_amount: r.platformDiscount ?? 0, store_discount_amount: r.storeDiscount ?? 0,
      credit_used_amount: o.credit_used_amount, total_discount_amount: o.total_discount_amount,
      total_pay_amount: o.total_pay_amount, payment_expires_at: o.payment_expires_at, currency: 'KRW',
      ...(r.projectedCredit == null ? {} : { projected_credit_amount: r.projectedCredit }),
      requested_delivery_date: o.requested_delivery_date || null,
      sub_orders_created: r.subOrderCount, idempotent_replay: r.replay
    };
    return json(corsHeaders, { success: true, ...data, data }, r.replay ? 200 : 201);
  }

  // 2. List my orders
  if (p === '/api/v1/orders' && request.method === 'GET') {
    const me = await requireAuth(request, env);
    const target = me.role === 'ROLE_ADMIN' && url.searchParams.get('customer_id') ? url.searchParams.get('customer_id') : me.userId;
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get('per_page') || url.searchParams.get('limit') || '30', 10) || 30));
    const total = await env.DB.prepare('SELECT COUNT(*) AS c FROM orders WHERE customer_id = ?').bind(target).first('c') || 0;
    // 3-7: latest orders first; order_no breaks same-second ties deterministically.
    const { results } = await env.DB.prepare('SELECT id FROM orders WHERE customer_id = ? ORDER BY created_at DESC, order_no DESC LIMIT ? OFFSET ?').bind(target, perPage, (page - 1) * perPage).all();
    const data = [];
    for (const r of results) data.push(presentOrder(await loadOrderBundle(env, r.id)));
    return json(corsHeaders, { success: true, count: data.length, pagination: { page, per_page: perPage, total: Number(total) || 0, total_pages: Math.max(1, Math.ceil((Number(total) || 0) / perPage)) }, data });
  }

  const m = p.match(/^\/api\/v1\/orders\/([^/]+)(?:\/(.+))?$/);
  if (!m) return null;
  const ordId = decodeURIComponent(m[1]);
  const action = m[2] || '';

  if (!action && request.method === 'GET') {
    const { b } = await ownedBundle(request, env, ordId);
    const { results: claims } = await env.DB.prepare('SELECT * FROM returns WHERE order_id = ? ORDER BY created_at DESC').bind(b.order.id).all();
    const { results: refunds } = await env.DB.prepare("SELECT id, sub_order_id, reason_code, pg_amount, credit_amount, status, created_at, completed_at FROM refunds WHERE order_id = ? ORDER BY created_at").bind(b.order.id).all();
    // NEW-07: the real PG method of the capturing transaction (powers the cash-receipt hint).
    const pay = await env.DB.prepare("SELECT method, card_summary FROM payment_transactions WHERE order_id = ? AND status = 'DONE' ORDER BY created_at DESC LIMIT 1").bind(b.order.id).first();
    return json(corsHeaders, { success: true, data: { ...presentOrder(b), payment_method: pay ? pay.method : null, payment_card: pay ? pay.card_summary : null, claims, refunds } });
  }

  if (action === 'cancel' && request.method === 'POST') {
    const me = await requireAuth(request, env, ['ROLE_CUSTOMER', 'ROLE_ADMIN']);
    const r = await cancelOrder(env, me, ordId, { isAdmin: me.role === 'ROLE_ADMIN' });
    return json(corsHeaders, { success: true, order_id: ordId, status: r.status, refund: r.refund, warnings: r.warnings || [], message: r.refund ? '주문이 취소되고 결제가 환불되었습니다.' : '결제 전 주문이 취소되었습니다.' });
  }

  const subCancel = action.match(/^sub-orders\/([^/]+)\/cancel$/);
  if (subCancel && request.method === 'POST') {
    const me = await requireAuth(request, env, ['ROLE_CUSTOMER', 'ROLE_ADMIN']);
    const body = await readJson(request).catch(() => ({}));
    const lines = Array.isArray(body.items) ? body.items : null;
    const idem = idempotencyKey(request.headers.get('X-Idempotency-Key'));
    const r = await cancelSubOrder(env, me, ordId, decodeURIComponent(subCancel[1]), { isAdmin: me.role === 'ROLE_ADMIN', lines, idemKey: idem });
    return json(corsHeaders, { success: true, status: r.status, refund: r.refund, partial: Boolean(r.partial), replay: Boolean(r.replay), warnings: r.warnings || [] });
  }

  if (action === 'confirm' && request.method === 'POST') {
    const me = await requireCustomer(request, env);
    const r = await confirmPurchase(env, me, ordId);
    const data = { order_id: ordId, confirmed_sub_orders: r.confirmed, reward_credit: r.reward, status: 'PURCHASE_CONFIRMED' };
    return json(corsHeaders, { success: true, ...data, data, message: r.reward > 0 ? `구매확정 완료 · ${r.reward.toLocaleString()}원 적립` : '구매확정이 완료되었습니다.' });
  }

  if (action === 'tracking' && request.method === 'GET') {
    const { b } = await ownedBundle(request, env, ordId);
    const tracking = [];
    for (const s of b.subs) {
      const { results: logs } = await env.DB.prepare('SELECT stage_code, stage_name, location, description, occurred_at FROM milestone_tracking_logs WHERE sub_order_id = ? ORDER BY occurred_at').bind(s.id).all();
      tracking.push({ sub_order_id: s.id, partner_name: s.business_name, carrier_code: s.carrier_code, tracking_number: s.tracking_number, status: s.status, shipped_at: s.shipped_at, delivered_at: s.delivered_at, events: logs });
    }
    return json(corsHeaders, { success: true, order_id: b.order.id, order_no: b.order.order_no, payment_status: b.order.payment_status, tracking, carrier_api: 'NOT_INTEGRATED' });
  }

  // Development-only carrier simulation (never in production, admin only)
  if (action === 'advance-tracking' && request.method === 'POST') {
    if (env.ENVIRONMENT === 'production') return null;
    await requireAuth(request, env, ['ROLE_ADMIN']);
    const b = await loadOrderBundle(env, ordId);
    if (!b) throw notFound();
    const st = [];
    for (const s of b.subs) {
      if (s.status === 'SHIPPED') st.push(env.DB.prepare("UPDATE sub_orders SET status = 'IN_TRANSIT', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'SHIPPED'").bind(s.id));
      if (s.status === 'IN_TRANSIT') st.push(env.DB.prepare("UPDATE sub_orders SET status = 'DELIVERED', delivered_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'IN_TRANSIT'").bind(s.id));
    }
    if (st.length) await env.DB.batch(st);
    return json(corsHeaders, { success: true, simulated: true, message: '배송 단계 시뮬레이션 (개발 환경 전용)' });
  }

  // Claims: list / request return-exchange (price adjustment retired by 5-5).
  if (action === 'claims') {
    const { me, b } = await ownedBundle(request, env, ordId);
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM returns WHERE order_id = ? ORDER BY created_at DESC').bind(b.order.id).all();
      return json(corsHeaders, { success: true, count: results.length, data: results });
    }
    if (request.method !== 'POST') return null;
    if (me.role !== 'ROLE_CUSTOMER') throw forbidden();
    const body = await readJson(request);
    const type = String(body.claim_type || body.type || 'RETURN').toUpperCase();
    if (!['RETURN', 'EXCHANGE'].includes(type)) throw bad('INVALID_CLAIM_TYPE', '클레임 유형이 올바르지 않습니다.');
    const reason = str(body.reason, { field: '사유', max: 500 }) || '고객 요청';
    const claimId = newId('clm');

    // RETURN / EXCHANGE: request only; money moves when the seller or operator approves
    const sub = b.subs.find((s) => s.id === body.sub_order_id) || (b.subs.length === 1 ? b.subs[0] : null);
    if (!sub) throw bad('SUB_ORDER_REQUIRED', '반품/교환할 판매자 주문(sub_order_id)을 지정해 주세요.');
    if (sub.status !== 'DELIVERED') throw conflict('NOT_RETURNABLE', '배송 완료 후 구매확정 전 상품만 반품/교환을 신청할 수 있습니다.');
    const windowDays = parseInt(env.RETURN_WINDOW_DAYS || RETURN_WINDOW_DAYS_DEFAULT, 10);
    if (sub.delivered_at && sub.delivered_at < sqlNow(-windowDays * 86400000)) throw conflict('WINDOW_EXPIRED', `수령 후 ${windowDays}일이 지나 신청할 수 없습니다.`);
    const subItems = b.items.filter((i) => i.sub_order_id === sub.id);
    const lines = Array.isArray(body.items) && body.items.length
      ? body.items.map((l) => ({ order_item_id: String(l.order_item_id), quantity: Number(l.quantity) }))
      : subItems.filter((i) => i.quantity > i.refunded_quantity).map((i) => ({ order_item_id: i.id, quantity: i.quantity - i.refunded_quantity }));
    let estimate = 0;
    for (const l of lines) {
      const it = subItems.find((i) => i.id === l.order_item_id);
      if (!it || !Number.isSafeInteger(l.quantity) || l.quantity < 1 || l.quantity > it.quantity - it.refunded_quantity) throw bad('INVALID_ITEMS', '반품 수량이 올바르지 않습니다.');
      estimate += Math.floor(((it.pg_alloc + it.credit_alloc) * l.quantity) / it.quantity);
    }
    const open = await env.DB.prepare(OPEN_CLAIM_SQL).bind(sub.id).first('c');
    if (open > 0) throw conflict('CLAIM_ALREADY_OPEN', '이미 처리 중인 반품/교환 신청이 있습니다.');
    // O14: the reason decides who pays the return courier; legacy clients without a code leave it to the seller.
    const reasonCode = body.reason_code ? String(body.reason_code).toUpperCase() : null;
    if (reasonCode && !REASON_CODES.includes(reasonCode)) throw bad('INVALID_REASON_CODE', `reason_code 는 ${REASON_CODES.join(', ')} 중 하나여야 합니다.`);
    const fault = faultOf(reasonCode);
    let exchangeItems = null;
    if (type === 'EXCHANGE') {
      exchangeItems = [];
      for (const l of lines) {
        const it = subItems.find((i) => i.id === l.order_item_id);
        const wanted = (Array.isArray(body.items) ? body.items.find((x) => String(x.order_item_id) === it.id) : null)?.exchange_sku_id;
        const toSku = String(wanted || it.sku_id);
        if (toSku !== it.sku_id) {
          const [from, to] = await Promise.all([
            env.DB.prepare('SELECT product_id, sale_price FROM product_skus WHERE id = ?').bind(it.sku_id).first(),
            env.DB.prepare('SELECT product_id, sale_price, stock_quantity FROM product_skus WHERE id = ?').bind(toSku).first()
          ]);
          if (!to || !from || to.product_id !== from.product_id) throw bad('EXCHANGE_OTHER_PRODUCT', '같은 상품의 다른 옵션으로만 교환할 수 있습니다. 다른 상품은 반품 후 새로 주문해 주세요.');
          if (to.sale_price !== from.sale_price) throw conflict('EXCHANGE_PRICE_DIFFERS', '가격이 다른 옵션으로는 교환할 수 없습니다. 반품 후 새로 주문해 주세요.');
          if (to.stock_quantity < l.quantity) throw conflict('EXCHANGE_OUT_OF_STOCK', '교환할 옵션의 재고가 부족합니다.');
        }
        exchangeItems.push({ order_item_id: it.id, quantity: l.quantity, from_sku_id: it.sku_id, to_sku_id: toSku });
      }
    }
    const fees = await partnerReturnFees(env, sub.partner_id);
    const feeEstimate = type === 'RETURN' ? Math.min(estimate, returnFeeFor({ fault, returnless: false, fullReturn: isFullReturn(subItems, lines), subShippingFee: sub.shipping_fee, fees })) : 0;
    // 2-9: pickup address + photo evidence ride on the claim row (d1_61).
    const pickupAddress = str(body.pickup_address, { field: '수거지', max: 500 }) || null;
    // 3-8: requested collection day within the 3-day window (d1_64).
    let pickupDate = null;
    if (body.pickup_date !== undefined && body.pickup_date !== null && String(body.pickup_date).trim() !== '') {
      pickupDate = String(body.pickup_date).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) throw bad('INVALID_PICKUP_DATE', '수거 희망일은 YYYY-MM-DD 형식이어야 합니다.');
      const todayIso = new Date().toISOString().slice(0, 10);
      const topIso = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      if (pickupDate <= todayIso || pickupDate > topIso) throw bad('INVALID_PICKUP_DATE', '수거 희망일은 내일부터 3일 이내여야 합니다.');
    }
    let claimPhotos = [];
    if (body.photos !== undefined && body.photos !== null) {
      if (!Array.isArray(body.photos)) throw bad('INVALID_PHOTOS', 'photos는 이미지 주소 배열이어야 합니다.');
      if (body.photos.length > 10) throw bad('TOO_MANY_PHOTOS', '클레임 사진은 최대 10장까지 첨부할 수 있습니다.');
      try {
        claimPhotos = body.photos.map((u) => safeUrl(u, { field: '클레임 사진', allowRelative: true, required: true }));
      } catch {
        throw bad('INVALID_PHOTOS', '클레임 사진은 https 또는 사이트 상대경로(URL 2000자 이내)만 첨부할 수 있습니다.');
      }
    }
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO returns (id, order_id, sub_order_id, user_id, claim_type, reason, reason_code, fault, items_json, exchange_items_json, status, refund_amount, notes, pickup_address, pickup_date, photo_urls_json)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?, ?, ?, ?)`).bind(claimId, b.order.id, sub.id, me.userId, type, reason, reasonCode, fault, JSON.stringify(lines),
        exchangeItems ? JSON.stringify(exchangeItems) : null, type === 'RETURN' ? estimate - feeEstimate : 0, str(body.notes, { max: 500 }) || null,
        pickupAddress, pickupDate, claimPhotos.length ? JSON.stringify(claimPhotos) : null),
      env.DB.prepare("UPDATE sub_orders SET status = 'RETURN_REQUESTED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'DELIVERED'").bind(sub.id)
    ]);
    const data = {
      claim_id: claimId, claim_type: type, status: 'REQUESTED', reason_code: reasonCode, fault,
      estimated_refund_amount: type === 'RETURN' ? estimate - feeEstimate : 0, estimated_return_fee: feeEstimate,
      exchange_items: exchangeItems,
      ...(type === 'EXCHANGE' && fault === 'CUSTOMER' ? { customer_shipping_note: `단순변심 교환은 왕복 배송비 ${(fees.oneWay * 2).toLocaleString('ko-KR')}원을 판매자 안내에 따라 별도로 부담합니다.` } : {})
    };
    return json(corsHeaders, { success: true, ...data, data, message: '반품/교환 신청이 접수되었습니다. 판매자 확인 후 처리됩니다.' }, 201);
  }

  // 3-8: buyer claim withdrawal while the claim is still REQUESTED.
  const claimCancelM = p.match(/^\/api\/v1\/orders\/([^/]+)\/claims\/([^/]+)$/);
  if (claimCancelM && request.method === 'DELETE') {
    const me = await requireAuth(request, env, ['ROLE_CUSTOMER', 'ROLE_ADMIN']);
    const { b } = await ownedBundle(request, env, claimCancelM[1]);
    const claim = await env.DB.prepare('SELECT * FROM returns WHERE id = ? AND order_id = ?').bind(claimCancelM[2], b.order.id).first();
    if (!claim || (me.role !== 'ROLE_ADMIN' && claim.user_id !== me.userId)) throw notFound('클레임을 찾을 수 없습니다.');
    if (claim.status !== 'REQUESTED') throw conflict('CLAIM_NOT_OPEN', '접수 상태의 신청만 취소할 수 있습니다.');
    await env.DB.batch([
      env.DB.prepare("UPDATE returns SET status = 'CANCELLED' WHERE id = ?").bind(claim.id),
      env.DB.prepare("UPDATE sub_orders SET status = 'DELIVERED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'RETURN_REQUESTED'").bind(claim.sub_order_id)
    ]);
    return json(corsHeaders, { success: true, claim_id: claim.id, status: 'CANCELLED' });
  }

  return null;
}

export { authenticate };
