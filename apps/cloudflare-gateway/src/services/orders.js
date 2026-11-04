// apps/cloudflare-gateway/src/services/orders.js
// Order lifecycle engine: checkout (reservation), payment capture, release (cancel/expire), refunds,
// purchase confirmation. Every state change is one atomic D1 batch; DB triggers are the last line of defence.

import { HttpError, bad, conflict, notFound, forbidden, unavailable, str } from '../lib/http.js';
import { newId, newOrderNo, newPoNo, sqlNow } from '../lib/ids.js';
import { allocate, applyBps, proportionalPortion, assertWon } from '../lib/money.js';
import { ACCOUNTS, journalStatements, creditStatement, grantCreditStatements, getActiveOperator } from '../lib/ledger.js';
import { pgConfirm, pgCancel } from '../lib/pg.js';

export const PAYMENT_WINDOW_MS = 30 * 60 * 1000;
const MAX_LINES = 50;
const MAX_QTY = 999;
const PRE_SHIPMENT = ['PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'PREPARING'];

/** Map DB trigger / constraint failures to business errors. */
export function mapDbError(e) {
  const msg = String(e && e.message || '');
  if (msg.includes('STOCK_INSUFFICIENT')) return conflict('STOCK_INSUFFICIENT', '재고가 부족하여 주문할 수 없습니다.');
  if (msg.includes('CREDIT_INSUFFICIENT')) return conflict('CREDIT_INSUFFICIENT', '적립금 잔액이 부족합니다.');
  if (msg.includes('COUPON_ALREADY_USED')) return conflict('COUPON_ALREADY_USED', '이미 사용된 쿠폰입니다.');
  if (msg.includes('ILLEGAL_PAYMENT_TRANSITION')) return conflict('ORDER_STATE_CHANGED', '주문 상태가 변경되어 처리할 수 없습니다.');
  if (msg.includes('REFUND_EXCEEDS_PAID')) return conflict('REFUND_EXCEEDS_PAID', '환불 가능 금액/수량을 초과했습니다.');
  if (msg.includes('SHIPPING_ALREADY_REFUNDED')) return conflict('SHIPPING_ALREADY_REFUNDED', '배송비가 이미 환불되었습니다.');
  if (msg.includes('IMMUTABLE_LEDGER')) return conflict('IMMUTABLE_LEDGER', '원장 기록은 수정할 수 없습니다.');
  if (msg.includes('BATCH_ASSERTION_FAILED')) return conflict('CONCURRENT_MODIFICATION', '처리 중 데이터가 변경되었습니다. 다시 시도해 주세요.');
  if (msg.includes('UNIQUE constraint failed')) return conflict('DUPLICATE_REQUEST', '이미 처리된 요청입니다.');
  return null;
}

export async function runBatch(env, statements) {
  try {
    return await env.DB.batch(statements);
  } catch (e) {
    const mapped = mapDbError(e);
    if (mapped) { mapped.cause = e; throw mapped; }
    throw e;
  }
}

export async function loadOrderBundle(env, orderIdOrNo) {
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ? OR order_no = ?').bind(orderIdOrNo, orderIdOrNo).first();
  if (!order) return null;
  const { results: subs } = await env.DB.prepare(
    `SELECT s.*, st.id AS settlement_id, st.gross_amount AS st_gross, st.commission_amount AS st_commission,
            st.commission_rate_bps AS st_bps, st.shipping_fee AS st_shipping, st.net_payout_amount AS st_net, st.status AS st_status,
            pt.business_name
     FROM sub_orders s
     LEFT JOIN settlements st ON st.sub_order_id = s.id
     LEFT JOIN partners pt ON pt.id = s.partner_id
     WHERE s.parent_order_id = ? ORDER BY s.sub_order_no`
  ).bind(order.id).all();
  const { results: items } = await env.DB.prepare(
    `SELECT i.* FROM order_items i JOIN sub_orders s ON s.id = i.sub_order_id WHERE s.parent_order_id = ? ORDER BY i.id`
  ).bind(order.id).all();
  return { order, subs, items };
}

// ---------------------------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------------------------
function parseLines(items) {
  if (!Array.isArray(items) || items.length === 0) throw bad('CART_EMPTY', '주문할 상품이 없습니다.');
  if (items.length > MAX_LINES) throw bad('TOO_MANY_LINES', `한 번에 최대 ${MAX_LINES}개 품목까지 주문할 수 있습니다.`);
  const merged = new Map();
  for (const it of items) {
    const skuId = typeof it?.sku_id === 'string' ? it.sku_id.trim() : '';
    if (!skuId) throw bad('SKU_REQUIRED', '상품 옵션(sku_id)이 지정되지 않았습니다.');
    const q = Number(it.quantity);
    if (!Number.isSafeInteger(q) || q < 1 || q > MAX_QTY) throw bad('INVALID_QUANTITY', '주문 수량이 올바르지 않습니다.');
    merged.set(skuId, { skuId, productId: it.product_id || null, quantity: (merged.get(skuId)?.quantity || 0) + q });
  }
  for (const l of merged.values()) if (l.quantity > MAX_QTY) throw bad('INVALID_QUANTITY', '주문 수량이 올바르지 않습니다.');
  return [...merged.values()];
}

function volumeDiscountPct(qty) {
  return qty >= 10 ? 15 : (qty >= 5 ? 10 : (qty >= 3 ? 5 : 0));
}

function parseAddress(body) {
  const a = body.shipping_address || {};
  const recipient = str(body.recipient_name || a.recipient || a.name, { field: '수령인', max: 50, required: true });
  const phone = str(body.recipient_phone || a.phone, { field: '연락처', max: 20, required: true });
  if (!/^[0-9+\-\s()]{9,20}$/.test(phone)) throw bad('INVALID_PHONE', '연락처 형식이 올바르지 않습니다.');
  const line1 = str(body.shipping_address_line1 || a.address || a.line1, { field: '주소', max: 200, required: true });
  const line2 = str(body.shipping_address_line2 || a.detail || a.line2, { field: '상세주소', max: 200 });
  const postal = str(body.shipping_postal_code || a.zip || a.postal_code, { field: '우편번호', max: 10, required: true });
  if (!/^\d{5}$/.test(postal)) throw bad('INVALID_POSTAL_CODE', '우편번호는 5자리 숫자여야 합니다.');
  const memo = str(body.shipping_memo || a.memo, { field: '배송메모', max: 200 });
  return { recipient, phone, line1, line2, postal, memo };
}

export async function createOrder(env, principal, body, idemHeader, { dryRun = false } = {}) {
  const idemKey = idemHeader || body.idempotency_key || null;
  if (idemKey !== null && !/^[A-Za-z0-9_.:-]{8,100}$/.test(String(idemKey))) throw bad('INVALID_IDEMPOTENCY_KEY', 'X-Idempotency-Key 형식이 올바르지 않습니다.');
  if (idemKey && !dryRun) {
    const prev = await env.DB.prepare('SELECT * FROM orders WHERE customer_id = ? AND checkout_idempotency_key = ?').bind(principal.userId, idemKey).first();
    if (prev) return { replay: true, order: prev };
  }

  const lines = parseLines(body.items);
  const addr = dryRun ? null : parseAddress(body);
  const rawPccc = body.pccc ? String(body.pccc).trim().toUpperCase() : null;
  if (rawPccc && !/^P\d{12}$/.test(rawPccc)) throw bad('INVALID_PCCC', "개인통관고유부호 형식이 올바르지 않습니다. 'P'로 시작하는 13자리 번호여야 합니다.");

  const operator = await getActiveOperator(env);
  if (!operator) throw unavailable('OPERATOR_NOT_CONFIGURED', '운영 사업자 정보가 등록·활성화되지 않아 주문을 받을 수 없습니다.');

  // 1. Resolve SKUs with server-side price authority
  const resolved = [];
  for (const l of lines) {
    const s = await env.DB.prepare(
      `SELECT s.id, s.product_id, s.sku_code, s.option_combination_json, s.sale_price, s.stock_quantity,
              p.partner_id, p.title AS prod_title, p.status AS prod_status, p.review_status,
              pt.status AS partner_status, pt.sales_model, pt.base_shipping_fee, pt.free_shipping_threshold,
              pt.commission_rate_bps, pt.commission_rate,
              m.unit_cost, m.supplier_id, m.resale_authorized, m.valid_until, sup.status AS supplier_status
       FROM product_skus s
       JOIN products p ON p.id = s.product_id
       JOIN partners pt ON pt.id = p.partner_id
       LEFT JOIN supplier_sku_mappings m ON m.sku_id = s.id AND m.is_active = 1
       LEFT JOIN suppliers sup ON sup.id = m.supplier_id
       WHERE s.id = ?`
    ).bind(l.skuId).first();
    if (!s) throw bad('INVALID_SKU', `존재하지 않는 상품 옵션입니다: ${l.skuId}`);
    if (l.productId && l.productId !== s.product_id) throw bad('SKU_PRODUCT_MISMATCH', '상품과 옵션이 일치하지 않습니다.');
    if (s.prod_status !== 'ACTIVE' || s.review_status !== 'APPROVED' || s.partner_status !== 'APPROVED') {
      throw conflict('PRODUCT_NOT_ON_SALE', `판매 중이 아닌 상품입니다: ${s.prod_title}`);
    }
    if (s.stock_quantity < l.quantity) {
      throw conflict('STOCK_INSUFFICIENT', `재고가 부족합니다: ${s.prod_title}`, { sku_id: s.id, available: s.stock_quantity, requested: l.quantity });
    }
    if (s.sales_model === 'DIRECT') {
      const validMapping = s.supplier_id && Number(s.resale_authorized) === 1 && s.supplier_status === 'ACTIVE'
        && (!s.valid_until || s.valid_until > sqlNow());
      if (!validMapping) throw conflict('DIRECT_SKU_NOT_SOURCEABLE', `공급사 재판매 권한이 확인되지 않은 직영 상품입니다: ${s.prod_title}`);
    }
    assertWon(s.sale_price, 'sale_price');
    let optionSummary = '기본';
    try {
      const o = JSON.parse(s.option_combination_json || '{}');
      optionSummary = Object.entries(o).map(([k, v]) => `${k}:${v}`).join(' / ') || '기본';
    } catch { /* keep default */ }
    const pct = volumeDiscountPct(l.quantity);
    const unitPrice = s.sale_price - applyBps(s.sale_price, pct * 100);
    resolved.push({
      skuId: s.id, productId: s.product_id, partnerId: s.partner_id, salesModel: s.sales_model,
      title: s.prod_title, optionSummary, baseUnitPrice: s.sale_price, unitPrice, volumePct: pct,
      quantity: l.quantity, lineTotal: unitPrice * l.quantity,
      volumeDiscount: (s.sale_price - unitPrice) * l.quantity,
      unitCost: s.sales_model === 'DIRECT' ? s.unit_cost : null,
      shippingFee: s.base_shipping_fee ?? 3000, freeThreshold: s.free_shipping_threshold ?? 30000,
      bps: s.commission_rate_bps ?? Math.round(Number(s.commission_rate || 10) * 100)
    });
  }

  // 2. Split by seller, shipping per seller policy
  const orderId = newId('ord');
  const orderNo = newOrderNo();
  const groups = new Map();
  for (const it of resolved) {
    if (!groups.has(it.partnerId)) groups.set(it.partnerId, []);
    groups.get(it.partnerId).push(it);
  }
  const subs = [];
  let idx = 1;
  for (const [partnerId, its] of groups) {
    const goods = its.reduce((a, it) => a + it.lineTotal, 0);
    const fee = its[0].freeThreshold > 0 && goods >= its[0].freeThreshold ? 0 : its[0].shippingFee;
    const commission = its[0].salesModel === 'MARKETPLACE' ? applyBps(goods, its[0].bps) : 0;
    subs.push({
      id: newId('sub'), no: `${orderNo}-${idx++}`, partnerId, salesModel: its[0].salesModel, bps: its[0].bps,
      goods, shipping: assertWon(fee, 'shipping'), commission, items: its
    });
  }
  const allItems = subs.flatMap((s) => s.items);
  const goodsAfterVolume = allItems.reduce((a, it) => a + it.lineTotal, 0);
  const goodsBase = allItems.reduce((a, it) => a + it.baseUnitPrice * it.quantity, 0);
  const volumeTotal = goodsBase - goodsAfterVolume;
  const shippingTotal = subs.reduce((a, s) => a + s.shipping, 0);

  // 3. Coupon (must be owned, unused, active, unexpired)
  let coupon = 0;
  let userCouponId = null;
  const couponRef = body.user_coupon_id || body.coupon_code;
  if (couponRef) {
    const uc = await env.DB.prepare(
      `SELECT uc.id, c.discount_type, c.discount_value, c.min_order_amount, c.max_discount_amount
       FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id
       WHERE uc.user_id = ? AND uc.is_used = 0 AND c.is_active = 1 AND c.expires_at > ?
         AND (uc.id = ? OR UPPER(c.code) = UPPER(?))
       LIMIT 1`
    ).bind(principal.userId, sqlNow(), String(couponRef), String(couponRef)).first();
    if (!uc) throw conflict('COUPON_NOT_AVAILABLE', '사용할 수 있는 쿠폰이 아닙니다. (미보유·사용완료·만료)');
    if (goodsAfterVolume < (uc.min_order_amount || 0)) throw conflict('COUPON_MIN_ORDER', `쿠폰 최소 주문금액(${uc.min_order_amount}원) 미달입니다.`);
    coupon = uc.discount_type === 'PERCENT' ? applyBps(goodsAfterVolume, uc.discount_value * 100) : uc.discount_value;
    if (uc.max_discount_amount) coupon = Math.min(coupon, uc.max_discount_amount);
    coupon = Math.min(assertWon(coupon, 'coupon'), goodsAfterVolume);
    userCouponId = uc.id;
  }
  const couponAllocs = allocate(coupon, allItems.map((it) => it.lineTotal));
  allItems.forEach((it, i) => { it.couponAlloc = couponAllocs[i]; it.net = it.lineTotal - couponAllocs[i]; });

  // 4. Credits (allocated over item nets and shipping lines)
  const payableBeforeCredit = goodsAfterVolume - coupon + shippingTotal;
  const requestedCredit = Number(body.use_credit_amount ?? body.use_credits ?? 0);
  if (!Number.isSafeInteger(requestedCredit) || requestedCredit < 0) throw bad('INVALID_CREDIT', '적립금 사용 금액이 올바르지 않습니다.');
  let credit = 0;
  if (requestedCredit > 0) {
    const bal = await env.DB.prepare('SELECT COALESCE(SUM(amount_delta), 0) AS b FROM user_credits WHERE user_id = ?').bind(principal.userId).first('b');
    if (requestedCredit > bal) throw conflict('CREDIT_INSUFFICIENT', `적립금 잔액(${bal}원)이 부족합니다.`);
    credit = Math.min(requestedCredit, payableBeforeCredit);
  }
  const creditWeights = [...allItems.map((it) => it.net), ...subs.map((s) => s.shipping)];
  const creditAllocs = allocate(credit, creditWeights);
  allItems.forEach((it, i) => { it.creditAlloc = creditAllocs[i]; it.pgAlloc = it.net - it.creditAlloc; });
  subs.forEach((s, j) => {
    s.shipCredit = creditAllocs[allItems.length + j];
    s.shipPg = s.shipping - s.shipCredit;
    s.couponAlloc = s.items.reduce((a, it) => a + it.couponAlloc, 0);
    s.total = s.goods + s.shipping;
  });
  const pgTotal = allItems.reduce((a, it) => a + it.pgAlloc, 0) + subs.reduce((a, s) => a + s.shipPg, 0);
  if (goodsBase - volumeTotal - coupon - credit + shippingTotal !== pgTotal) throw new Error('MONEY_INVARIANT: order totals do not reconcile');
  if (dryRun) {
    return { quote: {
      total_goods_amount: goodsBase, volume_discount_amount: volumeTotal, coupon_discount_amount: coupon, credit_used_amount: credit,
      total_shipping_amount: shippingTotal, total_pay_amount: pgTotal, currency: 'KRW',
      sub_orders: subs.map((s) => ({ partner_id: s.partnerId, sales_model: s.salesModel, goods_amount: s.goods, shipping_fee: s.shipping, items: s.items.map((it) => ({ sku_id: it.skuId, title: it.title, option_summary: it.optionSummary, unit_price: it.unitPrice, base_unit_price: it.baseUnitPrice, quantity: it.quantity, line_total: it.lineTotal, volume_discount_pct: it.volumePct })) }))
    } };
  }

  // 5. Atomic reservation batch
  const now = sqlNow();
  const expiresAt = sqlNow(PAYMENT_WINDOW_MS);
  const st = [];
  st.push(env.DB.prepare(
    `INSERT INTO orders (id, order_no, customer_id, operator_entity_id, total_goods_amount, total_shipping_amount, total_discount_amount,
       volume_discount_amount, coupon_discount_amount, credit_used_amount, total_pay_amount, currency, payment_status,
       applied_user_coupon_id, checkout_idempotency_key, payment_expires_at, terms_version,
       recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code, shipping_memo,
       pccc, pccc_verified, customs_duty_type, settlement_currency, fx_rate, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'KRW', 'READY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'KRW', 1.0, ?, ?)`
  ).bind(orderId, orderNo, principal.userId, operator.id, goodsBase, shippingTotal, volumeTotal + coupon + credit,
    volumeTotal, coupon, credit, pgTotal, userCouponId, idemKey, expiresAt, operator.terms_version || null,
    addr.recipient, addr.phone, addr.line1, addr.line2, addr.postal, addr.memo,
    rawPccc, rawPccc ? 1 : 0, body.customs_duty_type === 'DDP' ? 'DDP' : 'DDU', now, now));

  for (const s of subs) {
    st.push(env.DB.prepare(
      `INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, sales_model, operator_entity_id, shipping_fee, goods_amount,
         discount_amount, total_amount, coupon_discount_allocated, shipping_credit_alloc, shipping_pg_alloc, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAYMENT_PENDING')`
    ).bind(s.id, orderId, s.no, s.partnerId, s.salesModel, operator.id, s.shipping, s.goods, s.couponAlloc, s.total, s.couponAlloc, s.shipCredit, s.shipPg));
    if (s.salesModel === 'MARKETPLACE') {
      st.push(env.DB.prepare(
        `INSERT INTO settlements (id, sub_order_id, partner_id, operator_entity_id, gross_amount, shipping_fee, commission_rate, commission_rate_bps,
           commission_amount, net_payout_amount, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'HOLD')`
      ).bind(newId('stl'), s.id, s.partnerId, operator.id, s.goods, s.shipping, s.bps / 10000, s.bps, s.commission, s.goods - s.commission + s.shipping));
    }
    for (const it of s.items) {
      st.push(env.DB.prepare(
        `INSERT INTO order_items (id, sub_order_id, sku_id, product_id, product_title, option_summary, base_unit_price, volume_discount_pct,
           unit_price, quantity, total_price, coupon_alloc, credit_alloc, pg_alloc, unit_cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(newId('itm'), s.id, it.skuId, it.productId, it.title, it.optionSummary, it.baseUnitPrice, it.volumePct,
        it.unitPrice, it.quantity, it.lineTotal, it.couponAlloc, it.creditAlloc, it.pgAlloc, it.unitCost));
      st.push(env.DB.prepare(
        `UPDATE product_skus SET stock_quantity = stock_quantity - ?,
           status = CASE WHEN stock_quantity - ? <= 0 THEN 'OUT_OF_STOCK' ELSE status END, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(it.quantity, it.quantity, it.skuId));
      st.push(env.DB.prepare(
        `INSERT INTO inventory_ledger (id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key)
         VALUES (?, ?, 'PURCHASE_DEDUCT', ?, (SELECT stock_quantity FROM product_skus WHERE id = ?), ?, ?)`
      ).bind(newId('ldg'), it.skuId, -it.quantity, it.skuId, orderId, `deduct:${orderId}:${it.skuId}`));
      st.push(env.DB.prepare('UPDATE products SET total_sold_count = total_sold_count + ? WHERE id = ?').bind(it.quantity, it.productId));
    }
  }
  if (userCouponId) {
    st.push(env.DB.prepare('UPDATE user_coupons SET is_used = 1, used_at = CURRENT_TIMESTAMP, used_order_id = ? WHERE id = ?').bind(orderId, userCouponId));
  }
  if (credit > 0) st.push(creditStatement(env, { userId: principal.userId, amount: -credit, reason: '주문 결제 적립금 사용(예약)', referenceId: orderId }));

  try {
    await runBatch(env, st);
  } catch (e) {
    if (idemKey && e instanceof HttpError && e.code === 'DUPLICATE_REQUEST') {
      const prev = await env.DB.prepare('SELECT * FROM orders WHERE customer_id = ? AND checkout_idempotency_key = ?').bind(principal.userId, idemKey).first();
      if (prev) return { replay: true, order: prev };
    }
    throw e;
  }

  let order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (pgTotal === 0) {
    await capturePayment(env, order, { provider: 'INTERNAL', paymentKey: null, amount: 0, sandbox: false, method: 'CREDIT_COUPON', approvedAt: new Date().toISOString(), raw: null });
    order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  }
  return { replay: false, order, subOrderCount: subs.length };
}

// ---------------------------------------------------------------------------------------------
// Payment capture
// ---------------------------------------------------------------------------------------------
async function capturePayment(env, order, pg) {
  const bundle = await loadOrderBundle(env, order.id);
  const st = [];
  if (pg.amount > 0) {
    st.push(env.DB.prepare(
      `INSERT INTO payment_transactions (id, order_id, payment_key, provider, method, amount, currency, status, receipt_url, raw_response_json, approved_at, is_sandbox)
       VALUES (?, ?, ?, ?, ?, ?, 'KRW', 'DONE', ?, ?, ?, ?)`
    ).bind(newId('ptx'), order.id, pg.paymentKey, pg.provider, pg.method || 'CARD', pg.amount, pg.receiptUrl || null,
      pg.raw ? JSON.stringify(pg.raw) : null, pg.approvedAt, pg.sandbox ? 1 : 0));
  }
  st.push(env.DB.prepare(
    `UPDATE orders SET payment_status = 'PAID', paid_at = CURRENT_TIMESTAMP, payment_key = ?, pg_provider = ?, pg_receipt_url = ?,
       is_sandbox = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(pg.paymentKey, pg.provider, pg.receiptUrl || null, pg.sandbox ? 1 : 0, order.id));
  st.push(env.DB.prepare("UPDATE sub_orders SET status = 'PAYMENT_CONFIRMED', updated_at = CURRENT_TIMESTAMP WHERE parent_order_id = ? AND status = 'PAYMENT_PENDING'").bind(order.id));
  st.push(env.DB.prepare("UPDATE settlements SET status = 'PENDING', updated_at = CURRENT_TIMESTAMP WHERE status = 'HOLD' AND sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)").bind(order.id));

  // Journal: cash + credit liability + promotion = seller payable + commission + direct revenue
  const lines = [
    { account: ACCOUNTS.PG_CLEARING, debit: order.total_pay_amount },
    { account: ACCOUNTS.CUSTOMER_CREDIT_LIABILITY, debit: order.credit_used_amount },
    { account: ACCOUNTS.PROMOTION_EXPENSE, debit: order.coupon_discount_amount }
  ];
  for (const s of bundle.subs) {
    if (s.sales_model === 'MARKETPLACE') {
      lines.push({ account: ACCOUNTS.SELLER_PAYABLE, credit: s.st_net, sub_order_id: s.id, partner_id: s.partner_id });
      lines.push({ account: ACCOUNTS.COMMISSION_REVENUE, credit: s.st_commission, sub_order_id: s.id, partner_id: s.partner_id });
    } else {
      lines.push({ account: ACCOUNTS.DIRECT_SALES_REVENUE, credit: s.goods_amount + s.shipping_fee, sub_order_id: s.id, partner_id: s.partner_id });
    }
  }
  st.push(...journalStatements(env, { txnType: 'PAYMENT_CAPTURE', entityId: order.operator_entity_id, orderId: order.id, lines }));

  // MODEL A: purchase orders to suppliers (manual dispatch until a supplier API contract exists)
  for (const s of bundle.subs.filter((x) => x.sales_model === 'DIRECT')) {
    const its = bundle.items.filter((i) => i.sub_order_id === s.id);
    const bySupplier = new Map();
    for (const it of its) {
      const m = await env.DB.prepare('SELECT * FROM supplier_sku_mappings WHERE sku_id = ? AND is_active = 1').bind(it.sku_id).first();
      if (!m) continue; // surfaced by reconciliation check DIRECT_WITHOUT_PO
      if (!bySupplier.has(m.supplier_id)) bySupplier.set(m.supplier_id, { mode: m.fulfillment_mode, lines: [] });
      bySupplier.get(m.supplier_id).lines.push({ it, m });
    }
    for (const [supplierId, g] of bySupplier) {
      const poId = newId('po');
      const cost = g.lines.reduce((a, { it, m }) => a + (it.unit_cost ?? m.unit_cost) * it.quantity, 0);
      st.push(env.DB.prepare(
        `INSERT INTO purchase_orders (id, po_no, supplier_id, sub_order_id, operator_entity_id, fulfillment_mode, dispatch_method, status, total_cost)
         VALUES (?, ?, ?, ?, ?, ?, 'MANUAL', 'DRAFT', ?)`
      ).bind(poId, newPoNo(), supplierId, s.id, order.operator_entity_id, g.mode, cost));
      for (const { it, m } of g.lines) {
        st.push(env.DB.prepare(
          `INSERT INTO purchase_order_items (id, purchase_order_id, order_item_id, sku_id, supplier_sku_code, quantity, unit_cost) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(newId('poi'), poId, it.id, it.sku_id, m.supplier_sku_code, it.quantity, it.unit_cost ?? m.unit_cost));
      }
    }
  }
  await runBatch(env, st);
}

