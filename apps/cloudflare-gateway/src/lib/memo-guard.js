// apps/cloudflare-gateway/src/lib/memo-guard.js
// Work order 3-6: delivery-memo abuse screen. The storefront mirrors this list
// (CheckoutView MEMO_FORBIDDEN) for instant feedback; the server verdict here
// is authoritative. Keep both copies identical and minimal: unambiguous abuse
// terms only, never contact info (buyers legitimately leave phone numbers).

const FORBIDDEN = [
  '시발', '씨발', '개새끼', '병신', '꺼져', '죽어', '뒤져', '엿먹어',
  '니미', '호로', '창녀', '보지', '자지', '좆', 'fuck', 'shit'
];

/** Returns the first forbidden term found, or null. Case-insensitive. */
export function findForbiddenMemo(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return null;
  const hit = FORBIDDEN.find((w) => s.includes(w.toLowerCase()));
  return hit || null;
}
