// apps/cloudflare-gateway/src/services/claims.js
// Return / exchange policy (audit item O14). Who pays the return courier follows the claim reason:
//   customer reasons (단순변심, 사이즈·색상) -> the customer pays (fee withheld from the refund)
//   seller reasons (하자, 오배송, 파손, 상품정보 상이) -> the seller pays, and a full return also refunds the outbound shipping.

export const CUSTOMER_FAULT_REASONS = ['CHANGE_OF_MIND', 'SIZE_COLOR'];
export const SELLER_FAULT_REASONS = ['DEFECTIVE', 'WRONG_ITEM', 'DAMAGED', 'NOT_AS_DESCRIBED'];
export const REASON_CODES = [...CUSTOMER_FAULT_REASONS, ...SELLER_FAULT_REASONS, 'OTHER'];

export function faultOf(reasonCode) {
  if (CUSTOMER_FAULT_REASONS.includes(reasonCode)) return 'CUSTOMER';
  if (SELLER_FAULT_REASONS.includes(reasonCode)) return 'SELLER';
  return null; // OTHER / legacy: decided by the seller at approval
}

export async function partnerReturnFees(env, partnerId) {
  const p = await env.DB.prepare('SELECT base_shipping_fee, return_shipping_fee FROM partners WHERE id = ?').bind(partnerId).first();
  const base = Number(p ? p.base_shipping_fee : 0) || 0;
  return { oneWay: p && p.return_shipping_fee !== null && p.return_shipping_fee !== undefined ? Number(p.return_shipping_fee) : base, outbound: base };
}

/** True when `lines` return everything still unrefunded in the sub-order. */
export function isFullReturn(subItems, lines) {
  return subItems.every((i) => {
    const remaining = i.quantity - i.refunded_quantity;
    const asked = lines.filter((l) => l.order_item_id === i.id).reduce((a, l) => a + l.quantity, 0);
    return remaining === 0 || asked === remaining;
  });
}

/**
 * Fee withheld from a RETURN refund. Customer fault: one-way return fee, plus the outbound fee the seller absorbed
 * when the order shipped free and everything comes back (왕복). Returnless approvals ship nothing back -> no fee.
 */
export function returnFeeFor({ fault, returnless, fullReturn, subShippingFee, fees }) {
  if (fault !== 'CUSTOMER' || returnless) return 0;
  return fees.oneWay + (fullReturn && Number(subShippingFee) === 0 ? fees.outbound : 0);
}
