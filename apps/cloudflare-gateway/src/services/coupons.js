// apps/cloudflare-gateway/src/services/coupons.js
// Work order 2-3: platform/store coupon engine. Amounts are integer KRW;
// burden splits round half-up (applyBps); item splits use largest-remainder.

import { conflict, notFound, bad } from '../lib/http.js';
import { newId, sqlNow } from '../lib/ids.js';
import { allocate, applyBps, assertWon } from '../lib/money.js';

/** Resolve one held coupon (user_coupons row + coupon row) or throw. */
export async function loadHeldCoupon(env, userId, userCouponId) {
  const uc = await env.DB.prepare(
    `SELECT uc.id AS user_coupon_id, uc.is_used, c.*
     FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id
     WHERE uc.id = ? AND uc.user_id = ?`
  ).bind(userCouponId, userId).first();
  if (!uc || Number(uc.is_used) !== 0) {
    throw conflict('COUPON_NOT_AVAILABLE', '사용할 수 있는 쿠폰이 아닙니다. (미보유·사용완료·만료)');
  }
  const now = sqlNow();
  if (Number(uc.is_active) !== 1 || uc.expires_at <= now || (uc.starts_at && uc.starts_at > now)) {
    throw conflict('COUPON_NOT_AVAILABLE', '사용할 수 있는 쿠폰이 아닙니다. (미보유·사용완료·만료)');
  }
  return uc;
}

/** Resolve an id-or-code reference to a held coupon. */
export async function loadHeldCouponByRef(env, userId, ref) {
  const uc = await env.DB.prepare(
    `SELECT uc.id AS user_coupon_id, uc.is_used, c.*
     FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id
     WHERE uc.user_id = ? AND (uc.id = ? OR UPPER(c.code) = UPPER(?))`
  ).bind(userId, String(ref), String(ref)).first();
  if (!uc) throw conflict('COUPON_NOT_AVAILABLE', '사용할 수 있는 쿠폰이 아닙니다. (미보유·사용완료·만료)');
  return loadHeldCoupon(env, userId, uc.user_coupon_id);
}

/** Whether a coupon line (with categoryId resolved) matches the coupon scope. */
export async function matchScope(env, coupon, line) {
  const scope = coupon.scope || 'ALL';
  if (scope === 'ALL') return true;
  if (scope === 'SELLER') {
    if (coupon.seller_id) return line.partnerId === coupon.seller_id;
    const hit = await env.DB.prepare(
      'SELECT 1 FROM coupon_targets WHERE coupon_id = ? AND target_type = ? AND target_id = ?'
    ).bind(coupon.id, 'SELLER', line.partnerId).first();
    return !!hit;
  }
  if (scope === 'CATEGORY') {
    const hit = await env.DB.prepare(
      'SELECT 1 FROM coupon_targets WHERE coupon_id = ? AND target_type = ? AND target_id = ?'
    ).bind(coupon.id, 'CATEGORY', line.categoryId).first();
    return !!hit;
  }
  if (scope === 'PRODUCT') {
    const hit = await env.DB.prepare(
      'SELECT 1 FROM coupon_targets WHERE coupon_id = ? AND target_type = ? AND target_id = ?'
    ).bind(coupon.id, 'PRODUCT', line.productId).first();
    return !!hit;
  }
  return false;
}

/** Coupon amount = min(computed, max discount, eligible sum); rejects below min order. */
export function couponAmount(coupon, eligibleSum) {
  assertWon(eligibleSum, 'eligibleSum');
  if (eligibleSum < (coupon.min_order_amount || 0)) {
    throw conflict('COUPON_MIN_ORDER', `쿠폰 최소 주문금액(${coupon.min_order_amount}원) 미달입니다.`);
  }
  const computed = coupon.discount_type === 'PERCENT'
    ? applyBps(eligibleSum, coupon.discount_value * 100)
    : coupon.discount_value;
  let amount = computed;
  if (coupon.max_discount_amount != null) amount = Math.min(amount, coupon.max_discount_amount);
  return assertWon(Math.min(amount, eligibleSum), 'coupon');
}

