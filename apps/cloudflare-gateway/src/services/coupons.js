// apps/cloudflare-gateway/src/services/coupons.js
// Coupon engine (work order 2-3): platform/store split over the d1_53 tables.
// One coupon per order; store coupons discount only their seller's lines and
// reduce that seller's payout, platform coupons are operator-funded. Invalid
// coupons share one error code so code existence never leaks.

import { applyBps, allocate, assertWon } from '../lib/money.js';
import { bad, conflict, notFound } from '../lib/http.js';
import { newId, sqlNow } from '../lib/ids.js';

const unavailable = () => conflict('COUPON_NOT_AVAILABLE', '사용할 수 있는 쿠폰이 아닙니다. (미보유·사용완료·만료)');

/** Issue a definition to a user. Per-user and total limits enforced atomically. */
export async function issueCoupon(env, { definitionId, userId, at = sqlNow() }) {
  const def = await env.DB.prepare(
    `SELECT * FROM coupon_definitions WHERE id = ? AND is_active = 1
     AND (valid_from IS NULL OR valid_from <= ?) AND (valid_to IS NULL OR ? <= valid_to)`
  ).bind(definitionId, at, at).first();
  if (!def) throw unavailable();
  const id = newId('ci');
  // Atomic gates: the row lands only while both limits hold. One statement,
  // so concurrent issuers cannot jointly overshoot either cap.
  const ins = await env.DB.prepare(
    `INSERT INTO coupon_issued (id, definition_id, user_id, status)
     SELECT ?, ?, ?, 'ISSUED'
     WHERE (SELECT COUNT(*) FROM coupon_issued WHERE definition_id = ? AND user_id = ? AND status != 'REVOKED')
             < COALESCE((SELECT per_user_limit FROM coupon_definitions WHERE id = ?), 1)
       AND ((SELECT total_limit FROM coupon_definitions WHERE id = ?) IS NULL
         OR (SELECT COUNT(*) FROM coupon_issued WHERE definition_id = ?) < (SELECT total_limit FROM coupon_definitions WHERE id = ?))`
  ).bind(id, definitionId, userId, definitionId, userId, definitionId, definitionId, definitionId, definitionId).run();
  if ((ins.meta?.changes ?? 0) !== 1) {
    const mine = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM coupon_issued WHERE definition_id = ? AND user_id = ? AND status != 'REVOKED'"
    ).bind(definitionId, userId).first('c');
    if (mine >= (def.per_user_limit ?? 1)) throw conflict('COUPON_LIMIT', '받을 수 있는 수량을 초과했습니다.');
    throw conflict('COUPON_SOLD_OUT', '쿠폰이 모두 소진되었습니다.');
  }
  return { id, definition_id: definitionId, user_id: userId, status: 'ISSUED' };
}

/**
 * Validate one coupon against order lines. Returns the discount, per-line
 * allocations (single discount source per line) and the seller-absorbed part.
 * lines: [{ goods, partnerId }].
 */
export async function validateCoupon(env, { ref, userId, lines, at = sqlNow() }) {
  const key = String(ref || '').trim();
  if (!key) throw unavailable();
  const row = await env.DB.prepare(
    `SELECT i.id AS issued_id, i.status, i.user_id AS owner_id, d.*
     FROM coupon_issued i JOIN coupon_definitions d ON d.id = i.definition_id
     WHERE i.id = ? OR UPPER(d.code) = UPPER(?)`
  ).bind(key, key).first();
  if (!row || row.owner_id !== userId || row.status !== 'ISSUED') throw unavailable();
  if (Number(row.is_active) !== 1) throw unavailable();
  if ((row.valid_from && row.valid_from > at) || (row.valid_to && at > row.valid_to)) throw unavailable();
  const eligibleIdx = row.owner_type === 'SELLER'
    ? lines.map((l, i) => (l.partnerId === row.partner_id ? i : -1)).filter((i) => i >= 0)
    : lines.map((_, i) => i);
  if (!eligibleIdx.length) throw unavailable();
  const eligibleGoods = eligibleIdx.reduce((a, i) => a + assertWon(lines[i].goods, 'line goods'), 0);
  if (eligibleGoods < (row.min_order_amount || 0)) {
    throw conflict('COUPON_MIN_ORDER', `쿠폰 최소 주문금액(${row.min_order_amount}원) 미달입니다.`);
  }
  let discount = row.discount_type === 'PERCENT'
    ? applyBps(eligibleGoods, Number(row.discount_value) * 100)
    : Number(row.discount_value);
  if (row.max_discount_amount) discount = Math.min(discount, row.max_discount_amount);
  discount = Math.min(assertWon(discount, 'coupon'), eligibleGoods);
  const allocations = lines.map(() => 0);
  if (discount > 0) {
    const parts = allocate(discount, eligibleIdx.map((i) => lines[i].goods));
    eligibleIdx.forEach((lineIdx, k) => { allocations[lineIdx] = parts[k]; });
  }
  return {
    issuedId: row.issued_id,
    definitionId: row.id,
    ownerType: row.owner_type,
    partnerId: row.partner_id || null,
    discount,
    allocations,
    sellerAbsorbed: row.owner_type === 'SELLER' ? discount : 0
  };
}

