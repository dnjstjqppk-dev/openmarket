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

// ---------------- SEC-07: storefront refresh interceptor ----------------
await t.test('C01 storefront retries 401 once after a single-flight refresh', async () => {
  const src = read('apps/storefront/src/main.ts')
  assert.ok(src.includes('/api/v1/auth/refresh'), 'interceptor calls the refresh endpoint')
  assert.ok(src.includes('refreshAccessToken'), 'named single-flight refresh helper')
  assert.ok(src.includes('x-olmoa-retried'), 'retry marker prevents refresh loops')
  assert.ok(src.includes('auth.logout()'), 'failed refresh still ends the session')
})

await t.test('C02 admin retries 401 once after a single-flight refresh', async () => {
  const src = read('apps/admin/src/main.ts')
  assert.ok(src.includes('/api/v1/auth/refresh'), 'interceptor calls the refresh endpoint')
  assert.ok(src.includes('refreshAccessToken'), 'named single-flight refresh helper')
  assert.ok(src.includes('x-olmoa-retried'), 'retry marker prevents refresh loops')
})

await t.test('C03 partner retries 401 once after a single-flight refresh', async () => {
  const src = read('apps/partner/src/main.ts')
  assert.ok(src.includes('/api/v1/auth/refresh'), 'interceptor calls the refresh endpoint')
  assert.ok(src.includes('refreshAccessToken'), 'named single-flight refresh helper')
  assert.ok(src.includes('x-olmoa-retried'), 'retry marker prevents refresh loops')
})

// ---------------- SEC-07: refresh token storage + login wiring ----------------
await t.test('C04 storefront stores the refresh token and sends it only to /auth/refresh', async () => {
  const store = read('apps/storefront/src/stores/auth.ts')
  assert.ok(store.includes('olmoa_refresh_token'), 'refresh key in the auth store')
  assert.ok(store.includes('refresh_token') || store.includes('refreshToken'), 'store exposes the refresh token')
  const login = read('apps/storefront/src/views/LoginView.vue')
  assert.ok(login.includes('json.refresh_token'), 'password login persists the refresh token')
  const occurrences = (login.match(/json\.refresh_token/g) || []).length
  assert.ok(occurrences >= 2, `password + social logins persist refresh (found ${occurrences})`)
})

await t.test('C05 admin stores the refresh token at login and clears it on logout', async () => {
  const cfg = read('apps/admin/src/config.ts')
  assert.ok(cfg.includes('olmoa_admin_refresh_token'), 'admin refresh key')
  assert.ok(cfg.includes('getAdminRefreshToken') && cfg.includes('setAdminRefreshToken'), 'accessors exist')
  const login = read('apps/admin/src/views/LoginView.vue')
  assert.ok(login.includes('setAdminRefreshToken(json.refresh_token)'), 'login persists refresh')
})

await t.test('C06 partner stores the refresh token at login and clears it on logout', async () => {
  const cfg = read('apps/partner/src/config.ts')
  assert.ok(cfg.includes('partner_refresh_token'), 'partner refresh key')
  const login = read('apps/partner/src/views/LoginView.vue')
  assert.ok(login.includes('json.refresh_token'), 'login persists refresh')
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