/** Split a platform allocation into seller share (half-up) and platform share (remainder). */
export function splitPlatformBurden(platformAlloc, platformShareBps) {
  const share = platformShareBps == null ? 10000 : platformShareBps;
  const seller = applyBps(platformAlloc, 10000 - share);
  return { seller, platform: platformAlloc - seller };
}

/**
 * Issue a coupon to a user. Key is required (2-common-6); same-key replays win.
 * Total quantity is guarded by an atomic increment; triggers backstop direct writes.
 */
export async function claimCoupon(env, userId, ref, idemKey) {
  if (!idemKey) throw bad('IDEMPOTENCY_KEY_REQUIRED', 'X-Idempotency-Key 헤더가 필요합니다.');
  if (ref === undefined || ref === null || String(ref).trim() === '') throw notFound('유효하지 않은 쿠폰 코드입니다.');
  const codeOrId = String(ref).trim();
  const prior = await env.DB.prepare(
    'SELECT uc.*, c.code FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id WHERE uc.claim_idempotency_key = ?'
  ).bind(idemKey).first();
  if (prior) return { replay: true, userCoupon: prior };
  const now = sqlNow();
  const coupon = await env.DB.prepare(
    `SELECT * FROM coupons WHERE (id = ? OR UPPER(code) = UPPER(?)) AND is_active = 1
     AND expires_at > ? AND (starts_at IS NULL OR starts_at <= ?)`
  ).bind(codeOrId, codeOrId, now, now).first();
  if (!coupon) throw notFound('유효하지 않은 쿠폰 코드입니다.');
  if (coupon.issue_method === 'AUTO') throw conflict('COUPON_NOT_CLAIMABLE', '자동 발급 쿠폰은 직접 받을 수 없습니다.');
  if (coupon.per_user_limit != null) {
    const held = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM user_coupons WHERE user_id = ? AND coupon_id = ?'
    ).bind(userId, coupon.id).first('n');
    if (held >= coupon.per_user_limit) throw conflict('COUPON_LIMIT_REACHED', '1인 발급 한도를 초과했습니다.');
  }
  const bump = await env.DB.prepare(
    'UPDATE coupons SET issued_count = issued_count + 1 WHERE id = ? AND (total_quantity IS NULL OR issued_count < total_quantity)'
  ).bind(coupon.id).run();
  if (bump.meta.changes === 0) throw conflict('COUPON_SOLD_OUT', '쿠폰이 모두 소진되었습니다.');
  const id = newId('uc');
  try {
    await env.DB.prepare(
      'INSERT INTO user_coupons (id, user_id, coupon_id, is_used, claim_idempotency_key) VALUES (?, ?, ?, 0, ?)'
    ).bind(id, userId, coupon.id, idemKey).run();
  } catch (e) {
    const msg = String(e && e.message || '');
    if (msg.includes('COUPON_LIMIT_REACHED')) throw conflict('COUPON_LIMIT_REACHED', '1인 발급 한도를 초과했습니다.');
    if (msg.includes('user_coupons.user_id, user_coupons.coupon_id')) {
      await env.DB.prepare('UPDATE coupons SET issued_count = issued_count - 1 WHERE id = ?').bind(coupon.id).run();
      throw conflict('COUPON_ALREADY_CLAIMED', '이미 받은 쿠폰입니다.');
    }
    if (msg.includes('claim_idempotency_key')) {
      const winner = await env.DB.prepare(
        'SELECT uc.*, c.code FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id WHERE uc.claim_idempotency_key = ?'
      ).bind(idemKey).first();
      if (winner) {
        await env.DB.prepare('UPDATE coupons SET issued_count = issued_count - 1 WHERE id = ?').bind(coupon.id).run();
        return { replay: true, userCoupon: winner };
      }
    }
    await env.DB.prepare('UPDATE coupons SET issued_count = issued_count - 1 WHERE id = ?').bind(coupon.id).run();
    throw e;
  }
  const userCoupon = await env.DB.prepare(
    'SELECT uc.*, c.code FROM user_coupons uc JOIN coupons c ON c.id = uc.coupon_id WHERE uc.id = ?'
  ).bind(id).first();
  return { replay: false, userCoupon };
}

export { allocate };
