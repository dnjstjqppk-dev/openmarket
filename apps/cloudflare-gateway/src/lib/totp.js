// apps/cloudflare-gateway/src/lib/totp.js
// RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s) + AES-GCM sealing of the shared secret at rest. WebCrypto only.

const enc = new TextEncoder();
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;

export function base32Encode(bytes) {
  let bits = 0; let value = 0; let out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$|\s/g, '');
  let bits = 0; let value = 0; const out = [];
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('BASE32_INVALID');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

export function newTotpSecret() {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export async function totpAt(secretB32, step) {
  const key = await crypto.subtle.importKey('raw', base32Decode(secretB32), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8);
  let s = step;
  for (let i = 7; i >= 0; i--) { msg[i] = s & 0xff; s = Math.floor(s / 256); }
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

export const currentStep = (nowMs = Date.now()) => Math.floor(nowMs / 1000 / STEP_SECONDS);

/**
 * Returns the matched time-step (±1 step clock skew) or null. Steps <= lastStep are refused (no replay of a used code).
 */
export async function verifyTotp(secretB32, code, { lastStep = null, nowMs = Date.now() } = {}) {
  if (!/^\d{6}$/.test(String(code || ''))) return null;
  const now = currentStep(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && lastStep !== undefined && step <= Number(lastStep)) continue;
    if ((await totpAt(secretB32, step)) === String(code)) return step;
  }
  return null;
}

export function otpauthUri(secretB32, account, issuer = 'OLMOA Admin') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

// ---- secret sealing (AES-256-GCM). Key: TOTP_ENCRYPTION_KEY, else derived from JWT_SECRET (rotating it then voids 2FA enrolments).
async function sealKey(env) {
  const material = env.TOTP_ENCRYPTION_KEY || `${env.JWT_SECRET || ''}::totp-seal-v1`;
  if (!material || material.length < 32) throw new Error('TOTP_KEY_NOT_CONFIGURED');
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(material));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function sealSecret(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealKey(env), enc.encode(plain)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}

export async function openSecret(env, sealed) {
  const [v, iv, ct] = String(sealed || '').split(':');
  if (v !== 'v1' || !iv || !ct) throw new Error('TOTP_SEAL_INVALID');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await sealKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}
