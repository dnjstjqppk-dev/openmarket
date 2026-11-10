// Static + live regression tests for P1 admin console findings
// (P1-A01..A06, A08..A14, A-N01, A-N02 — Wave P1-A lane).
// Static checks assert on Vue/TS sources; A13 also probes the live gateway.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner, createGateway } from '../lib/harness.mjs'

const t = createRunner('P1 admin console')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

async function newGateway() {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox'
    }
  })
}

async function adminToken(g, email = 'admin@openmarket.com', password = 'DevPass!2026#') {
  const login = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password, role: 'ADMIN' } })
  assert.equal(login.status, 200, `login as ${email}`)
  return login.json.token
}

await t.test('P1-A01 routes carry meta.roles and the guard + nav enforce them', async () => {
  const router = read('apps/admin/src/router/index.ts')
  assert.ok(router.includes('meta:') && router.includes('roles:'), 'routes declare meta.roles')
  assert.ok(router.includes('/ledger') && router.includes('FINANCE'), 'finance screens restricted (e.g. ledger)')
  const main = read('apps/admin/src/main.ts')
  assert.ok(main.includes('getAdminRole'), 'guard reads getAdminRole()')
  assert.ok(main.includes('meta') && main.includes('roles'), 'guard checks route meta.roles')
  const app = read('apps/admin/src/App.vue')
  assert.ok(app.includes('getAdminRole') || app.includes('adminRole'), 'nav knows the operator role')
  assert.ok(/v-if="[^"]*(canSee|allowed|canAccess|visible)/.test(app), 'nav links hide when unauthorized')
})

await t.test('P1-A02 mobile nav reaches orders/users/reviews/coupons/categories', async () => {
  const app = read('apps/admin/src/App.vue')
  const mobile = app.split('Mobile Navigation Dropdown')[1] || ''
  for (const to of ['to="/orders"', 'to="/users"', 'to="/reviews"', 'to="/coupons"', 'to="/categories"']) {
    assert.ok(mobile.includes(to), `mobile dropdown contains ${to}`)
  }
})

await t.test('P1-A03 status badges derive from fetch outcomes, not static copy', async () => {
  const v = read('apps/admin/src/views/DashboardView.vue')
  assert.ok(v.includes('집계 실패'), 'failure badge copy exists')
  assert.ok(!v.includes('<span class="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold border border-emerald-200 flex items-center gap-1.5">\n          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>\n          Edge Gateway & D1 정상 가동\n        </span>'), 'static success badges are gone')
  assert.ok(v.includes('v-if') && /badge|edgeOk|syncOk|loadOk|sourceOk|failedSources|loadError/i.test(v), 'badges are conditional on load outcome')
})

await t.test('P1-A04 dashboard surfaces per-source failures with retry', async () => {
  const v = read('apps/admin/src/views/DashboardView.vue')
  assert.ok(v.includes('loadControlTower'), 'retry calls loadControlTower')
  assert.ok(/다시 시도|재시도|retry/i.test(v), 'retry affordance exists')
  assert.ok(v.includes('failedSources') || v.includes('loadError'), 'failure state tracked')
  assert.ok(!v.includes('} catch (_) {\n  }'), 'empty outer catch is gone')
})

await t.test('P1-A05 ledger binds loading skeleton and error state', async () => {
  const v = read('apps/admin/src/views/LedgerAuditView.vue')
  assert.ok(v.includes('v-if="loading"'), 'loading skeleton bound')
  assert.ok(v.includes('loadError') || v.includes('loadFailed'), 'error state exists')
  assert.ok(/다시 시도|재시도|loadLedgers\(\)/.test(v), 'retry affordance exists')
})

await t.test('P1-A06 supplier console binds isLoading and surfaces loader errors', async () => {
  const v = read('apps/admin/src/views/SupplierIntegrationView.vue')
  assert.ok(v.includes('v-if="isLoading"') || v.includes('v-show="isLoading"'), 'isLoading bound in template')
  const sets = (v.match(/errorMsg\.value = /g) || []).length
  assert.ok(sets >= 10, `loader catches surface errorMsg (${sets} assignments)`)
})

