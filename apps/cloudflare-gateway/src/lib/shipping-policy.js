// apps/cloudflare-gateway/src/lib/shipping-policy.js
// 6-11 (decision-19): the seller-chosen shipping policy is the only source of
// shipping truth. No fee fallbacks in code, one display-text function
// for every surface (detail, cards, cart, order sheet, 6-4 blocks, 6-5 docs,
// 6-3 JSON-LD source).

import { bad } from './http.js';

/** Buyer-facing sale gate: the product names a live seller policy. */
export const sellableSql = (alias = 'p') =>
  `EXISTS (SELECT 1 FROM shipping_policies sp WHERE sp.id = ${alias}.shipping_policy_id AND sp.status = 'ACTIVE')`;

/** Deterministic won grouping (no runtime-locale dependence). */
export function formatWon(n) {
  const v = Math.trunc(Number(n) || 0);
  return String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * The single shipping display string. `policy` is a shipping_policies row
 * (fee_type, base_fee, free_threshold, qty_unit, remote_surcharge).
 * Returns null without a policy — callers show the "unassigned" state.
 */
export function shippingText(policy) {
  if (!policy) return null;
  const fee = Number(policy.base_fee ?? 0);
  let main;
  switch (String(policy.fee_type || '').toUpperCase()) {
    case 'FREE':
      main = '무료배송';
      break;
    case 'CONDITIONAL': {
      const th = policy.free_threshold;
      main = (th === null || th === undefined)
        ? `배송비 ${formatWon(fee)}원`
        : `${formatWon(th)}원 이상 구매 시 무료 (미만 ${formatWon(fee)}원)`;
      break;
    }
    case 'PER_QTY': {
      const unit = Number(policy.qty_unit) > 0 ? Math.trunc(Number(policy.qty_unit)) : 1;
      main = `${unit}개당 ${formatWon(fee)}원`;
      break;
    }
    case 'PAID':
    default:
      main = `배송비 ${formatWon(fee)}원`;
      break;
  }
  const remote = Number(policy.remote_surcharge);
  if (Number.isSafeInteger(remote) && remote > 0) main += ` (도서산간 +${formatWon(remote)}원)`;
  return main;
}

/** The seller's own ACTIVE policy row, or 400 (never another seller's). */
export async function requireOwnPolicy(env, partnerId, id) {
  const row = await env.DB.prepare(
    "SELECT * FROM shipping_policies WHERE id = ? AND partner_id = ? AND status = 'ACTIVE'"
  ).bind(String(id || ''), partnerId).first();
  if (!row) throw bad('INVALID_SHIPPING_POLICY', '사용할 수 없는 배송 템플릿입니다.');
  return row;
}

/** 400 when a product write leaves the product without a usable policy. */
export async function throwMissingPolicy(env, partnerId) {
  const n = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM shipping_policies WHERE partner_id = ? AND status = 'ACTIVE'"
  ).bind(partnerId).first('c') || 0;
  throw bad('SHIPPING_POLICY_REQUIRED', n > 0
    ? '배송정책을 선택해 주세요.'
    : '배송정책을 먼저 등록한 뒤 상품을 등록해 주세요.');
}
