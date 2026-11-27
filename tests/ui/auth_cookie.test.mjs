// tests/ui/auth_cookie.test.mjs
// P0-2: web sessions live in httpOnly cookies. No token may be persisted to
// localStorage or attached as a Bearer header from JS-readable state; the
// fetch wrappers force credentials:include and rotate via the cookie.
// Run: node tests/ui/auth_cookie.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('Web cookie sessions (P0-2)');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir, exts, out = []) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}

const MAINS = [
  'apps/storefront/src/main.ts',
  'apps/admin/src/main.ts',
  'apps/partner/src/main.ts',
];

await t.test('W01 fetch wrappers force credentials and rotate via cookie', async () => {
  // P2: the mechanism lives in the shared module; mains only wire it.
  const shared = read('packages/ui/src/apiFetch.ts');
  assert.ok(shared.includes("credentials: 'include'"), 'shared wrapper forces credentials');
  assert.ok(shared.includes('/api/v1/auth/refresh'), 'shared wrapper keeps silent refresh');
  assert.ok(!shared.includes('refresh_token'), 'no token is read from JS state');
  assert.ok(!shared.includes('Bearer'), 'never re-attaches a Bearer token');
  assert.ok(shared.includes('x-olmoa-retried'), 'keeps the retry marker');
  for (const f of MAINS) {
    const src = read(f);
    assert.ok(src.includes('installApiFetch'), `${f} wires the shared wrapper`);
    assert.ok(src.includes('onExpiredSession'), `${f} handles expiry`);
    assert.ok(!src.includes('refresh_token'), `${f} keeps no token logic`);
    assert.ok(!src.includes('Bearer'), `${f} attaches no Bearer token`);
  }
});

await t.test('W02 no token is persisted to localStorage', async () => {
  const sf = read('apps/storefront/src/stores/auth.ts');
  assert.ok(!sf.includes('localStorage.setItem'), 'storefront auth writes nothing to storage');
  assert.ok(!sf.includes('refreshToken'), 'storefront auth keeps no refresh token member');
  assert.ok(sf.includes('LEGACY_KEYS'), 'storefront purges legacy token keys');
  const admin = read('apps/admin/src/config.ts');
  assert.ok(!admin.includes('getAdminToken('), 'admin token getter is gone');
  assert.ok(!admin.includes('setAdminToken'), 'admin token setter is gone');
  assert.ok(!admin.includes('getItem(TOKEN_KEY') && !admin.includes('setItem(TOKEN_KEY'), 'admin token keys are unread/unwritten');
  assert.ok(admin.includes('LEGACY_TOKEN_KEYS'), 'admin purges legacy token keys');
  const pt = read('apps/partner/src/config.ts');
  assert.ok(!pt.includes('getPartnerToken('), 'partner token getter is gone');
  assert.ok(!pt.includes('updatePartnerToken'), 'partner token rotation write is gone');
  assert.ok(!pt.includes('KEYS.token'), 'partner token key is gone');
  assert.ok(pt.includes('LEGACY_TOKEN_KEYS'), 'partner purges legacy token keys');
});

await t.test('W03 login and onboarding keep the profile only', async () => {
  for (const f of [
    'apps/storefront/src/views/LoginView.vue',
    'apps/admin/src/views/LoginView.vue',
    'apps/partner/src/views/LoginView.vue',
  ]) {
    const src = read(f);
    assert.ok(!src.includes('json.token'), `${f} ignores the JSON token`);
    assert.ok(!src.includes('json.refresh_token'), `${f} ignores the JSON refresh token`);
  }
  assert.ok(!read('apps/storefront/src/views/RegisterView.vue').includes('data.token'), 'register keeps profile only');
  assert.ok(!read('apps/partner/src/views/ApplyView.vue').includes('data.token'), 'application keeps profile only');
});

await t.test('W04 sessions restore from /auth/session and log out via API', async () => {
  for (const f of [
    'apps/storefront/src/stores/auth.ts',
    'apps/admin/src/config.ts',
    'apps/partner/src/config.ts',
  ]) {
    const src = read(f);
    // /auth/session answers a guest with 200 (no failed request on every page view)
    assert.ok(src.includes('/api/v1/auth/session'), `${f} restores from /auth/session`);
    assert.ok(src.includes('/api/v1/auth/logout'), `${f} logs out via API`);
  }
  assert.ok(read('apps/storefront/src/main.ts').includes('ensureSession'), 'storefront guard restores');
  assert.ok(read('apps/admin/src/main.ts').includes('ensureAdminSession'), 'admin guard restores');
  assert.ok(read('apps/partner/src/router/index.ts').includes('ensurePartnerSession'), 'partner guard restores');
});

await t.test('W06 sessions restore with role checks and awaited gates', async () => {
  // One browser profile holds one API session: a seller/admin cookie must not
  // authenticate the storefront (clean logged-out instead of wrong identity).
  assert.ok(read('apps/storefront/src/stores/auth.ts').includes("u.role === 'ROLE_CUSTOMER'"), 'storefront restore requires ROLE_CUSTOMER');
  // Memory-only sessions restore on boot so public pages see them.
  assert.ok(read('apps/storefront/src/main.ts').includes('void useAuthStore(pinia).ensureSession()'), 'storefront restores on boot');
  assert.ok(read('apps/partner/src/main.ts').includes('void ensurePartnerSession()'), 'partner restores on boot');
  // One-shot gates await the restore instead of reading possibly-stale memory.
  assert.ok(read('apps/storefront/src/views/SellerStoreView.vue').includes('await auth.ensureSession()'), 'follow awaits restore');
  assert.ok(read('apps/storefront/src/stores/wishlist.ts').includes('await auth.ensureSession()'), 'wishlist awaits restore');
});

await t.test('W05 no view attaches a Bearer token from JS state', async () => {
  const files = [
    ...walk('apps/storefront/src', ['.vue', '.ts']),
    ...walk('apps/admin/src', ['.vue', '.ts']),
    ...walk('apps/partner/src', ['.vue', '.ts']),
  ];
  assert.ok(files.length > 50, `expected dozens of sources, got ${files.length}`);
  for (const f of files) {
    assert.ok(!read(f).includes('Bearer ${'), `${f} attaches no Bearer token`);
  }
});

await t.test('W07 guests are never treated as expired sessions', async () => {
  // The cookie-less session probe returns NO_SESSION; the wrapper must not refresh on it.
  assert.ok(read('packages/ui/src/apiFetch.ts').includes("body.code === 'NO_SESSION'"), 'apiFetch skips refresh for NO_SESSION');
  // Only a session that existed can expire: no "session expired" bounce for a first visit.
  assert.ok(read('apps/admin/src/main.ts').includes('if (!getAdminSessionUser()) return;'), 'admin expired redirect needs a session');
  assert.ok(read('apps/partner/src/main.ts').includes('if (!getPartnerSessionUser()) return;'), 'partner expired redirect needs a session');
  // The partner shell waits for the first navigation and a seller session before seller-only calls.
  const shell = read('apps/partner/src/App.vue');
  assert.ok(shell.includes('await router.isReady()') && shell.includes('await ensurePartnerSession()'), 'partner header waits for router + session');
});

t.finish();