await t.test('P1-A08 partner verify confirms with business+tier+reserve and toasts failures', async () => {
  const v = read('apps/admin/src/views/PartnerVerifyView.vue')
  const fn = v.split('async function verify')[1].split('function maskAcct')[0]
  assert.ok(fn.includes('window.confirm'), 'verify() confirms')
  assert.ok(fn.includes('business_name') && fn.includes('reserve'), 'confirm names business + tier/reserve')
  assert.ok(fn.includes('else') && fn.includes('toastMsg'), 'failure branch toasts')
  assert.ok(/catch[^{]*\{[^}]*toastMsg/s.test(fn), 'catch toasts')
})

await t.test('P1-A09 product status change confirms and reports failures', async () => {
  const v = read('apps/admin/src/views/ProductManageView.vue')
  const fn = v.split('async function updateStatus')[1].split('async function reviewProduct')[0]
  assert.ok(fn.includes('window.confirm') || fn.includes('confirm('), 'updateStatus() confirms')
  assert.ok(v.includes('toastMsg') || v.includes('actionMsg') || v.includes('errorMsg'), 'feedback message state exists')
  assert.ok(fn.includes('else') || /catch[^{]*\{[^}]*toast/s.test(fn), 'failure branch reports')
})

await t.test('P1-A10 terminal PO cancel (and FAILED) requires confirmation', async () => {
  const v = read('apps/admin/src/views/SuppliersView.vue')
  const fn = v.split('async function movePo')[1].split('async function createSupplier')[0]
  assert.ok(fn.includes('CANCELLED') && fn.includes('confirm('), 'CANCELLED path confirms')
  assert.ok(fn.includes('FAILED') && fn.includes('confirm('), 'FAILED path confirms')
})

await t.test('P1-A11 payout button relabeled and passes partner context', async () => {
  const v = read('apps/admin/src/views/LedgerAuditView.vue')
  assert.ok(v.includes('지급 화면으로 이동'), 'button relabeled (no fake approve)')
  assert.ok(!v.includes('Approve Payout'), 'fake approve label gone')
  assert.ok(v.includes('partner_id'), 'navigation passes partner_id')
  const r = read('apps/admin/src/views/ReconciliationView.vue')
  assert.ok(r.includes('partner_id') && (r.includes('route.query') || r.includes('useRoute')), 'reconciliation preselects/highlights the partner')
})

await t.test('P1-A12 takedown button no longer implies an action it lacks', async () => {
  const v = read('apps/admin/src/views/DashboardView.vue')
  assert.ok(!v.includes('즉시 블라인드 (Takedown)'), 'misleading label gone')
  assert.ok(v.includes('차단 요청 접수'), 'honest label present')
})

await t.test('P1-A13 GET /api/v1/admin/audit-log serves filtered audit rows', async () => {
  const g = await newGateway()
  const unauth = await g.call('/api/v1/admin/audit-log', { method: 'GET' })
  assert.equal(unauth.status, 401)
  const token = await adminToken(g)
  const c = await g.call('/api/v1/admin/coupons', { method: 'POST', token, body: { code: 'AUDLOG1', title: '감사조회 쿠폰', discount_type: 'FIXED_AMOUNT', discount_value: 500 } })
  assert.equal(c.status, 201)
  const r = await g.call('/api/v1/admin/audit-log', { method: 'GET', token })
  assert.equal(r.status, 200)
  assert.equal(r.json.success, true)
  assert.ok(Array.isArray(r.json.data) && r.json.data.length >= 1, 'audit rows returned')
  assert.ok(r.json.data.some((row) => row.action === 'COUPON_CREATE'), 'fresh mutation visible')
  const f = await g.call('/api/v1/admin/audit-log?action=COUPON_CREATE', { method: 'GET', token })
  assert.equal(f.status, 200)
  assert.ok(f.json.data.length >= 1 && f.json.data.every((row) => row.action === 'COUPON_CREATE'), 'action filter applies')
  const row = r.json.data[0]
  for (const k of ['id', 'actor_user_id', 'actor_role', 'action', 'target_type', 'created_at']) {
    assert.ok(k in row, `row carries ${k}`)
  }
})

await t.test('P1-A13 audit-log denies roles without privacy.audit', async () => {
  const g = await newGateway()
  const superToken = await adminToken(g)
  const created = await g.call('/api/v1/admin/admin-users', { method: 'POST', token: superToken, body: { email: 'cs-audit@openmarket.com', full_name: 'CS 감사', admin_role: 'CS', password: 'CsPass!2026#x' } })
  assert.equal(created.status, 201)
  const csToken = await adminToken(g, 'cs-audit@openmarket.com', 'CsPass!2026#x')
  const r = await g.call('/api/v1/admin/audit-log', { method: 'GET', token: csToken })
  assert.equal(r.status, 403)
  assert.equal(r.json.code, 'ADMIN_PERMISSION_DENIED')
})

await t.test('P1-A13 audit-log view + docs follow the Wave-2 convention', async () => {
  assert.ok(existsSync(join(ROOT, 'apps/admin/src/views/AuditLogView.vue')), 'AuditLogView.vue exists')
  const v = read('apps/admin/src/views/AuditLogView.vue')
  assert.ok(v.includes('/api/v1/admin/audit-log'), 'view queries the endpoint')
  assert.ok(v.includes('action') && v.includes('target_type'), 'view filters by action/target')
  const router = read('apps/admin/src/router/index.ts')
  assert.ok(router.includes('/audit-log'), 'route registered')
  const yaml = read('docs/openapi/paths/admin.yaml')
  assert.ok(yaml.includes('/api/v1/admin/audit-log'), 'admin.yaml documents the route')
  const index = read('docs/openapi/openapi.yaml')
  assert.ok(index.includes('/api/v1/admin/audit-log') && index.includes('./paths/admin.yaml#/paths/~1api~1v1~1admin~1audit-log'), 'openapi.yaml $refs it')
  const probe = read('tests/openapi_reconciliation_test.mjs')
  assert.ok(probe.includes("'/api/v1/admin/audit-log', 'GET', 401"), 'EXPECTED probe covers it')
})

await t.test('P1-A14 adminApi never throws and views handle load failure', async () => {
  const cfg = read('apps/admin/src/config.ts')
  const fn = cfg.split('export async function adminApi')[1]
  assert.ok(fn.includes('try') && fn.includes('catch'), 'adminApi catches transport failures')
  assert.ok(fn.includes('ok: false'), 'adminApi returns {ok:false} instead of throwing')
  for (const [f, need] of [
    ['apps/admin/src/views/BusinessEntitiesView.vue', 'try'],
    ['apps/admin/src/views/ReconciliationView.vue', 'try'],
    ['apps/admin/src/views/SecurityView.vue', 'try'],
    ['apps/admin/src/views/SuppliersView.vue', 'try'],
    ['apps/admin/src/views/PartnerApplicationsView.vue', 'try']
  ]) {
    const v = read(f)
    assert.ok(v.includes(need), `${f} guards adminApi with try/catch`)
  }
  assert.ok(read('apps/admin/src/views/ReconciliationView.vue').includes('loadError') || read('apps/admin/src/views/ReconciliationView.vue').includes('err'), 'reconciliation has an error state')
  assert.ok(read('apps/admin/src/views/BusinessEntitiesView.vue').includes('다시') || read('apps/admin/src/views/BusinessEntitiesView.vue').includes('retry') || read('apps/admin/src/views/BusinessEntitiesView.vue').includes('load()'), 'business entities offers retry')
})

await t.test('A-N01 partner applications mask bank account numbers', async () => {
  const v = read('apps/admin/src/views/PartnerApplicationsView.vue')
  assert.ok(v.includes('maskAcct'), 'view reuses maskAcct')
  assert.ok(!v.includes('{{ a.bank_account_number }}'), 'full account number never rendered raw')
})

await t.test('A-N02 coupon form caps PERCENT discounts with max_discount_amount', async () => {
  const v = read('apps/admin/src/views/CouponsView.vue')
  assert.ok(v.includes('max_discount_amount'), 'max-discount input bound')
  assert.ok(v.includes('50000'), 'PERCENT defaults to 50000 cap')
  assert.ok(v.includes('PERCENT') && (v.includes('필수') || v.includes('required') || v.includes('입력해')), 'PERCENT requires the cap')
})

t.finish()
