// apps/cloudflare-gateway/src/services/fees.js
// Fee engine (work order 2-2): the single home for commission math.
// Priority: seller schedule > category schedule > partner row (default 10%),
// each schedule honored only inside its validity window (no retroactive use).
// Money stays integer KRW via lib/money.js.

import { applyBps, assertWon } from '../lib/money.js';
import { bad, conflict } from '../lib/http.js';
import { newId, sqlNow } from '../lib/ids.js';

export const DEFAULT_COMMISSION_BPS = 1000;
// Safeguard: seller deductions never exceed 60% of the line sale amount.
// "Margin" here is the sale amount itself: per-order supply costs are not
// tracked, so no narrower margin is computable (see Q-2-2).
export const SAFEGUARD_RATIO_BP = 6000;
export const FEE_NOTICE_DAYS = 7;
const NOTICE_MS = FEE_NOTICE_DAYS * 86400 * 1000;

const normBps = (bps) => {
  const n = Number(bps);
  if (!Number.isSafeInteger(n) || n < 0 || n > 10000) throw bad('BAD_RATE', '수수료율은 0~10000bp 정수여야 합니다.');
  return n;
};

const toMs = (v) => {
  if (v instanceof Date) return v.getTime();
  const t = Date.parse(String(v).includes('T') ? String(v) : `${String(v).replace(' ', 'T')}Z`);
  if (Number.isNaN(t)) throw bad('BAD_TIME', '시각 형식이 올바르지 않습니다.');
  return t;
};

/** Applicable seller rate at `at`: dated seller schedule, else dated category schedule, else the row rate. */
export async function resolveSellerBps(env, { partnerId, categoryId = null, rowBps = DEFAULT_COMMISSION_BPS, at = sqlNow() }) {
  const seller = await env.DB.prepare(
    `SELECT rate_bp FROM partner_fees
     WHERE partner_id = ? AND is_active = 1 AND valid_from <= ? AND (valid_to IS NULL OR ? <= valid_to)
     ORDER BY valid_from DESC LIMIT 1`
  ).bind(partnerId, at, at).first();
  if (seller) return normBps(seller.rate_bp);
  if (categoryId) {
    const cat = await env.DB.prepare(
      `SELECT rate_bp FROM fee_schedules
       WHERE category_id = ? AND is_active = 1 AND valid_from <= ? AND (valid_to IS NULL OR ? <= valid_to)
       ORDER BY valid_from DESC LIMIT 1`
    ).bind(categoryId, at, at).first();
    if (cat) return normBps(cat.rate_bp);
  }
  return normBps(rowBps ?? DEFAULT_COMMISSION_BPS);
}

/** PG fee for a payment method. Pass-through stays off until 결정-03. */
export async function pgFeeFor(env, { method, amount }) {
  const pol = method
    ? await env.DB.prepare('SELECT rate_bp, fixed_fee, pass_to_seller FROM pg_fee_policies WHERE method = ? AND is_active = 1 LIMIT 1').bind(method).first()
    : null;
  if (!pol) return { fee: 0, passed: 0, method: method || null };
  const fee = applyBps(assertWon(amount, 'amount'), normBps(pol.rate_bp)) + assertWon(Number(pol.fixed_fee) || 0, 'fixed_fee');
  return { fee, passed: Number(pol.pass_to_seller) === 1 ? fee : 0, method };
}

/**
 * Sub-order commission. Uniform rates take the exact legacy one-shot formula
 * (no 1-won drift); mixed per-line rates sum per line. Non-marketplace lines
 * pay nothing. `at` is the order time so old orders use their own schedules.
 */
export async function feeForSub(env, { partnerId, lines, rowBps, at = sqlNow(), salesModel = 'MARKETPLACE', method = null }) {
  const goods = lines.reduce((a, l) => a + assertWon(l.goods, 'line goods'), 0);
  if (salesModel !== 'MARKETPLACE' || goods === 0 || lines.length === 0) {
    return { commission: 0, bps: 0, uniform: true, capped: false, pg: { fee: 0, passed: 0, method }, goods };
  }
  const perLine = [];
  for (const l of lines) {
    perLine.push(await resolveSellerBps(env, { partnerId, categoryId: l.categoryId ?? null, rowBps, at }));
  }
  const uniform = perLine.every((b) => b === perLine[0]);
  let commission = uniform
    ? applyBps(goods, perLine[0])
    : lines.reduce((a, l, i) => a + applyBps(l.goods, perLine[i]), 0);
  const pg = await pgFeeFor(env, { method, amount: goods });
  const cap = Math.floor((goods * SAFEGUARD_RATIO_BP) / 10000);
  let capped = false;
  if (commission + pg.passed > cap) {
    commission = Math.max(0, cap - pg.passed);
    capped = true;
  }
  const bps = uniform ? perLine[0] : (goods > 0 ? Math.round((commission * 10000) / goods) : 0);
  return { commission, bps, uniform, capped, pg, goods };
}