/**
 * Customer-initiated confirmation after the PG widget returns.
 * If PG approves but our commit fails (e.g. the order expired meanwhile), the PG payment is cancelled (compensation).
 */
export async function confirmPayment(env, principal, { orderRef, paymentKey, amount }) {
  if (typeof paymentKey !== 'string' || paymentKey.length < 8 || paymentKey.length > 200) throw bad('INVALID_PAYMENT_KEY', '결제키가 올바르지 않습니다.');
  if (!Number.isSafeInteger(amount)) throw bad('INVALID_AMOUNT', '결제 금액이 올바르지 않습니다.');
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ? OR order_no = ?').bind(orderRef, orderRef).first();
  if (!order) throw notFound('주문을 찾을 수 없습니다.');
  if (order.customer_id !== principal.userId) throw forbidden();
  if (order.payment_status === 'PAID' && order.payment_key === paymentKey) return { replay: true, order };
  if (order.payment_status !== 'READY') throw conflict('ORDER_NOT_PAYABLE', `결제할 수 없는 주문 상태입니다. (${order.payment_status})`);
  if (order.payment_expires_at && order.payment_expires_at < sqlNow()) throw conflict('ORDER_EXPIRED', '결제 가능 시간이 지났습니다. 다시 주문해 주세요.');
  if (amount !== order.total_pay_amount) throw bad('AMOUNT_MISMATCH', `결제 금액 불일치: 주문 ${order.total_pay_amount}원 / 요청 ${amount}원`);

  const pg = await pgConfirm(env, { paymentKey, orderNo: order.order_no, amount: order.total_pay_amount });
  if (!pg.ok) {
    if (pg.approvedButMismatched) {
      await pgCancel(env, { paymentKey, amount: pg.raw.totalAmount, reason: 'Order/PG mismatch auto-cancel', idempotencyKey: `mismatch_${order.id}`, isSandbox: false }).catch(() => null);
    }
    throw new HttpError(402, pg.code, pg.message);
  }
  try {
    await capturePayment(env, order, { provider: pg.sandbox ? 'SANDBOX' : 'TOSS', paymentKey, amount: order.total_pay_amount, sandbox: pg.sandbox, method: pg.method, approvedAt: pg.approvedAt, receiptUrl: pg.receiptUrl, raw: pg.raw });
  } catch (e) {
    const fresh = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();
    if (fresh && fresh.payment_status === 'PAID' && fresh.payment_key === paymentKey) return { replay: true, order: fresh };
    const comp = await pgCancel(env, { paymentKey, amount: order.total_pay_amount, reason: '주문 확정 실패 자동취소', idempotencyKey: `comp_${order.id}`, isSandbox: pg.sandbox }).catch((err) => ({ ok: false, message: err.message }));
    await env.DB.prepare(
      `INSERT INTO payment_events (id, provider, event_key, event_type, order_id, payment_key, verified, outcome, payload_json)
       VALUES (?, ?, ?, 'CAPTURE_COMPENSATION', ?, ?, 1, ?, ?)`
    ).bind(newId('pev'), pg.sandbox ? 'SANDBOX' : 'TOSS', `comp:${order.id}:${paymentKey}`, order.id, paymentKey,
      comp.ok ? 'PG_CANCELLED' : 'PG_CANCEL_FAILED_MANUAL_ACTION', JSON.stringify({ error: String(e.message), comp })).run().catch(() => null);
    throw conflict('PAYMENT_COMPENSATED', comp.ok ? '주문 확정에 실패하여 결제가 자동 취소되었습니다.' : '주문 확정에 실패했습니다. 결제 취소가 수동 처리됩니다.');
  }
  return { replay: false, order: await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first() };
}

