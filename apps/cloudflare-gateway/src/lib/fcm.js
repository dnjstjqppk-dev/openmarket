// apps/cloudflare-gateway/src/lib/fcm.js
// Firebase Cloud Messaging HTTP v1 sender (server side). One pipeline covers
// Android and iOS (Apple delivery is configured behind Firebase, a human step).
// Fail-closed: without FCM_PROJECT_ID/FCM_CLIENT_EMAIL/FCM_PRIVATE_KEY nothing
// is attempted; callers report PUSH_NOT_CONFIGURED honestly.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function b64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Service-account OAuth token, cached per client e-mail with 60s expiry skew.
let cached = null;

export function fcmConfigured(env) {
  return Boolean(env.FCM_PROJECT_ID && env.FCM_CLIENT_EMAIL && env.FCM_PRIVATE_KEY);
}

export function __resetFcmCache() {
  cached = null;
}

function privateKeyBytes(env) {
  let pem = String(env.FCM_PRIVATE_KEY || '');
  pem = pem.replace(/\\n/g, '\n');
  const m = pem.match(/-----BEGIN [^-]+-----([\s\S]+?)-----END [^-]+-----/);
  const b64 = (m ? m[1] : pem).replace(/\s/g, '');
  return b64ToBytes(b64);
}

export async function getFcmAccessToken(env) {
  const now = Date.now();
  if (cached && cached.email === env.FCM_CLIENT_EMAIL && cached.exp > now + 60000) return cached.token;
  const key = await globalThis.crypto.subtle.importKey(
    'pkcs8', privateKeyBytes(env),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: env.FCM_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600
  }));
  const sig = await globalThis.crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`));
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${header}.${claim}.${b64url(sig)}`
  });
  if (!res.ok) throw new Error(`FCM_TOKEN_${res.status}`);
  const body = await res.json().catch(() => ({}));
  if (!body.access_token) throw new Error('FCM_TOKEN_EMPTY');
  cached = { email: env.FCM_CLIENT_EMAIL, token: body.access_token, exp: now + Number(body.expires_in || 3600) * 1000 };
  return cached.token;
}

export async function sendFcm(env, { token, title, body, data }) {
  const access = await getFcmAccessToken(env);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: String(title).slice(0, 200), body: String(body).slice(0, 1000) },
        data: data || {},
        android: { priority: 'HIGH' },
        apns: { headers: { 'apns-priority': '10' } }
      }
    })
  });
  const parsed = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, messageId: parsed.name || null };
  const status = (parsed.error && parsed.error.status) || '';
  return {
    ok: false,
    code: res.status,
    unregistered: res.status === 404 || status === 'NOT_FOUND',
    error: (parsed.error && parsed.error.message) || `FCM_${res.status}`
  };
}
