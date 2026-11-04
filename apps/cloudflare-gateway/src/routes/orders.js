// apps/cloudflare-gateway/src/routes/orders.js
// Customer order API. Identity comes only from the verified JWT (lib/auth.js).

import { requireAuth, requireCustomer, authenticate } from '../lib/auth.js';
import { json, readJson, bad, conflict, forbidden, notFound, str } from '../lib/http.js';
import { newId, sqlNow } from '../lib/ids.js';
import { grantCreditStatements } from '../lib/ledger.js';
import {
  createOrder, cancelOrder, cancelSubOrder, confirmPurchase, loadOrderBundle, mapDbError, autoConfirmDelivered, expireStaleOrders
} from '../services/orders.js';

export const RETURN_WINDOW_DAYS_DEFAULT = 7;
const PRICE_ADJUST_WINDOW_DAYS = 30;

function presentOrder(b) {
  const { order, subs, items } = b;
  const subsOut = subs.map((s) => ({
    id: s.id, sub_order_no: s.sub_order_no, partner_id: s.partner_id, business_name: s.business_name, sales_model: s.sales_model,
    status: s.status, goods_amount: s.goods_amount, shipping_fee: s.shipping_fee, total_amount: s.total_amount,
    coupon_discount_allocated: s.coupon_discount_allocated, carrier_code: s.carrier_code, tracking_number: s.tracking_number,
    shipped_at: s.shipped_at, delivered_at: s.delivered_at, purchase_confirmed_at: s.purchase_confirmed_at,
    estimated_delivery_date: s.estimated_delivery_date, is_late_compensated: s.is_late_compensated,
    items: items.filter((i) => i.sub_order_id === s.id)
  }));
  return {
    ...order,
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
    const r = await createOrder(env, me, body, request.headers.get('X-Idempotency-Key'));
    const o = r.order;
    const data = {
      order_id: o.id, order_no: o.order_no, payment_status: o.payment_status, status: o.payment_status,
      total_goods_amount: o.total_goods_amount, total_shipping_amount: o.total_shipping_amount,
      volume_discount_amount: o.volume_discount_amount, coupon_discount_amount: o.coupon_discount_amount,
      credit_used_amount: o.credit_used_amount, total_discount_amount: o.total_discount_amount,
      total_pay_amount: o.total_pay_amount, payment_expires_at: o.payment_expires_at, currency: 'KRW',
      sub_orders_created: r.subOrderCount, idempotent_replay: r.replay
    };
    return json(corsHeaders, { success: true, ...data, data }, r.replay ? 200 : 201);
  }

  // 2. List my orders
  if (p === '/api/v1/orders' && request.method === 'GET') {
    const me = await requireAuth(request, env);
    const target = me.role === 'ROLE_ADMIN' && url.searchParams.get('customer_id') ? url.searchParams.get('customer_id') : me.userId;
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '30', 10) || 30));
    const { results } = await env.DB.prepare('SELECT id FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?').bind(target, limit).all();
    const data = [];
    for (const r of results) data.push(presentOrder(await loadOrderBundle(env, r.id)));
    return json(corsHeaders, { success: true, count: data.length, data });
  }

  const m = p.match(/^\/api\/v1\/orders\/([^/]+)(?:\/(.+))?$/);
  if (!m) return null;
  const ordId = decodeURIComponent(m[1]);
  const action = m[2] || '';

  if (!action && request.method === 'GET') {
    const { b } = await ownedBundle(request, env, ordId);
    const { results: claims } = await env.DB.prepare('SELECT * FROM returns WHERE order_id = ? ORDER BY created_at DESC').bind(b.order.id).all();
    const { results: refunds } = await env.DB.prepare("SELECT id, sub_order_id, reason_code, pg_amount, credit_amount, status, created_at, completed_at FROM refunds WHERE order_id = ? ORDER BY created_at").bind(b.order.id).all();
    return json(corsHeaders, { success: true, data: { ...presentOrder(b), claims, refunds } });
  }

  if (action === 'cancel' && request.method === 'POST') {
    const me = await requireAuth(request, env, ['ROLE_CUSTOMER', 'ROLE_ADMIN']);
    const r = await cancelOrder(env, me, ordId, { isAdmin: me.role === 'ROLE_ADMIN' });
    return json(corsHeaders, { success: true, order_id: ordId, status: r.status, refund: r.refund, warnings: r.warnings || [], message: r.refund ? '주문이 취소되고 결제가 환불되었습니다.' : '결제 전 주문이 취소되었습니다.' });
  }

  const subCancel = action.match(/^sub-orders\/([^/]+)\/cancel$/);
  if (subCancel && request.method === 'POST') {
    const me = await requireAuth(request, env, ['ROLE_CUSTOMER', 'ROLE_ADMIN']);
    const r = await cancelSubOrder(env, me, ordId, decodeURIComponent(subCancel[1]), { isAdmin: me.role === 'ROLE_ADMIN' });
    return json(corsHeaders, { success: true, status: r.status, refund: r.refund, warnings: r.warnings || [] });
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

  // Claims: list / request return-exchange / price adjustment
  if (action === 'claims') {
    const { me, b } = await ownedBundle(request, env, ordId);
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM returns WHERE order_id = ? ORDER BY created_at DESC').bind(b.order.id).all();
      return json(corsHeaders, { success: true, count: results.length, data: results });
    }
    if (request.method !== 'POST') return null;
    if (me.role !== 'ROLE_CUSTOMER') throw forbidden();
    const body = await readJson(request);
    const rawType = String(body.claim_type || body.type || 'RETURN').toUpperCase();
    const type = rawType === 'PRICE_MATCH' ? 'PRICE_ADJUSTMENT' : rawType;
    if (!['RETURN', 'EXCHANGE', 'PRICE_ADJUSTMENT'].includes(type)) throw bad('INVALID_CLAIM_TYPE', '클레임 유형이 올바르지 않습니다.');
    const reason = str(body.reason, { field: '사유', max: 500 }) || '고객 요청';
    const claimId = newId('clm');

    if (type === 'PRICE_ADJUSTMENT') {
      if (!['PAID', 'PARTIAL_REFUNDED'].includes(b.order.payment_status) || !b.order.paid_at) throw conflict('NOT_ELIGIBLE', '결제 완료된 주문만 신청할 수 있습니다.');
      if (b.order.paid_at < sqlNow(-PRICE_ADJUST_WINDOW_DAYS * 86400000)) throw conflict('WINDOW_EXPIRED', `결제 후 ${PRICE_ADJUST_WINDOW_DAYS}일이 지나 신청할 수 없습니다.`);
      let diff = 0;
      for (const it of b.items) {
        const cur = await env.DB.prepare('SELECT sale_price FROM product_skus WHERE id = ?').bind(it.sku_id).first('sale_price');
        const remaining = it.quantity - it.refunded_quantity;
        const curUnit = cur - Math.floor((cur * it.volume_discount_pct * 100 + 5000) / 10000);
        if (cur !== null && curUnit < it.unit_price && remaining > 0) diff += (it.unit_price - curUnit) * remaining;
      }
      if (diff <= 0) throw conflict('NO_PRICE_DROP', '구매 이후 판매가 인하가 확인되지 않습니다.');
      try {
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO returns (id, order_id, user_id, claim_type, reason, status, refund_amount, notes, processed_by, processed_at)
                          VALUES (?, ?, ?, 'PRICE_ADJUSTMENT', ?, 'REFUNDED', ?, '판매가 인하 차액 적립', 'system', CURRENT_TIMESTAMP)`).bind(claimId, b.order.id, me.userId, reason, diff),
          ...grantCreditStatements(env, { userId: me.userId, amount: diff, reason: '최저가 보상 차액 적립', referenceId: claimId, entityId: b.order.operator_entity_id, txnType: 'PRICE_ADJUSTMENT' })
        ]);
      } catch (e) {
        throw mapDbError(e) ? conflict('ALREADY_ADJUSTED', '이 주문은 이미 최저가 보상을 받았습니다.') : e;
      }
      const data = { claim_id: claimId, claim_type: type, status: 'REFUNDED', refund_amount: diff };
      return json(corsHeaders, { success: true, ...data, data }, 201);
    }

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
    const open = await env.DB.prepare("SELECT COUNT(*) c FROM returns WHERE sub_order_id = ? AND status IN ('REQUESTED','APPROVED')").bind(sub.id).first('c');
    if (open > 0) throw conflict('CLAIM_ALREADY_OPEN', '이미 처리 중인 반품/교환 신청이 있습니다.');
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO returns (id, order_id, sub_order_id, user_id, claim_type, reason, items_json, status, refund_amount, notes)
                      VALUES (?, ?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?)`).bind(claimId, b.order.id, sub.id, me.userId, type, reason, JSON.stringify(lines), type === 'RETURN' ? estimate : 0, str(body.notes, { max: 500 }) || null),
      env.DB.prepare("UPDATE sub_orders SET status = 'RETURN_REQUESTED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'DELIVERED'").bind(sub.id)
    ]);
    const data = { claim_id: claimId, claim_type: type, status: 'REQUESTED', estimated_refund_amount: type === 'RETURN' ? estimate : 0 };
    return json(corsHeaders, { success: true, ...data, data, message: '반품/교환 신청이 접수되었습니다. 판매자 확인 후 환불이 진행됩니다.' }, 201);
  }

  return null;
}

export { authenticate };