/** Used by verified webhooks: capture a READY order, or compensate if it can no longer be captured. */
export async function captureFromVerifiedPg(env, order, pgPayment, { sandbox = false } = {}) {
  if (order.payment_status === 'PAID') return order.payment_key === pgPayment.paymentKey ? 'ALREADY_CAPTURED' : 'CONFLICT_OTHER_KEY';
  const okAmount = pgPayment.totalAmount === order.total_pay_amount && pgPayment.orderId === order.order_no;
  if (order.payment_status === 'READY' && okAmount) {
    await capturePayment(env, order, { provider: sandbox ? 'SANDBOX' : 'TOSS', paymentKey: pgPayment.paymentKey, amount: order.total_pay_amount, sandbox, method: pgPayment.method, approvedAt: pgPayment.approvedAt || new Date().toISOString(), receiptUrl: pgPayment.receipt?.url || null, raw: pgPayment });
    return 'CAPTURED_FROM_WEBHOOK';
  }
  const comp = await pgCancel(env, { paymentKey: pgPayment.paymentKey, amount: pgPayment.totalAmount, reason: '취소/만료 주문 결제 자동취소', idempotencyKey: `whcomp_${order.id}_${pgPayment.paymentKey}`, isSandbox: sandbox }).catch(() => ({ ok: false }));
  return comp.ok ? 'COMPENSATED_CANCEL' : 'COMPENSATION_FAILED_MANUAL_ACTION';
}

