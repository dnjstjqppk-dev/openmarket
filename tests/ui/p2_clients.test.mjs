// tests/ui/p2_clients.test.mjs
// P2 Wave C client legs (static contract probes): SEC-05 review image filter,
// SEC-06 PCCC auth header, SEC-07 refresh interceptors + token storage (3 web apps + 2 mobile apps).
// Run: node tests/ui/p2_clients.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'

const t = createRunner('P2 clients (SEC-05/06/07)')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

// ---------------- SEC-07: refresh interceptor (shared @olmoa/ui module) ----------------
// P2: the 401 interceptor lives in packages/ui/src/apiFetch.ts; each main
// wires it via installApiFetch with an app-specific expiry handler.
await t.test('C01 storefront retries 401 once after a single-flight refresh', async () => {
  const src = read('apps/storefront/src/main.ts')
  assert.ok(src.includes('installApiFetch'), 'main wires the shared wrapper')
  assert.ok(src.includes('onExpiredSession'), 'main handles expiry')
  assert.ok(src.includes('auth.logout()'), 'failed refresh still ends the session')
  const shared = read('packages/ui/src/apiFetch.ts')
  assert.ok(shared.includes('/api/v1/auth/refresh'), 'interceptor calls the refresh endpoint')
  assert.ok(shared.includes('refreshAccessToken'), 'named single-flight refresh helper')
  assert.ok(shared.includes('x-olmoa-retried'), 'retry marker prevents refresh loops')
})

await t.test('C02 admin retries 401 once after a single-flight refresh', async () => {
  const src = read('apps/admin/src/main.ts')
  assert.ok(src.includes('installApiFetch'), 'main wires the shared wrapper')
  assert.ok(src.includes('onExpiredSession'), 'main handles expiry')
  const shared = read('packages/ui/src/apiFetch.ts')
  assert.ok(shared.includes('/api/v1/auth/refresh'), 'interceptor calls the refresh endpoint')
  assert.ok(shared.includes('refreshAccessToken'), 'named single-flight refresh helper')
  assert.ok(shared.includes('x-olmoa-retried'), 'retry marker prevents refresh loops')
})

await t.test('C03 partner retries 401 once after a single-flight refresh', async () => {
  const src = read('apps/partner/src/main.ts')
  assert.ok(src.includes('installApiFetch'), 'main wires the shared wrapper')
  assert.ok(src.includes('onExpiredSession'), 'main handles expiry')
  const shared = read('packages/ui/src/apiFetch.ts')
  assert.ok(shared.includes('/api/v1/auth/refresh'), 'interceptor calls the refresh endpoint')
  assert.ok(shared.includes('refreshAccessToken'), 'named single-flight refresh helper')
  assert.ok(shared.includes('x-olmoa-retried'), 'retry marker prevents refresh loops')
})

// ---------------- SEC-07: refresh credential storage + login wiring ----------------
// P0-2 migration (user decision 2026-11-26): web refresh credentials live in
// the httpOnly olmoa_rt cookie, never in JS-readable storage. The browser
// presents the cookie to /auth/refresh automatically; these pins keep the web
// clients from regressing to localStorage tokens. (Mobile still uses the
// keychain: C09/C10. Server-side issuance/rotation is pinned behaviorally in
// tests/auth_cookie_test.mjs K01/K04/K05.)
await t.test('C04 storefront refreshes only via /auth/refresh with no JS-readable token', async () => {
  const store = read('apps/storefront/src/stores/auth.ts')
  assert.ok(!store.includes('localStorage.setItem'), 'auth store persists nothing')
  assert.ok(!store.includes('refreshToken'), 'no refresh token member in the store')
  assert.ok(store.includes('LEGACY_KEYS'), 'legacy token keys are purged')
  const main = read('apps/storefront/src/main.ts')
  assert.ok(main.includes('installApiFetch'), 'main wires the shared wrapper')
  assert.ok(!main.includes('refresh_token'), 'main keeps no token logic')
  const shared = read('packages/ui/src/apiFetch.ts')
  assert.ok(shared.includes('/api/v1/auth/refresh'), 'interceptor calls the refresh endpoint')
  assert.ok(shared.includes("credentials: 'include'"), 'refresh presents the cookie')
  assert.ok(!shared.includes('refresh_token'), 'no token is read from JS state')
  const login = read('apps/storefront/src/views/LoginView.vue')
  assert.ok(!login.includes('json.refresh_token'), 'password + social logins keep the profile only')
})

