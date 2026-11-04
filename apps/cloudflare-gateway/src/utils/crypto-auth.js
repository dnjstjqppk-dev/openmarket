// apps/cloudflare-gateway/src/utils/crypto-auth.js
// PBKDF2-SHA256 password hashing and strict HS256 JWT. No legacy/plaintext fallbacks, no default secrets.

const PBKDF2_ITERATIONS = 100000; // Workers runtime maximum for PBKDF2
const enc = new TextEncoder();

function toHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, keyMaterial, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${toHex(salt)}:${toHex(hash)}`;
}

/** Only `pbkdf2:` hashes are accepted. Anything else (plaintext, "hash_*", fake bcrypt) never verifies. */
export async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || !password || typeof storedHash !== 'string') return false;
  const parts = storedHash.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  const salt = fromHex(parts[2]);
  if (!salt || !Number.isInteger(iterations) || iterations < 10000 || iterations > PBKDF2_ITERATIONS) return false;
  const hash = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(toHex(hash), parts[3].toLowerCase());
}

export function randomToken(bytes = 32) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(text) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}

function b64urlEncodeBytes(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlEncodeString(str) {
  return b64urlEncodeBytes(enc.encode(str));
}
function b64urlDecodeToBytes(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret, usage) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('JWT secret missing or shorter than 32 chars');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function signJwt(payload, secretKey, expiresInSec = 60 * 60 * 12) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlEncodeString(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64urlEncodeString(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSec }));
  const key = await hmacKey(secretKey, 'sign');
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${body}`)));
  return `${header}.${body}.${b64urlEncodeBytes(sig)}`;
}

/** Returns the payload only for a correctly signed, unexpired HS256 token. */
export async function verifyJwt(token, secretKey) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlDecodeToBytes(parts[0])));
    if (!header || header.alg !== 'HS256') return null;
    const key = await hmacKey(secretKey, 'verify');
    const ok = await crypto.subtle.verify('HMAC', key, b64urlDecodeToBytes(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecodeToBytes(parts[1])));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}
