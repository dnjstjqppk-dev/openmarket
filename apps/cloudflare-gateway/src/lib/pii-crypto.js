// apps/cloudflare-gateway/src/lib/pii-crypto.js
// SEC-10: AES-256-GCM sealing of personal data at rest (settlement accounts, PCCC,
// notification recipients/content). Same mechanics as the TOTP seal (lib/totp.js),
// separate key and a distinct `enc:v1:` envelope so the two ciphertexts never mix.
// Reads are lazy-migrating: values without the envelope pass through untouched,
// so rows written before SEC-10 keep working until they are rewritten.

const enc = new TextEncoder();
const ENVELOPE = 'enc:v1:';

async function sealKey(env) {
  if (env && env.ENVIRONMENT === 'production' && !env.PII_ENCRYPTION_KEY) throw new Error('PII_KEY_NOT_CONFIGURED');
  const material = (env && env.PII_ENCRYPTION_KEY) || `${(env && env.JWT_SECRET) || ''}::pii-seal-v1`;
  if (!material || material.length < 32) throw new Error('PII_KEY_NOT_CONFIGURED');
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(material));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function isSealedPii(value) {
  return typeof value === 'string' && value.startsWith(ENVELOPE);
}

/** Seal a plaintext secret. null/'' pass through (nullable columns stay nullable). */
export async function sealPii(env, plain) {
  if (plain === null || plain === undefined || plain === '') return plain === undefined ? null : plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealKey(env), enc.encode(String(plain))));
  return `${ENVELOPE}${b64(iv)}:${b64(ct)}`;
}

/** Open a sealed value. Rejects tampered or foreign envelopes — never returns garbage. */
export async function openPii(env, sealed) {
  const parts = String(sealed || '').split(':');
  if (parts.length !== 4 || `${parts[0]}:${parts[1]}:` !== ENVELOPE || !parts[2] || !parts[3]) throw new Error('PII_SEAL_INVALID');
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(parts[2]) }, await sealKey(env), unb64(parts[3]));
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error('PII_SEAL_INVALID');
  }
}

/** Open sealed values, pass legacy plaintext through (lazy migration). */
export async function maybeOpenPii(env, value) {
  if (value === null || value === undefined || value === '') return value;
  if (!isSealedPii(value)) return value;
  return openPii(env, value);
}