/** Schedule a seller rate change. Takes effect no sooner than 7 days out, never retroactively. */
export async function schedulePartnerFee(env, { partnerId, rateBp, validFrom, now = sqlNow() }) {
  const bp = normBps(rateBp);
  if (toMs(validFrom) - toMs(now) < NOTICE_MS) {
    throw conflict('NOTICE_TOO_SHORT', '판매자 수수료 변경은 7일 전에 고지해야 합니다.');
  }
  const id = newId('pf');
  await env.DB.prepare(
    'INSERT INTO partner_fees (id, partner_id, rate_bp, valid_from, is_active) VALUES (?, ?, ?, ?, 1)'
  ).bind(id, partnerId, bp, validFrom).run();
  return { id, partner_id: partnerId, rate_bp: bp, valid_from: validFrom };
}

async function expectedSubCommission(env, sub, orderAt) {
  const partner = await env.DB.prepare('SELECT commission_rate_bps, commission_rate, sales_model FROM partners WHERE id = ?').bind(sub.partner_id).first();
  if (!partner) throw notFoundOrder(sub.parent_order_id);
  const { results: items } = await env.DB.prepare(
    `SELECT oi.total_price AS goods, pr.category_id AS category_id
     FROM order_items oi JOIN product_skus s ON s.id = oi.sku_id JOIN products pr ON pr.id = s.product_id
     WHERE oi.sub_order_id = ?`
  ).bind(sub.id).all();
  const lines = (items || []).map((it) => ({ goods: Number(it.goods) || 0, categoryId: it.category_id || null }));
  const rowBps = partner.commission_rate_bps ?? Math.round(Number(partner.commission_rate || 10) * 100);
  const fee = await feeForSub(env, {
    partnerId: sub.partner_id,
    lines: lines.length ? lines : [{ goods: Number(sub.goods_amount) || 0, categoryId: null }],
    rowBps,
    at: orderAt,
    salesModel: partner.sales_model || 'MARKETPLACE'
  });
  return fee.commission;
}

function notFoundOrder(id) {
  const e = new Error(`주문을 찾을 수 없습니다: ${id}`);
  e.code = 'ORDER_NOT_FOUND';
  e.status = 404;
  return e;
}

/**
 * Verify-only batch: recompute what each order's commission should have been
 * under the schedules valid at its own time and compare with the recorded
 * settlements. Never rewrites history (no retroactive application).
 * Processes `batchSize` ids per chunk; failures alarm via onAlarm (default:
 * server log) without stopping the batch; every failure is recorded.
 */
export async function recalcBatch(env, { orderIds, batchSize = 1000, onAlarm = null }) {
  const alarm = onAlarm || ((a) => console.error(`[fees-recalc] ${a.orderId}: ${a.error}`));
  const ids = [...new Set(orderIds || [])];
  const report = { processed: 0, matched: 0, mismatched: [], failed: [], chunks: 0 };
  for (let i = 0; i < ids.length; i += Math.max(1, batchSize)) {
    report.chunks += 1;
    for (const orderId of ids.slice(i, i + Math.max(1, batchSize))) {
      try {
        const order = await env.DB.prepare('SELECT id, created_at FROM orders WHERE id = ?').bind(orderId).first();
        if (!order) throw notFoundOrder(orderId);
        const { results: subs } = await env.DB.prepare('SELECT * FROM sub_orders WHERE parent_order_id = ?').bind(orderId).all();
        let expected = 0;
        let recorded = 0;
        for (const sub of subs || []) {
          const st = await env.DB.prepare('SELECT commission_amount FROM settlements WHERE sub_order_id = ?').bind(sub.id).first();
          if (!st) throw Object.assign(new Error(`정산 행 없음: ${sub.id}`), { code: 'NO_SETTLEMENT' });
          recorded += Number(st.commission_amount) || 0;
          expected += await expectedSubCommission(env, sub, order.created_at);
        }
        report.processed += 1;
        if (expected === recorded) report.matched += 1;
        else report.mismatched.push({ orderId, expected, recorded });
      } catch (e) {
        const entry = { orderId, error: e?.message || String(e), code: e?.code || 'RECALC_FAILED' };
        report.failed.push(entry);
        alarm(entry);
      }
    }
  }
  return report;
}
