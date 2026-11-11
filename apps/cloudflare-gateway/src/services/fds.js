// apps/cloudflare-gateway/src/services/fds.js
// Wave E: checkout fraud evaluation with database-backed signals (replaces the
// caller-supplied estimate). Thresholds are env-overridable; scores feed the
// ALLOW / REVIEW / BLOCK decision persisted on the order.
//   REVIEW = the order proceeds but its settlements stay HOLD until an operator
//   clears the review (there is no 3-D Secure challenger without a live PG, so a
//   "challenge" is honest manual review, not a 3DS redirect that never happens).

const num = (env, key, fallback) => {
  const n = Number(env && env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const digitsOnly = (v) => String(v || '').replace(/\D/g, '');

/**
 * inputs: { userId, ip, ipCountry, amountKrw, recipientPhone, ownerIds, partnerIds, hsCodes }
 * The caller (checkout) resolves owners/partners/HS codes from the order lines.
 */
export async function evaluateCheckoutFds(env, { userId, ipCountry, amountKrw, recipientPhone, ownerIds = [], partnerIds = [], hsCodes = [] }) {
  const rules = [];
  let score = 10;

  // RULE_01: card testing — failed payment attempts on this account in N minutes.
  const vCount = num(env, 'FDS_VELOCITY_COUNT', 3);
  const vMin = num(env, 'FDS_VELOCITY_MINUTES', 10);
  const fails = await env.DB.prepare(
    `SELECT COUNT(*) c FROM payment_transactions t JOIN orders o ON o.id = t.order_id
     WHERE o.customer_id = ? AND t.status = 'FAILED' AND t.created_at > datetime('now', ?)`
  ).bind(userId, `-${vMin} minutes`).first('c');
  if ((fails || 0) >= vCount) { score += 75; rules.push('VELOCITY_CARD_TEST'); }

  // RULE_03: wash trading — the buyer IS the seller (account), or ships to the
  // seller's own CS number (digits compared, formatting ignored).
  if (ownerIds.includes(userId)) {
    score += 80; rules.push('WASH_TRADING_GUARD');
  } else if (recipientPhone && partnerIds.length) {
    const placeholders = partnerIds.map(() => '?').join(',');
    const { results } = await env.DB.prepare(`SELECT customer_service_phone FROM partners WHERE id IN (${placeholders})`).bind(...partnerIds).all();
    const want = digitsOnly(recipientPhone);
    if (want && results.some((r) => digitsOnly(r.customer_service_phone) === want)) {
      score += 80; rules.push('WASH_TRADING_GUARD');
    }
  }

  // RULE_02: foreign IP on an account that never paid here (trusted travelers pass).
  const cc = String(ipCountry || '').toUpperCase();
  if (cc && cc !== 'KR' && cc !== 'XX') {
    const paid = await env.DB.prepare('SELECT COUNT(*) c FROM orders WHERE customer_id = ? AND paid_at IS NOT NULL').bind(userId).first('c');
    if (!paid) { score += 45; rules.push('GEO_IP_MISMATCH'); }
  }

  // RULE_04: high value orders always get human eyes before the money moves.
  // Weight 35: alone it reaches REVIEW (10 + 35 >= 40), never BLOCK.
  if (Number(amountKrw) >= num(env, 'FDS_HIGH_VALUE_KRW', 1500000)) {
    score += 35; rules.push('HIGH_VALUE_ESCROW_HOLD');
  }

  // RULE_05: operator blocklist, exact or digit-prefix match (empty list = dormant).
  const cleanHs = [...new Set((hsCodes || []).filter(Boolean))];
  if (cleanHs.length) {
    const { results: banned } = await env.DB.prepare('SELECT code FROM prohibited_hs_codes').all();
    const norms = banned.map((b) => digitsOnly(b.code)).filter(Boolean);
    const hit = cleanHs.some((h) => {
      const d = digitsOnly(h);
      return d && norms.some((n) => d === n || d.startsWith(n));
    });
    if (hit) { score += 80; rules.push('PROHIBITED_HS_SCANNER'); }
  }

  score = Math.min(100, score);
  const decision = score >= num(env, 'FDS_BLOCK_SCORE', 85) ? 'BLOCK' : score >= num(env, 'FDS_REVIEW_SCORE', 40) ? 'REVIEW' : 'ALLOW';
  return { score, decision, rules };
}