/** Redeem an issued coupon onto an order. The status flip is atomic: exactly one concurrent redeem wins. */
export async function redeemCoupon(env, { issuedId, orderId, userId, discount }) {
  const flip = await env.DB.prepare(
    "UPDATE coupon_issued SET status = 'USED', used_at = CURRENT_TIMESTAMP, order_id = ? WHERE id = ? AND user_id = ? AND status = 'ISSUED'"
  ).bind(orderId, issuedId, userId).run();
  if ((flip.meta?.changes ?? 0) !== 1) throw unavailable();
  const issued = await env.DB.prepare('SELECT definition_id FROM coupon_issued WHERE id = ?').bind(issuedId).first();
  try {
    await env.DB.prepare(
      'INSERT INTO coupon_redemptions (id, issued_id, definition_id, user_id, order_id, discount_applied) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(newId('cr'), issuedId, issued.definition_id, userId, orderId, discount).run();
  } catch (e) {
    await env.DB.prepare("UPDATE coupon_issued SET status = 'ISSUED', used_at = NULL, order_id = NULL WHERE id = ?").bind(issuedId).run()
      .catch(() => {});
    throw unavailable();
  }
  return { issued_id: issuedId, order_id: orderId, discount_applied: discount };
}

/** Redemption as batch statements (checkout path): the UNIQUE(issued_id) backstop keeps races safe. */
export function redeemStatements(env, { issuedId, orderId, userId, definitionId, discount }) {
  return [
    env.DB.prepare("UPDATE coupon_issued SET status = 'USED', used_at = CURRENT_TIMESTAMP, order_id = ? WHERE id = ? AND user_id = ? AND status = 'ISSUED'").bind(orderId, issuedId, userId),
    env.DB.prepare('INSERT INTO coupon_redemptions (id, issued_id, definition_id, user_id, order_id, discount_applied) VALUES (?, ?, ?, ?, ?, ?)').bind(newId('cr'), issuedId, definitionId, userId, orderId, discount)
  ];
}

/** Release as batch statements (cancel/refund paths). No-ops when nothing was redeemed. */
export function releaseStatements(env, { orderId }) {
  return [
    env.DB.prepare('DELETE FROM coupon_redemptions WHERE order_id = ?').bind(orderId),
    env.DB.prepare("UPDATE coupon_issued SET status = 'ISSUED', used_at = NULL, order_id = NULL WHERE order_id = ? AND status = 'USED'").bind(orderId)
  ];
}

/** Release an order's redemption (cancel / full refund): coupon becomes reusable. No-op when absent. */
export async function releaseCoupon(env, { orderId }) {
  const red = await env.DB.prepare('SELECT issued_id FROM coupon_redemptions WHERE order_id = ?').bind(orderId).first();
  if (!red) return { released: false };
  await env.DB.prepare('DELETE FROM coupon_redemptions WHERE order_id = ?').bind(orderId).run();
  await env.DB.prepare("UPDATE coupon_issued SET status = 'ISSUED', used_at = NULL, order_id = NULL WHERE id = ?").bind(red.issued_id).run();
  return { released: true, issued_id: red.issued_id };
}

export function isNewCouponId(id) {
  return typeof id === 'string' && id.startsWith('ci_');
}

/** True when the ref addresses the new generation: a ci_ id, or a code the user holds an issued row for. */
export async function hasNewCoupon(env, userId, ref) {
  const key = String(ref || '').trim();
  if (!key) return false;
  if (isNewCouponId(key)) return true;
  const row = await env.DB.prepare(
    `SELECT i.id FROM coupon_issued i JOIN coupon_definitions d ON d.id = i.definition_id
     WHERE i.user_id = ? AND d.code IS NOT NULL AND UPPER(d.code) = UPPER(?) LIMIT 1`
  ).bind(userId, key).first();
  return !!row;
}
