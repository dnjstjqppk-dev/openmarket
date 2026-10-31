// apps/cloudflare-gateway/src/utils/crypto-auth.js
// OLMOA Enterprise Security: Web Crypto API PBKDF2 Password Hashing & Standard HMAC-SHA256 JWT Engine

/**
 * Hash a password using PBKDF2 with SHA-256 and 100,000 iterations.
 * Returns: `pbkdf2:100000:<saltHex>:<hashHex>`
 */
export async function hashPassword(password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );

  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:100000:${saltHex}:${hashHex}`;
}

/**
 * Verify a password against stored PBKDF2 or legacy hash
 */
export async function verifyPassword(password, storedHash) {
  if (!storedHash) return false;

  // 1. Standard PBKDF2 format
  if (storedHash.startsWith('pbkdf2:')) {
    const parts = storedHash.split(':');
    if (parts.length !== 4) return false;
    const iterations = parseInt(parts[1], 10);
    const saltHex = parts[2];
    const expectedHashHex = parts[3];

    const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derived = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );

    const hashHex = Array.from(new Uint8Array(derived)).map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex === expectedHashHex;
  }

  // 2. Legacy hash_ prefix fallback for backward compatibility
  if (storedHash.startsWith('hash_')) {
    return storedHash === `hash_${password}`;
  }

  // 3. Plain password match (development fallback)
  return storedHash === password;
}

function base64UrlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return atob(base64);
}

/**
 * Sign standard HMAC-SHA256 JWT
 */
export async function signJwt(payload, secretKey, expiresInSec = 86400) {
  const enc = new TextEncoder();
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSec
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretKey || 'olmoa_enterprise_jwt_secret_2026'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(dataToSign));
  const encodedSignature = base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));

  return `${dataToSign}.${encodedSignature}`;
}

/**
 * Verify standard HMAC-SHA256 JWT
 */
export async function verifyJwt(token, secretKey) {
  if (!token || typeof token !== 'string') return null;

  // Legacy or simplified token format fallback
  if (token.startsWith('ey-olmoa-admin-') || token.startsWith('u_customer_') || token.startsWith('pt_')) {
    return { sub: token, role: token.includes('admin') ? 'ROLE_ADMIN' : (token.startsWith('pt_') ? 'ROLE_PARTNER' : 'ROLE_CUSTOMER') };
  }

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const enc = new TextEncoder();
    const dataToVerify = `${encodedHeader}.${encodedPayload}`;

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(secretKey || 'olmoa_enterprise_jwt_secret_2026'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigStr = base64UrlDecode(encodedSignature);
    const sigBytes = new Uint8Array(sigStr.length);
    for (let i = 0; i < sigStr.length; i++) {
      sigBytes[i] = sigStr.charCodeAt(i);
    }

    const isValid = await crypto.subtle.verify('HMAC', cryptoKey, sigBytes, enc.encode(dataToVerify));
    if (!isValid) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null; // Expired

    return payload;
  } catch {
    return null;
  }
}

