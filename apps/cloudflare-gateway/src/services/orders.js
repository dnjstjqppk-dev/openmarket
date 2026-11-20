// apps/cloudflare-gateway/src/services/orders.js
// Order lifecycle engine: checkout (reservation), payment capture, release (cancel/expire), refunds,
// purchase confirmation. Every state change is one atomic D1 batch; DB triggers are the last line of defence.

import { HttpError, bad, conflict, notFound, forbidden, unavailable, str, idempotencyKey } from '../lib/http.js';
import { newId, newOrderNo, newPoNo, sqlNow } from '../lib/ids.js';
import { allocate, applyBps, proportionalPortion, assertWon } from '../lib/money.js';
import { ACCOUNTS, journalStatements, creditStatement, grantCreditStatements, getActiveOperator, auditStatement, getPolicy } from '../lib/ledger.js';
import { pgConfirm, pgCancel, paymentMode, cardSummaryOf } from '../lib/pg.js';
import { evaluateCheckoutFds } from './fds.js';
import { loadHeldCouponByRef, matchScope, couponAmount, splitPlatformBurden } from './coupons.js';
import { sealPii } from '../lib/pii-crypto.js';
import { pushRefundCompleted, pushSellerNewOrder } from './push.js';
import { notifyRestockedSkus } from './restock.js';
import { resolveRemoteZone } from '../lib/remote-zones.js';
import { findForbiddenMemo } from '../lib/memo-guard.js';

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
  if (msg.includes('COUPON_SOLD_OUT')) return conflict('COUPON_SOLD_OUT', '쿠폰이 모두 소진되었습니다.');
  if (msg.includes('COUPON_LIMIT_REACHED')) return conflict('COUPON_LIMIT_REACHED', '1인 발급 한도를 초과했습니다.');
  if (msg.includes('COUPON_SELLER_INTEGRITY')) return conflict('COUPON_SELLER_INTEGRITY', '판매자 쿠폰은 판매자 지정·스토어 그룹·플랫폼 부담 0이어야 합니다.');
  if (msg.includes('user_coupons.user_id, user_coupons.coupon_id')) return conflict('COUPON_ALREADY_CLAIMED', '이미 받은 쿠폰입니다.');
  if (msg.includes('FLASH_SALE_SOLD_OUT')) return conflict('FLASH_SALE_SOLD_OUT', '특가 수량이 소진되었습니다.');
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
            st.pg_fee_amount AS st_pg_fee,
            pt.business_name, pt.base_shipping_fee AS partner_base_fee, pt.return_shipping_fee AS partner_return_fee
     FROM sub_orders s
     LEFT JOIN settlements st ON st.sub_order_id = s.id
     LEFT JOIN partners pt ON pt.id = s.partner_id
     WHERE s.parent_order_id = ? ORDER BY s.sub_order_no`
  ).bind(order.id).all();
  const { results: items } = await env.DB.prepare(
    `SELECT i.*, sk.product_id, p.thumbnail_url FROM order_items i JOIN sub_orders s ON s.id = i.sub_order_id
     LEFT JOIN product_skus sk ON sk.id = i.sku_id LEFT JOIN products p ON p.id = sk.product_id
     WHERE s.parent_order_id = ? ORDER BY i.id`
  ).bind(order.id).all();
  return { order, subs, items };
}

// P2-R1: the schema level this code was written against. /health reports the
// applied level (NEW-16); K-1.4 pins this constant to the newest migration file
// so the two cannot drift apart silently.
export const REQUIRED_SCHEMA_VERSION = 'd1_74_seo_crawl.sql';

// P2-R1: refuse order writes when D1 lags (or otherwise differs from) the
// code's schema level. Deploys are forward-only, so a code-first deploy must
// fail closed instead of writing through an outdated schema.
export async function assertSchemaLevel(env) {
  let applied = null;
  try {
    applied = await env.DB.prepare('SELECT MAX(version) AS v FROM schema_migrations').first('v');
  } catch {
    applied = null;
  }
  if (applied !== REQUIRED_SCHEMA_VERSION) {
    throw unavailable('SCHEMA_MISMATCH', `주문 서버 스키마(${applied || 'unknown'})가 코드 요구 수준(${REQUIRED_SCHEMA_VERSION})과 달라 주문을 받을 수 없습니다.`);
  }
}

// 2-9: platform/store coupon split plus the items-PG base for credit
// projection, re-read from stored allocations (replay responses included).
export async function couponSplitForOrder(env, orderId) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(i.platform_coupon_alloc), 0) AS plat, COALESCE(SUM(i.store_coupon_alloc), 0) AS store,
            COALESCE(SUM(i.pg_alloc), 0) AS items_pg
     FROM order_items i JOIN sub_orders s ON s.id = i.sub_order_id WHERE s.parent_order_id = ?`
  ).bind(orderId).first();
  return { platform: Number(row.plat) || 0, store: Number(row.store) || 0, itemsPg: Number(row.items_pg) || 0 };
}

// 2-9: projected purchase-reward credit. Null without an effective
// credit.earn_bps policy, so callers omit the key instead of inventing money.
// The base mirrors confirmPurchase (items PG only, shipping excluded).
export async function projectedCreditFor(env, itemsPg) {
  const raw = await getPolicy(env, 'credit.earn_bps');
  if (raw == null) return null;
  const bps = Number(raw);
  if (!Number.isFinite(bps) || bps < 0) return null;
  return applyBps(Math.max(0, itemsPg), bps);
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
  // P2-S12: digits only, starts with 0, 9-11 digits (the old char-class regex passed '+++++++++').
  if (!/^0\d{8,10}$/.test(String(phone).replace(/\D/g, ''))) throw bad('INVALID_PHONE', '연락처 형식이 올바르지 않습니다.');
  const line1 = str(body.shipping_address_line1 || a.address || a.line1, { field: '주소', max: 200, required: true });
  const line2 = str(body.shipping_address_line2 || a.detail || a.line2, { field: '상세주소', max: 200 });
  const postal = str(body.shipping_postal_code || a.zip || a.postal_code, { field: '우편번호', max: 10, required: true });
  if (!/^\d{5}$/.test(postal)) throw bad('INVALID_POSTAL_CODE', '우편번호는 5자리 숫자여야 합니다.');
  const memo = str(body.shipping_memo || a.memo, { field: '배송메모', max: 200 });
  const forbidden = findForbiddenMemo(memo);
  if (forbidden) throw bad('MEMO_FORBIDDEN', '배송 메모에 사용할 수 없는 표현이 있습니다.');
  return { recipient, phone, line1, line2, postal, memo };
}

// 3-6: optional scheduled-delivery date (tomorrow .. +30 days).
function parseDeliveryDate(body) {
  const raw = body.requested_delivery_date;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw bad('INVALID_DELIVERY_DATE', '수령 희망일은 YYYY-MM-DD 형식이어야 합니다.');
  const today = new Date().toISOString().slice(0, 10);
  const top = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  if (s <= today) throw bad('INVALID_DELIVERY_DATE', '수령 희망일은 내일 이후여야 합니다.');
  if (s > top) throw bad('INVALID_DELIVERY_DATE', '수령 희망일은 30일 이내여야 합니다.');
  return s;
}