await t.test('C05 admin session is cookie-backed and ends via API logout', async () => {
  const cfg = read('apps/admin/src/config.ts')
  assert.ok(!cfg.includes('setAdminRefreshToken'), 'no refresh token setter')
  assert.ok(!cfg.includes('getItem(TOKEN_KEY') && !cfg.includes('setItem(TOKEN_KEY'), 'no token key access')
  assert.ok(cfg.includes('LEGACY_TOKEN_KEYS'), 'legacy token keys are purged')
  assert.ok(cfg.includes('/api/v1/auth/logout'), 'logout revokes server-side')
  const login = read('apps/admin/src/views/LoginView.vue')
  assert.ok(!login.includes('json.refresh_token'), 'login keeps the profile only')
  assert.ok(login.includes('setAdminSession(json.user'), 'login records the profile')
})

await t.test('C06 partner session is cookie-backed and ends via API logout', async () => {
  const cfg = read('apps/partner/src/config.ts')
  assert.ok(!cfg.includes('KEYS.token'), 'no token key')
  assert.ok(!cfg.includes('updatePartnerToken'), 'no token rotation write')
  assert.ok(cfg.includes('LEGACY_TOKEN_KEYS'), 'legacy token keys are purged')
  assert.ok(cfg.includes('/api/v1/auth/logout'), 'logout revokes server-side')
  const login = read('apps/partner/src/views/LoginView.vue')
  assert.ok(!login.includes('json.refresh_token'), 'login keeps the profile only')
  assert.ok(login.includes('savePartnerSession(json.user'), 'login records the profile')
})

// ---------------- SEC-06: PCCC check sends the customer token ----------------
await t.test('C07 CheckoutView validates PCCC with the auth header', async () => {
  const src = read('apps/storefront/src/views/CheckoutView.vue')
  const i = src.indexOf('/api/v1/customs/validate-pccc')
  assert.ok(i > 0, 'pccc fetch found')
  const block = src.slice(Math.max(0, i - 600), i + 400)
  assert.ok(block.includes('authHeader'), 'pccc fetch must spread authHeader()')
})

// ---------------- SEC-05: review images filtered at render ----------------
await t.test('C08 ReviewsPanel renders only safe image URLs', async () => {
  const src = read('apps/storefront/src/components/product/ReviewsPanel.vue')
  assert.ok(src.includes('safeReviewImg'), 'named filter helper')
  assert.ok(src.includes(':src="safeReviewImg(src)"'), 'template uses the filter')
  const fn = src.slice(src.indexOf('safeReviewImg'))
  assert.ok(fn.includes('https:') && fn.includes("startsWith('/')"), 'allows https and site-relative')
  assert.ok(fn.includes('javascript:') && fn.includes('data:'), 'rejects dangerous schemes')
})

// ---------------- SEC-07: mobile refresh ----------------
await t.test('C09 customer app refreshes through the keychain and retries once', async () => {
  const svc = read('mobile/customer_app/lib/services/api_service.dart')
  assert.ok(svc.includes('tryRefresh'), 'AuthSession.tryRefresh exists')
  assert.ok(svc.includes('_authed'), 'central retry wrapper exists')
  assert.ok(svc.includes('refresh_token'), 'login persists / logout clears the refresh token')
  assert.ok(svc.includes('/api/v1/auth/refresh'), 'refresh endpoint wired')
})

await t.test('C10 partner app refreshes through the keychain and retries once', async () => {
  const svc = read('mobile/partner_app/lib/services/partner_api_service.dart')
  assert.ok(svc.includes('tryRefresh'), 'PartnerAuthSession.tryRefresh exists')
  assert.ok(svc.includes('_authed'), 'central retry wrapper exists')
  assert.ok(svc.includes('refresh_token'), 'login persists / logout clears the refresh token')
  assert.ok(svc.includes('/api/v1/auth/refresh'), 'refresh endpoint wired')
})

t.finish()
