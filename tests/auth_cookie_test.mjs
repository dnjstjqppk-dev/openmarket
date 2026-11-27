// tests/auth_cookie_test.mjs
// P0-2: httpOnly cookie dual-mode. Web apps authenticate via cookies (JS
// cannot read them); native/mobile clients keep using Bearer + JSON tokens.
// Run: node tests/auth_cookie_test.mjs (requires: node scripts/gen-dev-seed.mjs once)
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Auth cookie dual-mode (P0-2)');
const SEED = ['migrations/dev/seed_local_dev.sql'];
const PW = 'DevPass!2026#';
const SECRET = 'test-jwt-secret-0123456789abcdefghijklmnop';
const BASE_ENV = { JWT_SECRET: SECRET, ENVIRONMENT: 'test', PAYMENT_MODE: 'sandbox' };

async function boot(env = {}) {
  return createGateway({ seedFiles: SEED, env: { ...BASE_ENV, ...env } });
}

function setCookies(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const one = res.headers.get('set-cookie');
  return one ? [one] : [];
}

function cookieValue(cookies, name) {
  const hit = cookies.find((c) => c.startsWith(`${name}=`));
  assert.ok(hit, `Set-Cookie ${name} present`);
  return hit.slice(name.length + 1).split(';')[0];
}

function cookieFlags(cookies, name) {
  return cookies.find((c) => c.startsWith(`${name}=`));
}

async function loginCustomer(g) {
  const r = await g.call('/api/v1/auth/login', {
    method: 'POST', body: { email: 'customer@example.com', password: PW, role: 'CUSTOMER' },
  });
  assert.equal(r.status, 200, r.text);
  return r;
}

