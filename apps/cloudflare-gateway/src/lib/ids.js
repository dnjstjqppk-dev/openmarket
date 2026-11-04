// apps/cloudflare-gateway/src/lib/ids.js
// Collision-free identifiers. Date.now()-based ids collided within one millisecond (audit finding E12).

export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function randomDigits(n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => String(b % 10)).join('');
}

/** Human-facing order number: OLM + YYMMDD + 8 random digits (UNIQUE constraint is the final guard). */
export function newOrderNo(now = new Date()) {
  const y = String(now.getUTCFullYear()).slice(-2);
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `OLM${y}${m}${d}${randomDigits(8)}`;
}

export function newPoNo(now = new Date()) {
  return `PO${now.toISOString().slice(2, 10).replace(/-/g, '')}${randomDigits(6)}`;
}

export function sqlNow(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString().replace('T', ' ').slice(0, 19);
}