export async function createOrder(env, principal, body, idemHeader, { dryRun = false, ip = null, ipCountry = null } = {}) {
  // P2-R1: fail closed before any order work (replay included) when D1 lags the code.
  await assertSchemaLevel(env);
  const idemKey = idempotencyKey(idemHeader || body.idempotency_key || null);
  if (idemKey && !dryRun) {
    const prev = await env.DB.prepare('SELECT * FROM orders WHERE customer_id = ? AND checkout_idempotency_key = ?').bind(principal.userId, idemKey).first();
    if (prev) {
      const split = await couponSplitForOrder(env, prev.id);
      return { replay: true, order: prev, platformDiscount: split.platform, storeDiscount: split.store,
        projectedCredit: await projectedCreditFor(env, split.itemsPg) };
    }
  }

  const lines = parseLines(body.items);
  const addr = dryRun ? null : parseAddress(body);
  const requestedDeliveryDate = parseDeliveryDate(body);
  // NEW-20: quotes stay address-free, but resolve the zone when a postal rides along.
  const zonePostal = dryRun
    ? String(body.shipping_postal_code || (body.shipping_address || {}).zip || (body.shipping_address || {}).postal_code || '')
    : addr.postal;
  const remoteZone = await resolveRemoteZone(env, zonePostal);
  const remoteSurcharge = remoteZone ? Number(remoteZone.surcharge_amount) || 0 : 0;
  const remoteZoneName = remoteZone ? remoteZone.zone_name : null;
  const rawPccc = body.pccc ? String(body.pccc).trim().toUpperCase() : null;
  if (rawPccc && !/^P\d{12}$/.test(rawPccc)) throw bad('INVALID_PCCC', "개인통관고유부호 형식이 올바르지 않습니다. 'P'로 시작하는 13자리 번호여야 합니다.");

  const operator = await getActiveOperator(env);
  if (!operator) throw unavailable('OPERATOR_NOT_CONFIGURED', '운영 사업자 정보가 등록·활성화되지 않아 주문을 받을 수 없습니다.');

  // 1. Resolve SKUs with server-side price authority
  const resolved = [];
  for (const l of lines) {
    const s = await env.DB.prepare(
      `SELECT s.id, s.product_id, s.sku_code, s.option_combination_json, s.sale_price, s.stock_quantity,
              p.partner_id, p.title AS prod_title, p.status AS prod_status, p.review_status, p.requires_pccc, p.hs_code,
              p.shipping_policy_id, p.bundle_group_key, p.category_id,
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
    // 2-6: an approved flash item in a live campaign replaces the ticket price;
    // deal lines take no volume discount. SKU-specific items win over product-wide ones.
    const deal = await env.DB.prepare(
      `SELECT f.id, f.deal_price FROM flash_sale_items f
       JOIN flash_sale_campaigns c ON c.id = f.campaign_id
       WHERE f.status = 'APPROVED' AND c.status = 'ACTIVE' AND c.starts_at <= ? AND c.ends_at > ?
         AND f.deal_price > 0
         AND ((f.sku_id IS NOT NULL AND f.sku_id = ?) OR (f.sku_id IS NULL AND f.product_id = ?))
       ORDER BY (f.sku_id IS NULL) ASC, f.deal_price ASC LIMIT 1`
    ).bind(sqlNow(), sqlNow(), s.id, s.product_id).first();
    let optionSummary = '기본';
    try {
      const o = JSON.parse(s.option_combination_json || '{}');
      optionSummary = Object.entries(o).map(([k, v]) => `${k}:${v}`).join(' / ') || '기본';
    } catch { /* keep default */ }
    const pct = deal ? 0 : volumeDiscountPct(l.quantity);
    const ticketPrice = deal ? deal.deal_price : s.sale_price;
    const unitPrice = ticketPrice - (deal ? 0 : applyBps(ticketPrice, pct * 100));
    resolved.push({
      skuId: s.id, productId: s.product_id, partnerId: s.partner_id, categoryId: s.category_id, hsCode: s.hs_code || null, salesModel: s.sales_model, requiresPccc: Number(s.requires_pccc) === 1,
      title: s.prod_title, optionSummary, baseUnitPrice: ticketPrice, unitPrice, volumePct: pct,
      flashSaleItemId: deal ? deal.id : null,
      quantity: l.quantity, lineTotal: unitPrice * l.quantity,
      volumeDiscount: (ticketPrice - unitPrice) * l.quantity,
      unitCost: s.sales_model === 'DIRECT' ? s.unit_cost : null,
      shippingPolicyId: s.shipping_policy_id || null, bundleKey: s.bundle_group_key || null, shippingGroupKey: null,
      shippingFee: s.base_shipping_fee ?? 3000, freeThreshold: s.free_shipping_threshold ?? 30000,
      bps: s.commission_rate_bps ?? Math.round(Number(s.commission_rate || 10) * 100)
    });
  }

  // S-N01: any cross-border line makes PCCC mandatory (customs clearance).
  const orderRequiresPccc = resolved.some((it) => it.requiresPccc);
  if (orderRequiresPccc && !rawPccc && !dryRun) throw bad('PCCC_REQUIRED', '해외직구 상품이 포함되어 개인통관고유부호(PCCC)가 필요합니다.');

  // 2. Split by seller, then by shipping group (bundle key -> template -> seller default).
  // A fully template-free seller collapses to one 'default' group priced exactly the legacy way.
  function groupShipFee(tpl, goods, qty, fallbackFee, fallbackThreshold, zoneRemote) {
    const remote = tpl && tpl.remote_surcharge != null ? tpl.remote_surcharge : zoneRemote;
    if (!tpl) {
      const base = fallbackThreshold > 0 && goods >= fallbackThreshold ? 0 : fallbackFee;
      return { base, remote };
    }
    switch (tpl.fee_type) {
      case 'FREE': return { base: 0, remote };
      case 'CONDITIONAL': {
        const th = tpl.free_threshold;
        return { base: th != null && goods >= th ? 0 : tpl.base_fee, remote };
      }
      case 'PER_QTY': {
        const unit = tpl.qty_unit && tpl.qty_unit > 0 ? tpl.qty_unit : 1;
        return { base: tpl.base_fee * Math.ceil(qty / unit), remote };
      }
      case 'PAID':
      default: return { base: tpl.base_fee, remote };
    }
  }
  const orderId = newId('ord');
  const orderNo = newOrderNo();
  const groups = new Map();
  for (const it of resolved) {
    if (!groups.has(it.partnerId)) groups.set(it.partnerId, []);
    groups.get(it.partnerId).push(it);
  }
  const subs = [];
  let idx = 1;
  const { results: catRateRows } = await env.DB.prepare(
    'SELECT id, commission_rate_bps FROM categories WHERE commission_rate_bps IS NOT NULL'
  ).all();
  const catRates = new Map(catRateRows.map((r) => [r.id, r.commission_rate_bps]));
  const commBasePolicy = await getPolicy(env, 'commission.base');
  const pgFeeBpsRaw = await getPolicy(env, 'pg.fee_bps');
  const pgFeeBps = pgFeeBpsRaw != null && /^\d+$/.test(String(pgFeeBpsRaw)) && Number(pgFeeBpsRaw) <= 10000
    ? Number(pgFeeBpsRaw) : null;
  for (const [partnerId, its] of groups) {
    const { results: tplRows } = await env.DB.prepare(
      "SELECT * FROM shipping_policies WHERE partner_id = ? AND status = 'ACTIVE'"
    ).bind(partnerId).all();
    const templates = new Map(tplRows.map((r) => [r.id, r]));
    const bundles = new Map();
    for (const it of its) {
      const key = it.bundleKey || (it.shippingPolicyId ? `tpl:${it.shippingPolicyId}` : 'default');
      it.shippingGroupKey = key;
      if (!bundles.has(key)) bundles.set(key, []);
      bundles.get(key).push(it);
    }
    const breakdown = [];
    let shipTotal = 0;
    let maxProcessing = 0;
    let hasTemplate = false;
    for (const [key, lines] of bundles) {
      const gGoods = lines.reduce((a, it) => a + it.lineTotal, 0);
      const gQty = lines.reduce((a, it) => a + it.quantity, 0);
      const tpl = lines[0].shippingPolicyId ? templates.get(lines[0].shippingPolicyId) || null : null;
      if (tpl) {
        hasTemplate = true;
        if (tpl.processing_days > maxProcessing) maxProcessing = tpl.processing_days;
      }
      const { base, remote } = groupShipFee(tpl, gGoods, gQty, lines[0].shippingFee, lines[0].freeThreshold, remoteSurcharge);
      // NEW-20: the island surcharge rides on top even when base shipping is free, once per group.
      const fee = base + remote;
      shipTotal += fee;
      breakdown.push({ group_key: key, template_id: tpl ? tpl.id : null, fee_type: tpl ? tpl.fee_type : 'LEGACY',
        goods: gGoods, quantity: gQty, base_fee: base, remote_surcharge: remote, shipping: assertWon(fee, 'shipping') });
    }
    const goods = its.reduce((a, it) => a + it.lineTotal, 0);
    const commission = its[0].salesModel === 'MARKETPLACE' ? applyBps(goods, its[0].bps) : 0;
    subs.push({
      id: newId('sub'), no: `${orderNo}-${idx++}`, partnerId, salesModel: its[0].salesModel, bps: its[0].bps,
      goods, shipping: assertWon(shipTotal, 'shipping'), remoteSurcharge, remoteZone: remoteZoneName, commission, items: its,
      shippingGroups: breakdown, shipByDays: hasTemplate ? maxProcessing : null, feeSource: 'SELLER'
    });
  }
  const allItems = subs.flatMap((s) => s.items);
  const goodsAfterVolume = allItems.reduce((a, it) => a + it.lineTotal, 0);
  const goodsBase = allItems.reduce((a, it) => a + it.baseUnitPrice * it.quantity, 0);
  const volumeTotal = goodsBase - goodsAfterVolume;
  const shippingTotal = subs.reduce((a, s) => a + s.shipping, 0);

  // 3. Coupons: at most one platform coupon per order, one store coupon per seller.
  // Order: volume discount (already in lineTotal) -> store coupons -> platform coupon.
  // Legacy user_coupon_id/coupon_code requests apply as platform coupons.
  let coupon = 0;
  let userCouponId = null;
  const appliedStoreIds = new Map();
  allItems.forEach((it) => { it.storeCouponAlloc = 0; it.platformCouponAlloc = 0; it.sellerBurden = 0; });
  const legacyRef = body.user_coupon_id || body.coupon_code || null;
  const platformRef = body.platform_coupon_id || body.platform_coupon_code || null;
  if (legacyRef && platformRef && String(legacyRef) !== String(platformRef)) {
    throw conflict('COUPON_DUPLICATE_GROUP', '플랫폼 쿠폰은 주문당 1장까지 사용할 수 있습니다.');
  }
  const storeRefs = []
    .concat(body.store_coupon_ids || [], body.store_coupon_id ? [body.store_coupon_id] : [],
      body.store_coupon_codes || [], body.store_coupon_code ? [body.store_coupon_code] : [])
    .map(String);
  const storeCoupons = [];
  for (const ref of storeRefs) {
    const held = await loadHeldCouponByRef(env, principal.userId, ref);
    if (held.dup_group !== 'STORE') throw conflict('COUPON_DUPLICATE_GROUP', '스토어 쿠폰 칸에는 스토어 쿠폰만 사용할 수 있습니다.');
    if (appliedStoreIds.has(held.seller_id)) throw conflict('COUPON_DUPLICATE_GROUP', '판매자마다 스토어 쿠폰은 1장까지 사용할 수 있습니다.');
    appliedStoreIds.set(held.seller_id, held.user_coupon_id);
    storeCoupons.push(held);
  }
  for (const sc of storeCoupons) {
    const eligible = [];
    for (const it of allItems) {
      if (it.partnerId !== sc.seller_id) continue;
      if (await matchScope(env, sc, it)) eligible.push(it);
    }
    if (!eligible.length) throw conflict('COUPON_NOT_AVAILABLE', '쿠폰 적용 대상 상품이 주문에 없습니다.');
    const amount = couponAmount(sc, eligible.reduce((a, it) => a + it.lineTotal, 0));
    const parts = allocate(amount, eligible.map((it) => it.lineTotal));
    eligible.forEach((it, i) => { it.storeCouponAlloc = parts[i]; });
  }
  let platformCoupon = null;
  const platRef = platformRef || legacyRef;
  if (platRef) {
    platformCoupon = await loadHeldCouponByRef(env, principal.userId, platRef);
    if (platformCoupon.dup_group !== 'PLATFORM') throw conflict('COUPON_DUPLICATE_GROUP', '플랫폼 쿠폰 칸에는 플랫폼 쿠폰만 사용할 수 있습니다.');
    const eligible = [];
    for (const it of allItems) {
      if (await matchScope(env, platformCoupon, it)) eligible.push(it);
    }
    if (!eligible.length) throw conflict('COUPON_NOT_AVAILABLE', '쿠폰 적용 대상 상품이 주문에 없습니다.');
    const remain = (it) => it.lineTotal - it.storeCouponAlloc;
    const minBase = eligible.reduce((a, it) => a + it.lineTotal, 0);
    if (minBase < (platformCoupon.min_order_amount || 0)) {
      throw conflict('COUPON_MIN_ORDER', `쿠폰 최소 주문금액(${platformCoupon.min_order_amount}원) 미달입니다.`);
    }
    const targetSum = eligible.reduce((a, it) => a + remain(it), 0);
    const computed = platformCoupon.discount_type === 'PERCENT'
      ? applyBps(targetSum, platformCoupon.discount_value * 100) : platformCoupon.discount_value;
    let amount = computed;
    if (platformCoupon.max_discount_amount != null) amount = Math.min(amount, platformCoupon.max_discount_amount);
    amount = Math.min(assertWon(amount, 'coupon'), targetSum);
    const parts = allocate(amount, eligible.map(remain));
    eligible.forEach((it, i) => { it.platformCouponAlloc = parts[i]; });
    userCouponId = platformCoupon.user_coupon_id;
  }
  const platShare = platformCoupon ? platformCoupon.platform_share_bps : 10000;
  allItems.forEach((it) => {
    it.couponAlloc = it.storeCouponAlloc + it.platformCouponAlloc;
    it.net = it.lineTotal - it.couponAlloc;
    // Seller burden exists only on marketplace lines (there is no seller payout
    // to deduct from on direct lines, and the journal would not balance).
    it.sellerBurden = it.salesModel === 'MARKETPLACE'
      ? it.storeCouponAlloc + splitPlatformBurden(it.platformCouponAlloc, platShare).seller
      : 0;
  });
  coupon = allItems.reduce((a, it) => a + it.couponAlloc, 0);

  // 4. Credits (allocated over item nets and shipping lines)
  const payableBeforeCredit = goodsAfterVolume - coupon + shippingTotal;
  const requestedCredit = Number(body.use_credit_amount ?? body.use_credits ?? 0);
  if (!Number.isSafeInteger(requestedCredit) || requestedCredit < 0) throw bad('INVALID_CREDIT', '적립금 사용 금액이 올바르지 않습니다.');
  let credit = 0;
  if (requestedCredit > 0) {
    // NEW-P0-02: credits are verified-user money with a floor and a cap, so a
    // throwaway account can never 0-won an order (min 30,000원 goods, max 20% of
    // net goods excluding shipping).
    const viewer = await env.DB.prepare('SELECT email_verified FROM users WHERE id = ?').bind(principal.userId).first();
    if (!viewer || Number(viewer.email_verified) !== 1) throw new HttpError(403, 'CREDIT_UNVERIFIED', '이메일 인증 후 적립금을 사용할 수 있습니다.');
    if (goodsAfterVolume < 30000) throw conflict('CREDIT_MIN_ORDER', '적립금은 상품 주문금액 30,000원 이상부터 사용할 수 있습니다.');
    const bal = await env.DB.prepare('SELECT COALESCE(SUM(amount_delta), 0) AS b FROM user_credits WHERE user_id = ?').bind(principal.userId).first('b');
    if (requestedCredit > bal) throw conflict('CREDIT_INSUFFICIENT', `적립금 잔액(${bal}원)이 부족합니다.`);
    credit = Math.min(requestedCredit, Math.max(0, Math.floor((goodsAfterVolume - coupon) * 0.20)), payableBeforeCredit);
  }
  const creditWeights = [...allItems.map((it) => it.net), ...subs.map((s) => s.shipping)];
  const creditAllocs = allocate(credit, creditWeights);
  allItems.forEach((it, i) => { it.creditAlloc = creditAllocs[i]; it.pgAlloc = it.net - it.creditAlloc; });
  subs.forEach((s, j) => {
    s.shipCredit = creditAllocs[allItems.length + j];
    s.shipPg = s.shipping - s.shipCredit;
    s.couponAlloc = s.items.reduce((a, it) => a + it.couponAlloc, 0);
    s.sellerCouponBurden = s.items.reduce((a, it) => a + it.sellerBurden, 0);
    s.appliedStoreCouponId = appliedStoreIds.get(s.partnerId) || null;
    // 2-4: category rates win per item; the NET base needs store allocs, so the
    // override lands here. Without any category rate or base policy the legacy
    // single-call value above stands byte-identically.
    if (s.salesModel === 'MARKETPLACE' && (s.items.some((it) => catRates.has(it.categoryId)) || commBasePolicy != null)) {
      s.feeSource = s.items.every((it) => catRates.has(it.categoryId)) ? 'CATEGORY' : 'SELLER';
      const netBase = commBasePolicy === 'NET';
      s.commission = s.items.reduce((a, it) => {
        const bps = catRates.get(it.categoryId) ?? it.bps;
        const base = netBase ? it.lineTotal - it.storeCouponAlloc : it.lineTotal;
        return a + applyBps(base, bps);
      }, 0);
      // 4-15: when every line resolves to the same rate, snapshot it so the
      // stored rate matches the charged amount; mixed baskets keep the seller
      // base (per-line rates still drive the amount above).
      const itemBps = s.items.map((it) => catRates.get(it.categoryId) ?? it.bps);
      if (new Set(itemBps).size === 1) s.bps = itemBps[0];
    }
    const subPg = s.items.reduce((a, it) => a + it.pgAlloc, 0) + s.shipPg;
    s.pgFeeBps = pgFeeBps;
    s.pgFee = pgFeeBps == null ? 0 : applyBps(subPg, pgFeeBps);
    s.total = s.goods + s.shipping;
  });
  const pgTotal = allItems.reduce((a, it) => a + it.pgAlloc, 0) + subs.reduce((a, s) => a + s.shipPg, 0);
  if (goodsBase - volumeTotal - coupon - credit + shippingTotal !== pgTotal) throw new Error('MONEY_INVARIANT: order totals do not reconcile');
  if (dryRun) {
    const platformTotal = allItems.reduce((a, it) => a + it.platformCouponAlloc, 0);
    const itemsPgTotal = allItems.reduce((a, it) => a + it.pgAlloc, 0);
    const projected = await projectedCreditFor(env, itemsPgTotal);
    return { quote: {
      total_goods_amount: goodsBase, volume_discount_amount: volumeTotal, coupon_discount_amount: coupon, credit_used_amount: credit,
      platform_discount_amount: platformTotal,
      total_shipping_amount: shippingTotal, total_pay_amount: pgTotal, currency: 'KRW', requires_pccc: orderRequiresPccc, remote_zone: remoteZoneName,
      ...(projected == null ? {} : { projected_credit_amount: projected }),
      sub_orders: subs.map((s) => ({ partner_id: s.partnerId, sales_model: s.salesModel, goods_amount: s.goods, shipping_fee: s.shipping,
        store_discount_amount: s.items.reduce((a, it) => a + it.storeCouponAlloc, 0),
        remote_surcharge: s.remoteSurcharge, remote_zone: s.remoteZone, shipping_groups: s.shippingGroups, items: s.items.map((it) => ({ sku_id: it.skuId, title: it.title, option_summary: it.optionSummary, unit_price: it.unitPrice, base_unit_price: it.baseUnitPrice, quantity: it.quantity, line_total: it.lineTotal, volume_discount_pct: it.volumePct, requires_pccc: it.requiresPccc })) }))
    } };
  }

  // 5. FDS evaluation (Wave E): BLOCK refuses before anything is reserved; REVIEW/ALLOW persist the verdict.
  const now = sqlNow();
  const fdsPartnerIds = [...new Set(subs.map((s) => s.partnerId))];
  const fdsOwners = fdsPartnerIds.length
    ? (await env.DB.prepare(`SELECT owner_user_id o FROM partners WHERE id IN (${fdsPartnerIds.map(() => '?').join(',')})`).bind(...fdsPartnerIds).all()).results
    : [];
  const fds = await evaluateCheckoutFds(env, {
    userId: principal.userId, ip, ipCountry, amountKrw: pgTotal, recipientPhone: addr.phone,
    ownerIds: fdsOwners.map((r) => r.o).filter(Boolean), partnerIds: fdsPartnerIds,
    hsCodes: resolved.map((r) => r.hsCode)
  });
  if (fds.decision === 'BLOCK') {
    await auditStatement(env, principal, { action: 'FDS_BLOCK', targetType: 'order_attempt', targetId: orderNo,
      after: { amount_krw: pgTotal, score: fds.score, rules: fds.rules, ip: ip || null } }).run();
    throw new HttpError(403, 'FDS_BLOCKED', '이상거래 탐지 정책에 따라 주문이 차단되었습니다. 고객센터로 문의해 주세요.', { triggered_rules: fds.rules, risk_score: fds.score });
  }

  // 6. Atomic reservation batch
  const expiresAt = sqlNow(PAYMENT_WINDOW_MS);
  const st = [];
  st.push(env.DB.prepare(
    `INSERT INTO orders (id, order_no, customer_id, operator_entity_id, total_goods_amount, total_shipping_amount, total_discount_amount,
       volume_discount_amount, coupon_discount_amount, credit_used_amount, total_pay_amount, currency, payment_status,
       applied_user_coupon_id, checkout_idempotency_key, payment_expires_at, terms_version,
       recipient_name, recipient_phone, shipping_address_line1, shipping_address_line2, shipping_postal_code, shipping_memo,
       requested_delivery_date,
       pccc, pccc_verified, customs_duty_type, settlement_currency, fx_rate,
       fds_score, fds_decision, fds_rules_json, fds_decided_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'KRW', 'READY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'KRW', 1.0, ?, ?, ?, ?, ?, ?)`
  ).bind(orderId, orderNo, principal.userId, operator.id, goodsBase, shippingTotal, volumeTotal + coupon + credit,
    volumeTotal, coupon, credit, pgTotal, userCouponId, idemKey, expiresAt, operator.terms_version || null,
    addr.recipient, addr.phone, addr.line1, addr.line2, addr.postal, addr.memo, requestedDeliveryDate,
    await sealPii(env, rawPccc), rawPccc ? 1 : 0, body.customs_duty_type === 'DDP' ? 'DDP' : 'DDU',
    fds.score, fds.decision, JSON.stringify(fds.rules), now, now, now));

  for (const s of subs) {
    const shipBy = s.shipByDays == null ? null
      : new Date(Date.parse(`${now.replace(' ', 'T')}Z`) + s.shipByDays * 86400000).toISOString().slice(0, 10);
    st.push(env.DB.prepare(
      `INSERT INTO sub_orders (id, parent_order_id, sub_order_no, partner_id, sales_model, operator_entity_id, shipping_fee, goods_amount,
         discount_amount, total_amount, coupon_discount_allocated, shipping_credit_alloc, shipping_pg_alloc, status,
         confirmed_at, ship_by_deadline, shipping_breakdown_json, applied_store_coupon_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAYMENT_PENDING', NULL, ?, ?, ?)`
    ).bind(s.id, orderId, s.no, s.partnerId, s.salesModel, operator.id, s.shipping, s.goods, s.couponAlloc, s.total, s.couponAlloc, s.shipCredit, s.shipPg,
      shipBy, JSON.stringify(s.shippingGroups), s.appliedStoreCouponId));
    if (s.salesModel === 'MARKETPLACE') {
      st.push(env.DB.prepare(
        `INSERT INTO settlements (id, sub_order_id, partner_id, operator_entity_id, gross_amount, shipping_fee, commission_rate, commission_rate_bps,
           commission_amount, net_payout_amount, seller_coupon_burden, pg_fee_bps, pg_fee_amount, fee_source, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'HOLD')`
      ).bind(newId('stl'), s.id, s.partnerId, operator.id, s.goods, s.shipping, s.bps / 10000, s.bps, s.commission,
        s.goods - s.commission + s.shipping - s.sellerCouponBurden - s.pgFee, s.sellerCouponBurden,
        s.pgFeeBps, s.pgFee, s.feeSource));
    }
    for (const it of s.items) {
      st.push(env.DB.prepare(
        `INSERT INTO order_items (id, sub_order_id, sku_id, product_id, product_title, option_summary, base_unit_price, volume_discount_pct,
           unit_price, quantity, total_price, coupon_alloc, credit_alloc, pg_alloc, unit_cost, shipping_group_key,
           store_coupon_alloc, platform_coupon_alloc, seller_burden_amount, flash_sale_item_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(newId('itm'), s.id, it.skuId, it.productId, it.title, it.optionSummary, it.baseUnitPrice, it.volumePct,
        it.unitPrice, it.quantity, it.lineTotal, it.couponAlloc, it.creditAlloc, it.pgAlloc, it.unitCost, it.shippingGroupKey,
        it.storeCouponAlloc, it.platformCouponAlloc, it.sellerBurden, it.flashSaleItemId));
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
  const usedCouponIds = [...(userCouponId ? [userCouponId] : []), ...appliedStoreIds.values()];
  for (const ucid of usedCouponIds) {
    st.push(env.DB.prepare('UPDATE user_coupons SET is_used = 1, used_at = CURRENT_TIMESTAMP, used_order_id = ? WHERE id = ?').bind(orderId, ucid));
  }
  if (credit > 0) st.push(creditStatement(env, { userId: principal.userId, amount: -credit, reason: '주문 결제 적립금 사용(예약)', referenceId: orderId }));

  try {
    await runBatch(env, st);
  } catch (e) {
    if (idemKey && e instanceof HttpError && e.code === 'DUPLICATE_REQUEST') {
      const prev = await env.DB.prepare('SELECT * FROM orders WHERE customer_id = ? AND checkout_idempotency_key = ?').bind(principal.userId, idemKey).first();
      if (prev) {
        const split = await couponSplitForOrder(env, prev.id);
        return { replay: true, order: prev, platformDiscount: split.platform, storeDiscount: split.store,
          projectedCredit: await projectedCreditFor(env, split.itemsPg) };
      }
    }
    throw e;
  }

  let order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  if (pgTotal === 0) {
    await capturePayment(env, order, { provider: 'INTERNAL', paymentKey: null, amount: 0, sandbox: false, method: 'CREDIT_COUPON', approvedAt: new Date().toISOString(), raw: null });
    order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
  }
  const platformTotal = allItems.reduce((a, it) => a + it.platformCouponAlloc, 0);
  const storeTotal = allItems.reduce((a, it) => a + it.storeCouponAlloc, 0);
  const itemsPgTotal = allItems.reduce((a, it) => a + it.pgAlloc, 0);
  return { replay: false, order, subOrderCount: subs.length, platformDiscount: platformTotal, storeDiscount: storeTotal,
    projectedCredit: await projectedCreditFor(env, itemsPgTotal) };
}

// ---------------------------------------------------------------------------------------------
// Payment capture
// ---------------------------------------------------------------------------------------------
async function capturePayment(env, order, pg) {
  const bundle = await loadOrderBundle(env, order.id);
  const st = [];
  // 2-6: deal allocations move inside the capture batch; the trigger aborts over-sells.
  for (const it of bundle.items) {
    if (it.flash_sale_item_id) {
      st.push(env.DB.prepare('UPDATE flash_sale_items SET sold_stock = sold_stock + ? WHERE id = ?').bind(it.quantity, it.flash_sale_item_id));
    }
  }
  if (pg.amount > 0) {
    st.push(env.DB.prepare(
      `INSERT INTO payment_transactions (id, order_id, payment_key, provider, method, amount, currency, status, receipt_url, raw_response_json, approved_at, is_sandbox, card_summary)
       VALUES (?, ?, ?, ?, ?, ?, 'KRW', 'DONE', ?, ?, ?, ?, ?)`
    ).bind(newId('ptx'), order.id, pg.paymentKey, pg.provider, pg.method || 'CARD', pg.amount, pg.receiptUrl || null,
      pg.raw ? JSON.stringify(pg.raw) : null, pg.approvedAt, pg.sandbox ? 1 : 0, pg.cardSummary || null));
  }
  st.push(env.DB.prepare(
    `UPDATE orders SET payment_status = 'PAID', paid_at = CURRENT_TIMESTAMP, payment_key = ?, pg_provider = ?, pg_receipt_url = ?,
       is_sandbox = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(pg.paymentKey, pg.provider, pg.receiptUrl || null, pg.sandbox ? 1 : 0, order.id));
  st.push(env.DB.prepare("UPDATE sub_orders SET status = 'PAYMENT_CONFIRMED', updated_at = CURRENT_TIMESTAMP WHERE parent_order_id = ? AND status = 'PAYMENT_PENDING'").bind(order.id));
  // Wave E: REVIEW orders keep their settlements at HOLD until an operator clears the FDS review.
  if (order.fds_decision !== 'REVIEW') {
    st.push(env.DB.prepare("UPDATE settlements SET status = 'PENDING', updated_at = CURRENT_TIMESTAMP WHERE status = 'HOLD' AND sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)").bind(order.id));
  }

  // Journal: cash + credit liability + promotion = seller payable + commission + direct revenue.
  // Only the platform-funded coupon share is promotion expense; the seller-funded
  // share is already deducted from the seller payable (settlements.seller_coupon_burden).
  const platformPromo = bundle.items.reduce((a, i) => a + (i.coupon_alloc - i.seller_burden_amount), 0);
  const pgFeeTotal = bundle.subs.reduce((a, s) => a + (s.st_pg_fee || 0), 0);
  const lines = [
    { account: ACCOUNTS.PG_CLEARING, debit: order.total_pay_amount },
    { account: ACCOUNTS.CUSTOMER_CREDIT_LIABILITY, debit: order.credit_used_amount },
    { account: ACCOUNTS.PROMOTION_EXPENSE, debit: platformPromo },
    // 2-4: the seller-funded PG fee is owed to the PG through clearing (netted from remittance).
    { account: ACCOUNTS.PG_CLEARING, credit: pgFeeTotal }
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
  // J-2: sellers learn about paid orders by push (failures never fail capture).
  try {
    const partnerIds = [...new Set(bundle.subs.map((s) => s.partner_id))];
    if (partnerIds.length) {
      const { results: owners } = await env.DB.prepare(
        `SELECT id, owner_user_id FROM partners WHERE id IN (${partnerIds.map(() => '?').join(',')})`
      ).bind(...partnerIds).all();
      for (const o of owners) {
        if (!o.owner_user_id) continue;
        const mine = bundle.subs.filter((s) => s.partner_id === o.id);
        const count = bundle.items.filter((i) => mine.some((s) => s.id === i.sub_order_id)).reduce((a, i) => a + i.quantity, 0);
        await pushSellerNewOrder(env, { orderNo: order.order_no, userId: o.owner_user_id, itemCount: count });
      }
    }
  } catch { /* logged as FAILED inside notifyUser; capture already committed */ }
}

/**
 * Customer-initiated confirmation after the PG widget returns.
 * If PG approves but our commit fails (e.g. the order expired meanwhile), the PG payment is cancelled (compensation).
 */
export async function confirmPayment(env, principal, { orderRef, paymentKey, amount }, { ip = null } = {}) {
  if (typeof paymentKey !== 'string' || paymentKey.length < 8 || paymentKey.length > 200) throw bad('INVALID_PAYMENT_KEY', '결제키가 올바르지 않습니다.');
  if (!Number.isSafeInteger(amount)) throw bad('INVALID_AMOUNT', '결제 금액이 올바르지 않습니다.');
  const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ? OR order_no = ?').bind(orderRef, orderRef).first();
  if (!order) throw notFound('주문을 찾을 수 없습니다.');
  if (order.customer_id !== principal.userId) throw forbidden();
  if (order.payment_status === 'PAID' && order.payment_key === paymentKey) return { replay: true, order };
  if (order.payment_status !== 'READY') throw conflict('ORDER_NOT_PAYABLE', `결제할 수 없는 주문 상태입니다. (${order.payment_status})`);
  if (order.payment_expires_at && order.payment_expires_at < sqlNow()) throw conflict('ORDER_EXPIRED', '결제 가능 시간이 지났습니다. 다시 주문해 주세요.');
  if (amount !== order.total_pay_amount) throw bad('AMOUNT_MISMATCH', `결제 금액 불일치: 주문 ${order.total_pay_amount}원 / 요청 ${amount}원`);

  // 2-6: deal availability precheck — a clean 409 before the PG is touched.
  // The in-batch increment plus trigger backstop the true race below.
  const { results: dealLines } = await env.DB.prepare(
    `SELECT i.quantity, f.allocated_stock, f.sold_stock FROM order_items i
     JOIN flash_sale_items f ON f.id = i.flash_sale_item_id
     WHERE i.sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)`
  ).bind(order.id).all();
  for (const d of dealLines) {
    if (d.sold_stock + d.quantity > d.allocated_stock) {
      throw conflict('FLASH_SALE_SOLD_OUT', '특가 수량이 소진되었습니다.');
    }
  }

  const pg = await pgConfirm(env, { paymentKey, orderNo: order.order_no, amount: order.total_pay_amount });
  if (!pg.ok) {
    if (pg.approvedButMismatched) {
      await pgCancel(env, { paymentKey, amount: pg.raw.totalAmount, reason: 'Order/PG mismatch auto-cancel', idempotencyKey: `mismatch_${order.id}`, isSandbox: false }).catch(() => null);
    }
    // Wave E: every PG rejection is logged (velocity signal for RULE_01). The
    // attempted key stays out of the UNIQUE payment_key column (NULL + raw JSON).
    let failProvider = 'UNKNOWN';
    try { failProvider = paymentMode(env) === 'live' ? 'TOSS' : 'SANDBOX'; } catch { /* keep UNKNOWN */ }
    await env.DB.prepare(
      `INSERT INTO payment_transactions (id, order_id, provider, method, amount, currency, status, raw_response_json, failure_code, attempt_ip)
       VALUES (?, ?, ?, 'UNKNOWN', ?, 'KRW', 'FAILED', ?, ?, ?)`
    ).bind(newId('ptx'), order.id, failProvider, order.total_pay_amount,
      JSON.stringify({ attempted_payment_key: String(paymentKey).slice(0, 200), code: pg.code, message: String(pg.message || '').slice(0, 300) }),
      String(pg.code || 'PG_CONFIRM_REJECTED').slice(0, 80), ip).run().catch(() => null);
    throw new HttpError(402, pg.code, pg.message);
  }
  try {
    await capturePayment(env, order, { provider: pg.sandbox ? 'SANDBOX' : 'TOSS', paymentKey, amount: order.total_pay_amount, sandbox: pg.sandbox, method: pg.method, approvedAt: pg.approvedAt, receiptUrl: pg.receiptUrl, raw: pg.raw, cardSummary: pg.cardSummary || null });
  } catch (e) {
    const fresh = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first();
    if (fresh && fresh.payment_status === 'PAID' && fresh.payment_key === paymentKey) return { replay: true, order: fresh };
    const comp = await pgCancel(env, { paymentKey, amount: order.total_pay_amount, reason: '주문 확정 실패 자동취소', idempotencyKey: `comp_${order.id}`, isSandbox: pg.sandbox }).catch((err) => ({ ok: false, message: err.message }));
    await env.DB.prepare(
      `INSERT INTO payment_events (id, provider, event_key, event_type, order_id, payment_key, verified, outcome, payload_json)
       VALUES (?, ?, ?, 'CAPTURE_COMPENSATION', ?, ?, 1, ?, ?)`
    ).bind(newId('pev'), pg.sandbox ? 'SANDBOX' : 'TOSS', `comp:${order.id}:${paymentKey}`, order.id, paymentKey,
      comp.ok ? 'PG_CANCELLED' : 'PG_CANCEL_FAILED_MANUAL_ACTION', JSON.stringify({ error: String(e.message), comp })).run().catch(() => null);
    if (String(e.message).includes('FLASH_SALE_SOLD_OUT')) {
      throw conflict('FLASH_SALE_SOLD_OUT', '특가 수량이 소진되었습니다.');
    }
    throw conflict('PAYMENT_COMPENSATED', comp.ok ? '주문 확정에 실패하여 결제가 자동 취소되었습니다.' : '주문 확정에 실패했습니다. 결제 취소가 수동 처리됩니다.');
  }
  return { replay: false, order: await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(order.id).first() };
}

/** Used by verified webhooks: capture a READY order, or compensate if it can no longer be captured. */
export async function captureFromVerifiedPg(env, order, pgPayment, { sandbox = false } = {}) {
  if (order.payment_status === 'PAID') return order.payment_key === pgPayment.paymentKey ? 'ALREADY_CAPTURED' : 'CONFLICT_OTHER_KEY';
  const okAmount = pgPayment.totalAmount === order.total_pay_amount && pgPayment.orderId === order.order_no;
  if (order.payment_status === 'READY' && okAmount) {
    await capturePayment(env, order, { provider: sandbox ? 'SANDBOX' : 'TOSS', paymentKey: pgPayment.paymentKey, amount: order.total_pay_amount, sandbox, method: pgPayment.method, approvedAt: pgPayment.approvedAt || new Date().toISOString(), receiptUrl: pgPayment.receipt?.url || null, raw: pgPayment, cardSummary: sandbox ? 'TestCard ****-****-****-0000' : cardSummaryOf(pgPayment) });
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
  const releaseLines = b.items.map((it) => ({ it, qty: it.quantity }));
  const releaseRestock = await restockTransitions(env, releaseLines);
  const st = [
    env.DB.prepare('UPDATE orders SET payment_status = ?, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(target, b.order.id),
    env.DB.prepare('UPDATE sub_orders SET status = ?, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE parent_order_id = ?').bind(subStatus, b.order.id),
    env.DB.prepare("UPDATE settlements SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE sub_order_id IN (SELECT id FROM sub_orders WHERE parent_order_id = ?)").bind(b.order.id)
  ];
  st.push(...restockStatements(env, b.order.id, releaseLines, 'ORDER_CANCEL', `release:${b.order.id}`));
  if (b.order.applied_user_coupon_id) {
    st.push(env.DB.prepare('UPDATE user_coupons SET is_used = 0, used_at = NULL, used_order_id = NULL WHERE id = ? AND used_order_id = ?').bind(b.order.applied_user_coupon_id, b.order.id));
  }
  if (b.order.credit_used_amount > 0) {
    st.push(creditStatement(env, { userId: b.order.customer_id, amount: b.order.credit_used_amount, reason: target === 'EXPIRED' ? '결제 시간 만료 적립금 복원' : '결제 전 취소 적립금 복원', referenceId: `restore:${b.order.id}` }));
  }
  await runBatch(env, st);
  try {
    await notifyRestockedSkus(env, releaseRestock);
  } catch { /* restock notify must never fail the release */ }
}

/** K-05: per-SKU 0 -> positive transitions for an upcoming restock (qty aggregated per SKU). */
async function restockTransitions(env, lines) {
  const qtyBySku = new Map();
  for (const { it, qty } of lines) {
    if (!it || qty <= 0) continue;
    qtyBySku.set(it.sku_id, (qtyBySku.get(it.sku_id) || 0) + qty);
  }
  const out = [];
  for (const [skuId, qty] of qtyBySku) {
    const row = await env.DB.prepare('SELECT stock_quantity FROM product_skus WHERE id = ?').bind(skuId).first();
    const before = Number(row?.stock_quantity) || 0;
    out.push({ skuId, before, after: before + qty });
  }
  return out;
}

function restockStatements(env, orderId, lines, changeType, keyPrefix, { restoreDeals = false } = {}) {
  const st = [];
  for (const { it, qty } of lines) {
    if (qty <= 0) continue;
    st.push(env.DB.prepare(
      `UPDATE product_skus SET stock_quantity = stock_quantity + ?, status = CASE WHEN stock_quantity + ? > 0 THEN 'IN_STOCK' ELSE status END,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(qty, qty, it.sku_id));
    // 2-6: deal allocations restore only when they were taken (paid flows).
    // Unpaid release never incremented, so it must not decrement.
    if (restoreDeals && it.flash_sale_item_id) {
      st.push(env.DB.prepare(
        'UPDATE flash_sale_items SET sold_stock = sold_stock - ? WHERE id = ?'
      ).bind(qty, it.flash_sale_item_id));
    }
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
 *            subStatusOnFull: 'CANCELLED'|'RETURNED', orderStatusOnFull: 'CANCELLED'|'REFUNDED', restoreCoupon,
 *            returnFee }   // O14: customer-fault return courier fee withheld from this refund (requires subOrderId)
 * Money identity per refund: pg_amount + credit_amount + return_fee_amount = refunded item shares + refunded shipping shares.
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
    const storePart = proportionalPortion(it.store_coupon_alloc, it.refunded_store_coupon_amount, qty, it.quantity, it.refunded_quantity);
    const platPart = proportionalPortion(it.platform_coupon_alloc, it.refunded_platform_coupon_amount, qty, it.quantity, it.refunded_quantity);
    const cpPart = storePart + platPart;
    const platBurden = it.seller_burden_amount - it.store_coupon_alloc;
    const restoredPlatBurden = it.refunded_seller_burden_amount - it.refunded_store_coupon_amount;
    const platSellerPart = proportionalPortion(platBurden, restoredPlatBurden, qty, it.quantity, it.refunded_quantity);
    const burdenPart = storePart + platSellerPart;
    const platFundedPart = platPart - platSellerPart;
    plan.push({ it, qty, pgPart, crPart, cpPart, storePart, platPart, burdenPart, platFundedPart, goods: pgPart + crPart + cpPart });
  }
  const shipSubs = (request.shippingSubOrderIds || []).map((id) => b.subs.find((s) => s.id === id)).filter((s) => s && !s.shipping_refunded && s.shipping_fee > 0);
  if (!plan.length && !shipSubs.length) throw bad('NOTHING_TO_REFUND', '환불할 항목이 없습니다.');

  const pgGross = plan.reduce((a, p) => a + p.pgPart, 0) + shipSubs.reduce((a, s) => a + s.shipping_pg_alloc, 0);
  const creditGross = plan.reduce((a, p) => a + p.crPart, 0) + shipSubs.reduce((a, s) => a + s.shipping_credit_alloc, 0);
  // Return fee: taken from the cash refund first, then from the credit refund; never more than is being refunded.
  const feeAsked = Number(request.returnFee || 0);
  if (!Number.isSafeInteger(feeAsked) || feeAsked < 0) throw new Error('REFUND_INVARIANT: returnFee must be a non-negative integer');
  if (feeAsked > 0 && !request.subOrderId) throw new Error('REFUND_INVARIANT: returnFee requires subOrderId');
  const returnFee = Math.min(feeAsked, pgGross + creditGross);
  const feeFromPg = Math.min(returnFee, pgGross);
  const pg = pgGross - feeFromPg;
  const credit = creditGross - (returnFee - feeFromPg);
  const coupon = plan.reduce((a, p) => a + p.cpPart, 0);
  const couponPlatform = plan.reduce((a, p) => a + p.platFundedPart, 0);
  const goods = plan.reduce((a, p) => a + p.goods, 0);
  const shipping = shipSubs.reduce((a, s) => a + s.shipping_fee, 0);
  const refundId = newId('rfd');
  const itemsJson = JSON.stringify(plan.map((p) => ({ order_item_id: p.it.id, sub_order_id: p.it.sub_order_id, sku_id: p.it.sku_id, quantity: p.qty, pg: p.pgPart, credit: p.crPart, coupon: p.cpPart, store_coupon: p.storePart, platform_coupon: p.platPart })).concat(shipSubs.map((s) => ({ shipping_sub_order_id: s.id, pg: s.shipping_pg_alloc, credit: s.shipping_credit_alloc, amount: s.shipping_fee }))));

  // Phase 1: reserve (caps enforced by triggers/CHECKs; concurrent over-refund aborts here)
  const reserve = [
    env.DB.prepare(
      `INSERT INTO refunds (id, order_id, sub_order_id, claim_id, operator_entity_id, reason_code, goods_amount, shipping_amount, coupon_reversal_amount,
         pg_amount, credit_amount, return_fee_amount, items_json, status, is_sandbox, idempotency_key, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`
    // goods_amount is the NET goods value returned to the customer (DB CHECK: goods + shipping = coupon + pg + credit);
    // the gross identity incl. the withheld fee is verified by reconciliation R20.
    ).bind(refundId, o.id, request.subOrderId || null, request.claimId || null, o.operator_entity_id, request.reasonCode, goods - returnFee, shipping, coupon, pg, credit, returnFee, itemsJson, o.is_sandbox, idemKey, actor.userId),
    env.DB.prepare('UPDATE orders SET refunded_pg_amount = refunded_pg_amount + ?, refunded_credit_amount = refunded_credit_amount + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(pg, credit, o.id)
  ];
  for (const p of plan) {
    reserve.push(env.DB.prepare(
      `UPDATE order_items SET refunded_quantity = refunded_quantity + ?, refunded_pg_amount = refunded_pg_amount + ?,
         refunded_credit_amount = refunded_credit_amount + ?, refunded_coupon_amount = refunded_coupon_amount + ?,
         refunded_store_coupon_amount = refunded_store_coupon_amount + ?, refunded_platform_coupon_amount = refunded_platform_coupon_amount + ?,
         refunded_seller_burden_amount = refunded_seller_burden_amount + ? WHERE id = ?`
    ).bind(p.qty, p.pgPart, p.crPart, p.cpPart, p.storePart, p.platPart, p.burdenPart, p.it.id));
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
           refunded_credit_amount = refunded_credit_amount - ?, refunded_coupon_amount = refunded_coupon_amount - ?,
           refunded_store_coupon_amount = refunded_store_coupon_amount - ?, refunded_platform_coupon_amount = refunded_platform_coupon_amount - ?,
           refunded_seller_burden_amount = refunded_seller_burden_amount - ? WHERE id = ?`
      ).bind(p.qty, p.pgPart, p.crPart, p.cpPart, p.storePart, p.platPart, p.burdenPart, p.it.id));
    }
    for (const s of shipSubs) release.push(env.DB.prepare('UPDATE sub_orders SET shipping_refunded = 0 WHERE id = ?').bind(s.id));
    await runBatch(env, release);
    throw new HttpError(502, 'PG_REFUND_FAILED', 'PG 환불 요청이 실패했습니다. 잠시 후 다시 시도해 주세요.', { refund_id: refundId });
  }

  // Phase 3: finalize
  const after = await loadOrderBundle(env, o.id);
  const fin = [env.DB.prepare("UPDATE refunds SET status = 'DONE', pg_transaction_key = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(pgRes.transactionKey, refundId)];
  // Wave E: any finalized refund voids the receipt basis — unissued requests die
  // silently, issued receipts wait for the operator's PG-console cancellation.
  fin.push(env.DB.prepare(
    `UPDATE tax_invoices SET issue_status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP, memo = '환불 확정으로 자동 취소(미발행)'
     WHERE order_id = ? AND invoice_type = 'CASH_RECEIPT' AND issue_status = 'REQUESTED'`).bind(o.id));
  fin.push(env.DB.prepare(
    `UPDATE tax_invoices SET issue_status = 'CANCEL_REQUIRED', memo = ?
     WHERE order_id = ? AND invoice_type = 'CASH_RECEIPT' AND issue_status = 'ISSUED'`).bind(`환불 ${refundId} 확정 — PG 콘솔 취소 후 cancel-record로 기록`, o.id));
  if (credit > 0) fin.push(creditStatement(env, { userId: o.customer_id, amount: credit, reason: '환불 적립금 복원', referenceId: refundId }));
  const refundLines = plan.map((p) => ({ it: p.it, qty: p.qty }));
  const refundRestock = request.restock ? await restockTransitions(env, refundLines) : [];
  if (request.restock) fin.push(...restockStatements(env, o.id, refundLines, request.reasonCode === 'RETURN' ? 'RETURN_RESTOCK' : 'ORDER_CANCEL', `restock:${refundId}`, { restoreDeals: true }));

  const journal = [
    { account: ACCOUNTS.PG_CLEARING, credit: pg },
    { account: ACCOUNTS.CUSTOMER_CREDIT_LIABILITY, credit },
    { account: ACCOUNTS.PROMOTION_EXPENSE, credit: couponPlatform }
  ];
  const touchedSubIds = new Set([...plan.map((p) => p.it.sub_order_id), ...shipSubs.map((s) => s.id)]);
  const warnings = [];
  for (const sid of touchedSubIds) {
    const s = after.subs.find((x) => x.id === sid);
    const goodsRefund = plan.filter((p) => p.it.sub_order_id === sid).reduce((a, p) => a + p.goods, 0);
    const shipRefund = shipSubs.some((x) => x.id === sid) ? s.shipping_fee : 0;
    const feeHere = sid === request.subOrderId ? returnFee : 0;
    if (s.sales_model === 'MARKETPLACE' && s.settlement_id) {
      const adj = await env.DB.prepare('SELECT COALESCE(SUM(gross_delta),0) g, COALESCE(SUM(commission_delta),0) c, COALESCE(SUM(shipping_delta),0) sh FROM settlement_adjustments WHERE settlement_id = ?').bind(s.settlement_id).first();
      const grossNow = s.st_gross + adj.g;
      const commNow = s.st_commission + adj.c;
      const grossNew = grossNow - goodsRefund;
      const commDelta = applyBps(grossNew, s.st_bps) - commNow;
      const shipDelta = -shipRefund + feeHere; // seller keeps the return-shipping fee it pays the courier with
      const burdenRestored = plan.filter((p) => p.it.sub_order_id === sid).reduce((a, p) => a + p.burdenPart, 0);
      const netDelta = -goodsRefund - commDelta + shipDelta + burdenRestored;
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
      journal.push({ account: ACCOUNTS.DIRECT_SALES_REVENUE, debit: goodsRefund + shipRefund - feeHere, sub_order_id: sid, partner_id: s.partner_id, memo: feeHere ? `return fee ${feeHere}` : undefined });
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
  if (full && request.restoreCoupon) {
    for (const s of after.subs) {
      if (s.applied_store_coupon_id) {
        fin.push(env.DB.prepare('UPDATE user_coupons SET is_used = 0, used_at = NULL, used_order_id = NULL WHERE id = ? AND used_order_id = ?').bind(s.applied_store_coupon_id, o.id));
      }
    }
  }
  if (request.claimId) {
    fin.push(env.DB.prepare("UPDATE returns SET status = 'REFUNDED', refund_amount = ?, refund_id = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(pg + credit, refundId, actor.userId, request.claimId));
  }
  await runBatch(env, fin);
  try {
    if (refundRestock.length) await notifyRestockedSkus(env, refundRestock);
  } catch { /* restock notify must never fail the refund */ }
  const refund = await env.DB.prepare('SELECT * FROM refunds WHERE id = ?').bind(refundId).first();
  try {
    await pushRefundCompleted(env, {
      orderNo: o.order_no, customerId: o.customer_id,
      amount: (Number(refund.pg_amount) || 0) + (Number(refund.credit_amount) || 0)
    });
  } catch { /* push must never fail the refund */ }
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
export async function cancelSubOrder(env, actor, orderRef, subOrderId, { isAdmin = false, lines = null, idemKey = null } = {}) {
  const b = await loadOrderBundle(env, orderRef);
  if (!b) throw notFound('주문을 찾을 수 없습니다.');
  if (!isAdmin && b.order.customer_id !== actor.userId) throw forbidden();
  const s = b.subs.find((x) => x.id === subOrderId || x.sub_order_no === subOrderId);
  if (!s) throw notFound('판매자 주문을 찾을 수 없습니다.');
  if (!PRE_SHIPMENT.includes(s.status) || s.status === 'PAYMENT_PENDING') {
    throw conflict('SUB_ORDER_NOT_CANCELLABLE', `취소할 수 없는 상태입니다. (${s.status})`);
  }
  // O14: quantity-level cancel before shipment. Shipping is refunded only when nothing of the sub-order is left to ship.
  if (lines && lines.length) {
    const subItems = b.items.filter((i) => i.sub_order_id === s.id);
    const norm = new Map();
    for (const l of lines) {
      const it = subItems.find((i) => i.id === String(l.order_item_id));
      const q = Number(l.quantity);
      if (!it || !Number.isSafeInteger(q) || q < 1) throw bad('INVALID_ITEMS', '취소할 상품과 수량을 확인해 주세요.');
      norm.set(it.id, (norm.get(it.id) || 0) + q);
    }
    for (const [id, q] of norm) {
      const it = subItems.find((i) => i.id === id);
      if (q > it.quantity - it.refunded_quantity) throw conflict('REFUND_EXCEEDS_PAID', '취소 가능 수량을 초과했습니다.', { order_item_id: id, remaining: it.quantity - it.refunded_quantity });
    }
    const leavesNothing = subItems.every((i) => i.quantity - i.refunded_quantity - (norm.get(i.id) || 0) === 0);
    if (!leavesNothing && s.sales_model === 'DIRECT') {
      const po = await env.DB.prepare("SELECT COUNT(*) c FROM purchase_orders WHERE sub_order_id = ? AND status != 'CANCELLED'").bind(s.id).first('c');
      if (po > 0) throw conflict('SUPPLIER_PO_EXISTS', '공급사 발주서가 생성된 직영 주문은 일부 수량만 취소할 수 없습니다. 전체 취소하거나 고객센터에 문의해 주세요.');
    }
    // Idempotency key = request content + current refund state: a double click replays, a later "cancel one more" does not.
    const state = [...norm.keys()].sort().map((id) => `${id}x${norm.get(id)}@${subItems.find((i) => i.id === id).refunded_quantity}`).join(',');
    const r = await refundOrder(env, actor, b.order.id, {
      lines: [...norm].map(([order_item_id, quantity]) => ({ order_item_id, quantity })), shippingSubOrderIds: leavesNothing ? [s.id] : [], subOrderId: s.id,
      reasonCode: 'CUSTOMER_QTY_CANCEL', restock: true, idemKey: idemKey ? `qcancel:${s.id}:key:${idemKey}` : `qcancel:${s.id}:${state}`, orderStatusOnFull: 'CANCELLED', restoreCoupon: false
    });
    return { status: r.orderStatus, refund: r.refund, warnings: r.warnings, replay: r.replay, partial: !leavesNothing };
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