await t.test('K01 login sets httpOnly cookies and keeps JSON tokens for native', async () => {
  const g = await boot();
  const r = await loginCustomer(g);
  const cookies = setCookies(r);
  const at = cookieFlags(cookies, 'olmoa_at');
  const rt = cookieFlags(cookies, 'olmoa_rt');
  for (const [label, c] of [['access', at], ['refresh', rt]]) {
    assert.ok(/HttpOnly/i.test(c), `${label} is httpOnly`);
    assert.ok(/SameSite=Lax/i.test(c), `${label} is SameSite=Lax`);
    assert.ok(!/;\s*Secure/i.test(c), `${label} omits Secure off-production (localhost is http)`);
  }
  assert.ok(/Path=\//.test(at) && /Max-Age=3600/.test(at), 'access cookie scope+ttl');
  assert.ok(/Path=\/api\/v1\/auth/.test(rt) && /Max-Age=1209600/.test(rt), 'refresh cookie scope+ttl');
  assert.ok(r.json.token && r.json.refresh_token, 'JSON tokens still issued for native clients');
});

await t.test('K02 production cookies carry the Secure flag', async () => {
  const g = await boot({ ENVIRONMENT: 'production' });
  const r = await loginCustomer(g);
  for (const c of setCookies(r)) assert.ok(/;\s*Secure/i.test(c), `secure in production: ${c.slice(0, 40)}`);
});

await t.test('K03 access cookie alone authenticates /me', async () => {
  const g = await boot();
  const r = await loginCustomer(g);
  const at = cookieValue(setCookies(r), 'olmoa_at');
  const me = await g.call('/api/v1/auth/me', { headers: { Cookie: `olmoa_at=${at}` } });
  assert.equal(me.status, 200, me.text);
  assert.equal(me.json.data.user.email, 'customer@example.com');
});

await t.test('K04 refresh via cookie-only rotates the pair', async () => {
  const g = await boot();
  const r = await loginCustomer(g);
  const cookies = setCookies(r);
  const oldRt = cookieValue(cookies, 'olmoa_rt');
  const rot = await g.call('/api/v1/auth/refresh', {
    method: 'POST', headers: { Cookie: `olmoa_rt=${oldRt}` }, body: {},
  });
  assert.equal(rot.status, 200, rot.text);
  const fresh = setCookies(rot);
  assert.ok(cookieValue(fresh, 'olmoa_at'), 'rotation re-sets access cookie');
  assert.ok(cookieValue(fresh, 'olmoa_rt'), 'rotation re-sets refresh cookie');
  assert.notEqual(cookieValue(fresh, 'olmoa_rt'), oldRt, 'refresh token rotated');
  const replay = await g.call('/api/v1/auth/refresh', {
    method: 'POST', headers: { Cookie: `olmoa_rt=${oldRt}` }, body: {},
  });
  assert.equal(replay.status, 401, 'consumed cookie token cannot replay');
});

await t.test('K05 logout revokes the refresh token and clears cookies', async () => {
  const g = await boot();
  const r = await loginCustomer(g);
  const oldRt = cookieValue(setCookies(r), 'olmoa_rt');
  const out = await g.call('/api/v1/auth/logout', {
    method: 'POST', headers: { Cookie: `olmoa_rt=${oldRt}` }, body: {},
  });
  assert.equal(out.status, 200, out.text);
  for (const c of setCookies(out)) assert.ok(/Max-Age=0/.test(c), `cleared: ${c.slice(0, 30)}`);
  const reuse = await g.call('/api/v1/auth/refresh', {
    method: 'POST', headers: { Cookie: `olmoa_rt=${oldRt}` }, body: {},
  });
  assert.equal(reuse.status, 401, 'logged-out refresh token is dead');
});

await t.test('K06 Bearer header keeps working (dual-mode)', async () => {
  const g = await boot();
  const r = await loginCustomer(g);
  const me = await g.call('/api/v1/auth/me', { headers: { Authorization: `Bearer ${r.json.token}` } });
  assert.equal(me.status, 200, me.text);
  const rot = await g.call('/api/v1/auth/refresh', { method: 'POST', body: { refresh_token: r.json.refresh_token } });
  assert.equal(rot.status, 200, rot.text);
});

await t.test('K08 register issues an access cookie for the new session', async () => {
  const g = await boot();
  const r = await g.call('/api/v1/auth/register', { method: 'POST', body: {
    email: 'newbie-cookie@example.com', password: 'CookiePass!9', full_name: '쿠키신규', phone: '010-1234-5678',
    agree_terms: true, agree_privacy: true,
  } });
  assert.equal(r.status, 201, r.text);
  const at = cookieValue(setCookies(r), 'olmoa_at');
  const me = await g.call('/api/v1/auth/me', { headers: { Cookie: `olmoa_at=${at}` } });
  assert.equal(me.status, 200, me.text);
});

await t.test('K07 CORS opts into credentials for allowlisted origins only', async () => {
  const g = await boot({ ALLOWED_ORIGINS: 'https://olmoa.com' });
  const good = await g.call('/health', { headers: { Origin: 'https://olmoa.com' } });
  assert.equal(good.headers.get('access-control-allow-origin'), 'https://olmoa.com');
  assert.equal(good.headers.get('access-control-allow-credentials'), 'true');
  const bad = await g.call('/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  assert.equal(bad.headers.get('access-control-allow-credentials'), null);
});

await t.test('K09 /auth/me tells a cookie-less visitor NO_SESSION (no refresh to try), others UNAUTHENTICATED', async () => {
  const g = await boot();
  const guest = await g.call('/api/v1/auth/me');
  assert.equal(guest.status, 401);
  assert.equal(guest.json.code, 'NO_SESSION');
  // a refresh cookie (access cookie already expired) must still go down the refresh path
  const withRt = await g.call('/api/v1/auth/me', { headers: { Cookie: 'olmoa_rt=deadbeef' } });
  assert.equal(withRt.status, 401);
  assert.equal(withRt.json.code, 'UNAUTHENTICATED');
  const badAt = await g.call('/api/v1/auth/me', { headers: { Cookie: 'olmoa_at=not-a-jwt' } });
  assert.equal(badAt.json.code, 'UNAUTHENTICATED');
  const badBearer = await g.call('/api/v1/auth/me', { headers: { Authorization: 'Bearer nope' } });
  assert.equal(badBearer.json.code, 'UNAUTHENTICATED');
});

await t.test('K10 /auth/session: guest is a 200 logged-out, a session is authenticated, a bad credential still 401s', async () => {
  const g = await boot();
  const guest = await g.call('/api/v1/auth/session');
  assert.equal(guest.status, 200);
  assert.equal(guest.json.success, true);
  assert.equal(guest.json.authenticated, false);
  assert.equal(guest.json.data, null);
  const login = await loginCustomer(g);
  const at = cookieValue(setCookies(login), 'olmoa_at');
  const me = await g.call('/api/v1/auth/session', { headers: { Cookie: `olmoa_at=${at}` } });
  assert.equal(me.status, 200);
  assert.equal(me.json.authenticated, true);
  assert.equal(me.json.data.user.email, 'customer@example.com');
  // expired access cookie + refresh cookie: 401 so the web wrapper refreshes and retries
  const stale = await g.call('/api/v1/auth/session', { headers: { Cookie: 'olmoa_at=not-a-jwt; olmoa_rt=deadbeef' } });
  assert.equal(stale.status, 401);
  // /auth/me keeps its contract (no "authenticated" flag)
  const plain = await g.call('/api/v1/auth/me', { headers: { Cookie: `olmoa_at=${at}` } });
  assert.equal(plain.status, 200);
  assert.equal(plain.json.authenticated, undefined);
});

t.finish();