// ---------------------------------------------------------------------------------------------
// Release of unpaid orders (customer cancel before payment, or expiry)
// ---------------------------------------------------------------------------------------------
export async function releaseUnpaidOrder(env, orderRef, target) {
  const b = await loadOrderBundle(env, orderRef);
  if (!b) throw notFound('주문을 찾을 수 없습니다.');
  if (b.order.payment_status !== 'READY') throw conflict('ORDER_NOT_UNPAID', '결제 대기 상태의 주문이 아닙니다.');
  const subStatus = target === 'EXPIRED' ? 'EXPIRED' : 'CANCELLED';
  const st = [
    env.DB.prepare('UPDATE orders SET payment_status = ?, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(target, b.order.id),
    env.DB.prepare('UPDATE sub_orders SET status = ?, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE parent_order_id = ?').bind(subStatus, b.order.id),
    env.DB.prepare("UPDATE settlements SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)").bind(b.order.id)
  ];
  st.push(...restockStatements(env, b.order.id, b.items.map((it) => ({ it, qty: it.quantity })), 'ORDER_CANCEL', `release:${b.order.id}`));
  if (b.order.applied_user_coupon_id) {
    st.push(env.DB.prepare('UPDATE user_coupons SET is_used = 0, used_at = NULL, used_order_id = NULL WHERE id = ? AND used_order_id = ?').bind(b.order.applied_user_coupon_id, b.order.id));
  }
  if (b.order.credit_used_amount > 0) {
    st.push(creditStatement(env, { userId: b.order.customer_id, amount: b.order.credit_used_amount, reason: target === 'EXPIRED' ? '결제 시간 만료 적립금 복원' : '결제 전 취소 적립금 복원', referenceId: b.order.id }));
  }
  await runBatch(env, st);
}

function restockStatements(env, orderId, lines, changeType, keyPrefix) {
  const st = [];
  for (const { it, qty } of lines) {
    if (qty <= 0) continue;
    st.push(env.DB.prepare(
      `UPDATE product_skus SET stock_quantity = stock_quantity + ?, status = CASE WHEN stock_quantity + ? > 0 THEN 'IN_STOCK' ELSE status END,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(qty, qty, it.sku_id));
    st.push(env.DB.prepare(
      `INSERT INTO inventory_ledger (id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key)
       VALUES (?, ?, ?, ?, (SELECT stock_quantity FROM product_skus WHERE id = ?), ?, ?)`
    ).bind(newId('ldg'), it.sku_id, changeType, qty, it.sku_id, orderId, `${keyPrefix}:${it.id}`));
    st.push(env.DB.prepare('UPDATE products SET total_sold_count = MAX(0, total_sold_count - ?) WHERE id = (SELECT product_id FROM product_skus WHERE id = ?)').bind(qty, it.sku_id));
  }
  return st;
}

export async function expireStaleOrders(env, limit = 50) {
  const { results } = await env.DB.prepare(
    "SELECT id FROM orders WHERE payment_status = 'READY' AND payment_expires_at IS NOT NULL AND payment_expires_at < ? LIMIT ?"
  ).bind(sqlNow(), limit).all();
  let expired = 0;
  for (const r of results) {
    try { await releaseUnpaidOrder(env, r.id, 'EXPIRED'); expired++; } catch { /* concurrently paid/cancelled: skip */ }
  }
  return expired;
}

// ---------------------------------------------------------------------------------------------
// Refund engine (paid orders): reserve -> PG cancel -> finalize  |  reserve -> PG fail -> release
// ---------------------------------------------------------------------------------------------
/**
 * request: { lines: [{ order_item_id, quantity }], shippingSubOrderIds: [], reasonCode, claimId, restock, idemKey,
 *            subStatusOnFull: 'CANCELLED'|'RETURNED', orderStatusOnFull: 'CANCELLED'|'REFUNDED', restoreCoupon }
 */
export async function refundOrder(env, actor, orderRef, request) {
  const b = await loadOrderBundle(env, orderRef);
  if (!b) throw notFound('주문을 찾을 수 없습니다.');
  const o = b.order;
  if (!['PAID', 'PARTIAL_REFUNDED'].includes(o.payment_status)) throw conflict('ORDER_NOT_REFUNDABLE', `환불할 수 없는 주문 상태입니다. (${o.payment_status})`);
  const idemKey = request.idemKey || newId('rfk');
  const existing = await env.DB.prepare('SELECT * FROM refunds WHERE idempotency_key = ?').bind(idemKey).first();
  if (existing) return { replay: true, refund: existing };

  const itemsById = new Map(b.items.map((i) => [i.id, i]));
  const plan = [];
  for (const l of request.lines || []) {
    const it = itemsById.get(l.order_item_id);
    if (!it) throw bad('INVALID_ORDER_ITEM', '주문 상품을 찾을 수 없습니다.');
    const qty = Number(l.quantity);
    const remaining = it.quantity - it.refunded_quantity;
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > remaining) throw conflict('REFUND_EXCEEDS_PAID', '환불 가능 수량을 초과했습니다.', { order_item_id: it.id, remaining });
    const pgPart = proportionalPortion(it.pg_alloc, it.refunded_pg_amount, qty, it.quantity, it.refunded_quantity);
    const crPart = proportionalPortion(it.credit_alloc, it.refunded_credit_amount, qty, it.quantity, it.refunded_quantity);
    const cpPart = proportionalPortion(it.coupon_alloc, it.refunded_coupon_amount, qty, it.quantity, it.refunded_quantity);
    plan.push({ it, qty, pgPart, crPart, cpPart, goods: pgPart + crPart + cpPart });
  }
  const shipSubs = (request.shippingSubOrderIds || []).map((id) => b.subs.find((s) => s.id === id)).filter((s) => s && !s.shipping_refunded && s.shipping_fee > 0);
  if (!plan.length && !shipSubs.length) throw bad('NOTHING_TO_REFUND', '환불할 항목이 없습니다.');

  const pg = plan.reduce((a, p) => a + p.pgPart, 0) + shipSubs.reduce((a, s) => a + s.shipping_pg_alloc, 0);
  const credit = plan.reduce((a, p) => a + p.crPart, 0) + shipSubs.reduce((a, s) => a + s.shipping_credit_alloc, 0);
  const coupon = plan.reduce((a, p) => a + p.cpPart, 0);
  const goods = plan.reduce((a, p) => a + p.goods, 0);
  const shipping = shipSubs.reduce((a, s) => a + s.shipping_fee, 0);
  const refundId = newId('rfd');
  const itemsJson = JSON.stringify(plan.map((p) => ({ order_item_id: p.it.id, sub_order_id: p.it.sub_order_id, sku_id: p.it.sku_id, quantity: p.qty, pg: p.pgPart, credit: p.crPart, coupon: p.cpPart })).concat(shipSubs.map((s) => ({ shipping_sub_order_id: s.id, pg: s.shipping_pg_alloc, credit: s.shipping_credit_alloc, amount: s.shipping_fee }))));

  // Phase 1: reserve (caps enforced by triggers/CHECKs; concurrent over-refund aborts here)
  const reserve = [
    env.DB.prepare(
      `INSERT INTO refunds (id, order_id, sub_order_id, claim_id, operator_entity_id, reason_code, goods_amount, shipping_amount, coupon_reversal_amount,
         pg_amount, credit_amount, items_json, status, is_sandbox, idempotency_key, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`
    ).bind(refundId, o.id, request.subOrderId || null, request.claimId || null, o.operator_entity_id, request.reasonCode, goods, shipping, coupon, pg, credit, itemsJson, o.is_sandbox, idemKey, actor.userId),
    env.DB.prepare('UPDATE orders SET refunded_pg_amount = refunded_pg_amount + ?, refunded_credit_amount = refunded_credit_amount + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(pg, credit, o.id)
  ];
  for (const p of plan) {
    reserve.push(env.DB.prepare(
      `UPDATE order_items SET refunded_quantity = refunded_quantity + ?, refunded_pg_amount = refunded_pg_amount + ?,
         refunded_credit_amount = refunded_credit_amount + ?, refunded_coupon_amount = refunded_coupon_amount + ? WHERE id = ?`
    ).bind(p.qty, p.pgPart, p.crPart, p.cpPart, p.it.id));
  }
  for (const s of shipSubs) reserve.push(env.DB.prepare('UPDATE sub_orders SET shipping_refunded = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(s.id));
  await runBatch(env, reserve);

  // Phase 2: PG cancel (cash portion only)
  let pgRes = { ok: true, transactionKey: null };
  if (pg > 0) {
    pgRes = await pgCancel(env, { paymentKey: o.payment_key, amount: pg, reason: request.reasonCode, idempotencyKey: refundId, isSandbox: Number(o.is_sandbox) === 1 })
      .catch((e) => ({ ok: false, code: e.code || 'PG_ERROR', message: e.message }));
  }
  if (!pgRes.ok) {
    const release = [
      env.DB.prepare("UPDATE refunds SET status = 'FAILED', failure_reason = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(`${pgRes.code}: ${pgRes.message}`.slice(0, 500), refundId),
      env.DB.prepare('UPDATE orders SET refunded_pg_amount = refunded_pg_amount - ?, refunded_credit_amount = refunded_credit_amount - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(pg, credit, o.id)
    ];
    for (const p of plan) {
      release.push(env.DB.prepare(
        `UPDATE order_items SET refunded_quantity = refunded_quantity - ?, refunded_pg_amount = refunded_pg_amount - ?,
           refunded_credit_amount = refunded_credit_amount - ?, refunded_coupon_amount = refunded_coupon_amount - ? WHERE id = ?`
      ).bind(p.qty, p.pgPart, p.crPart, p.cpPart, p.it.id));
    }
    for (const s of shipSubs) release.push(env.DB.prepare('UPDATE sub_orders SET shipping_refunded = 0 WHERE id = ?').bind(s.id));
    await runBatch(env, release);
    throw new HttpError(502, 'PG_REFUND_FAILED', 'PG 환불 요청이 실패했습니다. 잠시 후 다시 시도해 주세요.', { refund_id: refundId });
  }

  // Phase 3: finalize
  const after = await loadOrderBundle(env, o.id);
  const fin = [env.DB.prepare("UPDATE refunds SET status = 'DONE', pg_transaction_key = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(pgRes.transactionKey, refundId)];
  if (credit > 0) fin.push(creditStatement(env, { userId: o.customer_id, amount: credit, reason: '환불 적립금 복원', referenceId: refundId }));
  if (request.restock) fin.push(...restockStatements(env, o.id, plan.map((p) => ({ it: p.it, qty: p.qty })), request.reasonCode === 'RETURN' ? 'RETURN_RESTOCK' : 'ORDER_CANCEL', `restock:${refundId}`));

  const journal = [
    { account: ACCOUNTS.PG_CLEARING, credit: pg },
    { account: ACCOUNTS.CUSTOMER_CREDIT_LIABILITY, credit },
    { account: ACCOUNTS.PROMOTION_EXPENSE, credit: coupon }
  ];
  const touchedSubIds = new Set([...plan.map((p) => p.it.sub_order_id), ...shipSubs.map((s) => s.id)]);
  const warnings = [];
  for (const sid of touchedSubIds) {
    const s = after.subs.find((x) => x.id === sid);
    const goodsRefund = plan.filter((p) => p.it.sub_order_id === sid).reduce((a, p) => a + p.goods, 0);
    const shipRefund = shipSubs.some((x) => x.id === sid) ? s.shipping_fee : 0;
    if (s.sales_model === 'MARKETPLACE' && s.settlement_id) {
      const adj = await env.DB.prepare('SELECT COALESCE(SUM(gross_delta),0) g, COALESCE(SUM(commission_delta),0) c, COALESCE(SUM(shipping_delta),0) sh FROM settlement_adjustments WHERE settlement_id = ?').bind(s.settlement_id).first();
      const grossNow = s.st_gross + adj.g;
      const commNow = s.st_commission + adj.c;
      const grossNew = grossNow - goodsRefund;
      const commDelta = applyBps(grossNew, s.st_bps) - commNow;
      const shipDelta = -shipRefund;
      const netDelta = -goodsRefund - commDelta + shipDelta;
      fin.push(env.DB.prepare(
        `INSERT INTO settlement_adjustments (id, settlement_id, partner_id, refund_id, gross_delta, commission_delta, shipping_delta, net_delta, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(newId('sadj'), s.settlement_id, s.partner_id, refundId, -goodsRefund, commDelta, shipDelta, netDelta, request.reasonCode));
      const netAfter = (s.st_net + (await env.DB.prepare('SELECT COALESCE(SUM(net_delta),0) n FROM settlement_adjustments WHERE settlement_id = ?').bind(s.settlement_id).first('n'))) + netDelta;
      if (netAfter === 0 && s.st_status !== 'PAID_OUT') {
        fin.push(env.DB.prepare("UPDATE settlements SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'PAID_OUT'").bind(s.settlement_id));
      }
      journal.push({ account: ACCOUNTS.SELLER_PAYABLE, debit: -netDelta, sub_order_id: sid, partner_id: s.partner_id });
      journal.push({ account: ACCOUNTS.COMMISSION_REVENUE, debit: -commDelta, sub_order_id: sid, partner_id: s.partner_id });
    } else {
      journal.push({ account: ACCOUNTS.DIRECT_SALES_REVENUE, debit: goodsRefund + shipRefund, sub_order_id: sid, partner_id: s.partner_id });
    }
    const subItems = after.items.filter((i) => i.sub_order_id === sid);
    const subFully = subItems.every((i) => i.refunded_quantity === i.quantity) && (s.shipping_fee === 0 || s.shipping_refunded === 1 || !PRE_SHIPMENT.includes(s.status));
    if (subFully) {
      const next = PRE_SHIPMENT.includes(s.status) ? 'CANCELLED' : (request.subStatusOnFull || 'RETURNED');
      fin.push(env.DB.prepare('UPDATE sub_orders SET status = ?, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(next, sid));
      if (s.sales_model === 'DIRECT') {
        fin.push(env.DB.prepare("UPDATE purchase_orders SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE sub_order_id = ? AND status = 'DRAFT'").bind(sid));
        const sent = await env.DB.prepare("SELECT COUNT(*) c FROM purchase_orders WHERE sub_order_id = ? AND status IN ('SENT','CONFIRMED','SHIPPED')").bind(sid).first('c');
        if (sent > 0) warnings.push({ code: 'SUPPLIER_PO_ALREADY_SENT', sub_order_id: sid, message: '공급사에 이미 발주된 건입니다. 공급사 취소를 수동으로 진행하세요.' });
      }
    }
  }
  fin.push(...journalStatements(env, { txnType: 'REFUND', entityId: o.operator_entity_id, orderId: o.id, refundId, lines: journal }));

  const allItemsDone = after.items.every((i) => i.refunded_quantity === i.quantity);
  const allShipDone = after.subs.every((s) => s.shipping_fee === 0 || s.shipping_refunded === 1 || !PRE_SHIPMENT.includes(s.status));
  const full = allItemsDone && allShipDone;
  const nextOrder = full ? (request.orderStatusOnFull || 'REFUNDED') : 'PARTIAL_REFUNDED';
  fin.push(env.DB.prepare('UPDATE orders SET payment_status = ?, updated_at = CURRENT_TIMESTAMP, cancelled_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE cancelled_at END WHERE id = ?').bind(nextOrder, full ? 1 : 0, o.id));
  if (full && request.restoreCoupon && o.applied_user_coupon_id) {
    fin.push(env.DB.prepare('UPDATE user_coupons SET is_used = 0, used_at = NULL, used_order_id = NULL WHERE id = ? AND used_order_id = ?').bind(o.applied_user_coupon_id, o.id));
  }
  if (request.claimId) {
    fin.push(env.DB.prepare("UPDATE returns SET status = 'REFUNDED', refund_amount = ?, refund_id = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(pg + credit, refundId, actor.userId, request.claimId));
  }
  await runBatch(env, fin);
  const refund = await env.DB.prepare('SELECT * FROM refunds WHERE id = ?').bind(refundId).first();
  return { replay: false, refund, orderStatus: nextOrder, warnings };
}

export function allRemainingLines(bundle, subOrderId = null) {
  return bundle.items
    .filter((i) => (!subOrderId || i.sub_order_id === subOrderId) && i.quantity > i.refunded_quantity)
    .map((i) => ({ order_item_id: i.id, quantity: i.quantity - i.refunded_quantity }));
}

/** Customer/admin cancellation of a whole order (before shipment). */
export async function cancelOrder(env, actor, orderRef, { isAdmin = false } = {}) {
  const b = await loadOrderBundle(env, orderRef);
  if (!b) throw notFound('주문을 찾을 수 없습니다.');
  if (!isAdmin && b.order.customer_id !== actor.userId) throw forbidden();
  if (b.order.payment_status === 'READY') {
    await releaseUnpaidOrder(env, b.order.id, 'CANCELLED');
    return { status: 'CANCELLED', refund: null };
  }
  const active = b.subs.filter((s) => !['CANCELLED', 'EXPIRED'].includes(s.status));
  if (active.some((s) => !PRE_SHIPMENT.includes(s.status))) {
    throw conflict('ALREADY_SHIPPED', '출고된 상품이 포함되어 있어 주문 전체 취소가 불가합니다. 미출고 판매자 주문만 취소하거나 반품을 신청해 주세요.');
  }
  const r = await refundOrder(env, actor, b.order.id, {
    lines: allRemainingLines(b), shippingSubOrderIds: active.map((s) => s.id), reasonCode: 'CUSTOMER_CANCEL',
    restock: true, idemKey: `cancel:${b.order.id}`, orderStatusOnFull: 'CANCELLED', restoreCoupon: true
  });
  return { status: r.orderStatus, refund: r.refund, warnings: r.warnings, replay: r.replay };
}

/** Partial cancellation: one seller's part of a mixed order (before shipment). */
export async function cancelSubOrder(env, actor, orderRef, subOrderId, { isAdmin = false } = {}) {
  const b = await loadOrderBundle(env, orderRef);
  if (!b) throw notFound('주문을 찾을 수 없습니다.');
  if (!isAdmin && b.order.customer_id !== actor.userId) throw forbidden();
  const s = b.subs.find((x) => x.id === subOrderId || x.sub_order_no === subOrderId);
  if (!s) throw notFound('판매자 주문을 찾을 수 없습니다.');
  if (!PRE_SHIPMENT.includes(s.status) || s.status === 'PAYMENT_PENDING') {
    throw conflict('SUB_ORDER_NOT_CANCELLABLE', `취소할 수 없는 상태입니다. (${s.status})`);
  }
  const r = await refundOrder(env, actor, b.order.id, {
    lines: allRemainingLines(b, s.id), shippingSubOrderIds: [s.id], subOrderId: s.id, reasonCode: 'CUSTOMER_PARTIAL_CANCEL',
    restock: true, idemKey: `cancel:${s.id}`, orderStatusOnFull: 'CANCELLED', restoreCoupon: false
  });
  return { status: r.orderStatus, refund: r.refund, warnings: r.warnings, replay: r.replay };
}

// ---------------------------------------------------------------------------------------------
// Purchase confirmation
// ---------------------------------------------------------------------------------------------
export async function confirmPurchase(env, actor, orderRef, { auto = false } = {}) {
  const b = await loadOrderBundle(env, orderRef);
  if (!b) throw notFound('주문을 찾을 수 없습니다.');
  if (!auto && b.order.customer_id !== actor.userId) throw forbidden();
  const delivered = b.subs.filter((s) => s.status === 'DELIVERED');
  if (!delivered.length) throw conflict('NOT_DELIVERED', '배송 완료된 상품만 구매확정할 수 있습니다.');
  let reward = 0;
  for (const s of delivered) {
    const st = [
      env.DB.prepare("UPDATE sub_orders SET status = 'PURCHASE_CONFIRMED', purchase_confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'DELIVERED'").bind(s.id),
      env.DB.prepare("UPDATE settlements SET status = 'ELIGIBLE_FOR_PAYOUT', eligible_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE sub_order_id = ? AND status = 'PENDING'").bind(s.id),
      env.DB.prepare("INSERT INTO idempotency_keys (scope, idem_key, principal_id, reference_id) VALUES ('PURCHASE_CONFIRM', ?, ?, ?)").bind(s.id, actor.userId, b.order.id)
    ];
    const paid = b.items.filter((i) => i.sub_order_id === s.id).reduce((a, i) => a + (i.pg_alloc - i.refunded_pg_amount), 0);
    const r = auto ? 0 : applyBps(Math.max(0, paid), 100);
    if (r > 0) st.push(...grantCreditStatements(env, { userId: b.order.customer_id, amount: r, reason: '구매확정 1% 적립', referenceId: s.id, entityId: b.order.operator_entity_id, txnType: 'PURCHASE_REWARD' }));
    try {
      await runBatch(env, st);
      reward += r;
    } catch (e) {
      if (!(e instanceof HttpError && e.code === 'DUPLICATE_REQUEST')) throw e;
    }
  }
  return { confirmed: delivered.length, reward };
}

export async function autoConfirmDelivered(env, days = 7, limit = 100) {
  const cutoff = sqlNow(-days * 24 * 60 * 60 * 1000);
  const { results } = await env.DB.prepare(
    "SELECT DISTINCT parent_order_id FROM sub_orders WHERE status = 'DELIVERED' AND delivered_at IS NOT NULL AND delivered_at <= ? LIMIT ?"
  ).bind(cutoff, limit).all();
  let n = 0;
  for (const r of results) {
    try { const x = await confirmPurchase(env, { userId: 'system:auto-confirm' }, r.parent_order_id, { auto: true }); n += x.confirmed; } catch { /* skip */ }
  }
  return n;
}
