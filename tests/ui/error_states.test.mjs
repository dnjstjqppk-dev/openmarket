// Static error-state guards (P1): list/wallet/support views must surface load
// failures with a retry affordance instead of empty states or invented data.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'

const t = createRunner('Storefront error states')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

await t.test('S01 orders list surfaces load failures with retry', async () => {
  const v = read('apps/storefront/src/views/OrdersView.vue')
  assert.ok(v.includes('loadError'), 'loadError state exists')
  assert.ok(v.includes('v-else-if="loadError"'), 'error block renders before the empty state')
  assert.ok(v.includes('@click="loadOrders"'), 'retry calls the loader')
  assert.ok(!v.includes("console.error('Failed to load customer orders:'"), 'no console-only failure path')
})

await t.test('S02 wallet never invents a balance and reports failures', async () => {
  const v = read('apps/storefront/src/views/CouponsView.vue')
  assert.ok(!v.includes('balance: 5000'), 'no fabricated 5,000 default balance')
  assert.ok(v.includes('balance == null'), 'unknown balance renders as unknown')
  assert.ok(v.includes('loadError') && v.includes('@click="loadWallet"'), 'load failure with retry')
  assert.ok(v.includes('쿠폰 받기에 실패'), 'claim failure is reported')
})

await t.test('S03 support center reports load and submit failures', async () => {
  const v = read('apps/storefront/src/views/SupportView.vue')
  assert.ok(v.includes('loadError') && v.includes('@click="loadSupport"'), 'load failure with retry')
  assert.ok(v.includes('문의 등록에 실패'), 'submit failure is reported')
  assert.ok(!v.includes('} catch {}'), 'no silent catch-all')
})

await t.test('S04a partner settlement shows a loading state', async () => {
  const v = read('apps/partner/src/views/settlements/SettlementOverviewView.vue')
  assert.ok(v.includes('v-if="loading"'), 'loading block renders while fetching')
  assert.ok(v.includes('정산 내역을 불러오는 중'), 'loading copy is present')
})

await t.test('S04b partner settlement surfaces load failures with retry', async () => {
  const v = read('apps/partner/src/views/settlements/SettlementOverviewView.vue')
  assert.ok(v.includes('loadError'), 'loadError state exists')
  assert.ok(v.includes('v-else-if="loadError"'), 'error block renders before the empty state')
  assert.ok(v.includes('@click="loadSettlements"'), 'retry calls the loader')
  assert.ok(v.includes('!res.ok') || v.includes('res.ok'), 'non-OK responses are treated as failures')
  assert.ok(!v.includes('console.error(e)'), 'no console-only failure path')
})

await t.test('S04c partner settlement shows an empty state', async () => {
  const v = read('apps/partner/src/views/settlements/SettlementOverviewView.vue')
  assert.ok(v.includes('settlements.length === 0'), 'empty condition is checked')
  assert.ok(v.includes('정산 내역이 없습니다'), 'empty copy is present')
})

await t.test('S04d partner settlement CSV escapes cells and keeps Excel-readable output', async () => {
  const v = read('apps/partner/src/views/settlements/SettlementOverviewView.vue')
  assert.ok(v.includes("replace(/\"/g, '\"\"')"), 'double quotes are escaped per RFC 4180')
  assert.ok(v.includes('\\uFEFF'), 'BOM prefix keeps Korean readable in Excel')
  assert.ok(v.includes('effective_net_payout,settlement_status'), 'CSV header names the effective payout column it exports')
  assert.ok(v.includes('내보낼 정산 내역이 없습니다'), 'empty export is refused with guidance')
})

await t.test('S04e partner settlement copy follows the Korean partner-app convention', async () => {
  const v = read('apps/partner/src/views/settlements/SettlementOverviewView.vue')
  for (const stale of ['Automated Partner Settlement Ledger', 'Gross Non-Cancelled Sales',
    'Platform Commission', 'Net Partner Payout', 'Escrow Pending', 'Export Tax & Settlement CSV',
    '>Gross Sales<', '>Commission<', '>Shipping Fee<', '>Net Payout<', '>Status<']) {
    assert.ok(!v.includes(stale), `stale English copy removed: ${stale}`)
  }
  for (const ko of ['정산 원장', '총 매출', '플랫폼 수수료', '실지급액', '정산 상태']) {
    assert.ok(v.includes(ko), `Korean copy present: ${ko}`)
  }
})

// ---- Work order 1-10: unified error / empty / loading ----
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const RELOGIN = '다시 로그인해주세요'
function walkSrc(dirs) {
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`
      if (e.isDirectory()) walk(p)
      else if (p.endsWith('.vue') || p.endsWith('.ts')) out.push(p)
    }
  }
  for (const d of dirs) walk(d)
  return out
}
const APP_SRC = ['apps/storefront/src', 'apps/admin/src', 'apps/partner/src']

await t.test('E01 shared error state shows the unified copy with retry', async () => {
  const v = read('packages/ui/src/components/OmErrorState.vue')
  assert.ok(v.includes(U), 'unified error sentence is the default title')
  assert.ok(v.includes('다시 시도'), 'retry button label exists')
  assert.ok(v.includes('role="alert"'), 'error is announced to assistive tech')
})

await t.test('E02 no HTTP status, stack, or query leaks into user-facing code', async () => {
  const banned = ['${res.status}', '${r.status}', '${claimRes.status}', 'HTTP ${', '.stack}']
  const hits = []
  for (const f of walkSrc(APP_SRC)) {
    const s = read(f)
    for (const b of banned) if (s.includes(b)) hits.push(`${f}: ${b}`)
  }
  assert.equal(hits.length, 0, `technical jargon in UI code:\n${hits.join('\n')}`)
})

await t.test('E03 custom load-error blocks use the unified heading', async () => {
  const files = [
    'apps/storefront/src/views/OrdersView.vue',
    'apps/storefront/src/views/SupportView.vue',
    'apps/storefront/src/views/CouponsView.vue',
    'apps/admin/src/views/AuditLogView.vue',
    'apps/admin/src/views/BusinessEntitiesView.vue',
    'apps/admin/src/views/DashboardView.vue',
    'apps/admin/src/views/InquiriesView.vue',
    'apps/admin/src/views/LedgerAuditView.vue',
    'apps/admin/src/views/OrdersView.vue',
    'apps/admin/src/views/ReconciliationView.vue',
    'apps/admin/src/views/ShippingZonesView.vue',
    'apps/partner/src/views/products/ProductListView.vue',
    'apps/partner/src/views/ProfileManageView.vue',
    'apps/partner/src/views/QnaManageView.vue',
    'apps/partner/src/views/claims/CancelListView.vue',
    'apps/partner/src/views/claims/ReturnListView.vue',
    'apps/partner/src/views/claims/ExchangeListView.vue',
    'apps/partner/src/views/settlements/SettlementOverviewView.vue',
    'apps/partner/src/views/ShipmentView.vue'
  ]
  for (const f of files) assert.ok(read(f).includes(U), `${f} shows the unified sentence`)
})

await t.test('E04 expired sessions log out, route to login, and say so uniformly', async () => {
  const mains = [
    ['apps/storefront/src/main.ts', 'auth.logout()'],
    ['apps/admin/src/main.ts', 'clearAdminToken()'],
    ['apps/partner/src/main.ts', 'clearPartnerSession()']
  ]
  for (const [f, logout] of mains) {
    const s = read(f)
    assert.ok(s.includes('401'), `${f} handles 401`)
    assert.ok(s.includes(logout), `${f} ends the session`)
    assert.ok(s.includes("path: '/login'"), `${f} routes to login`)
    assert.ok(s.includes('expired'), `${f} flags the expiry`)
  }
  for (const app of ['storefront', 'admin', 'partner']) {
    const f = `apps/${app}/src/views/LoginView.vue`
    assert.ok(read(f).includes(RELOGIN), `${f} shows the unified re-login copy`)
  }
})

await t.test('E05 list-empty screens use the shared empty state', async () => {
  const files = [
    'apps/storefront/src/views/AddressesView.vue',
    'apps/storefront/src/views/CouponsView.vue',
    'apps/storefront/src/views/OrdersView.vue',
    'apps/storefront/src/views/SupportView.vue',
    'apps/admin/src/views/AuditLogView.vue',
    'apps/admin/src/views/BusinessEntitiesView.vue',
    'apps/admin/src/views/CategoriesView.vue',
    'apps/admin/src/views/CouponsView.vue',
    'apps/admin/src/views/DashboardView.vue',
    'apps/admin/src/views/InquiriesView.vue',
    'apps/admin/src/views/OrdersView.vue',
    'apps/admin/src/views/PartnerApplicationsView.vue',
    'apps/admin/src/views/ProductManageView.vue',
    'apps/admin/src/views/ReviewsView.vue',
    'apps/admin/src/views/ShippingZonesView.vue',
    'apps/admin/src/views/SuppliersView.vue',
    'apps/admin/src/views/UsersView.vue',
    'apps/partner/src/views/BiddingView.vue',
    'apps/partner/src/views/DashboardView.vue',
    'apps/partner/src/views/MultiChannelListingView.vue',
    'apps/partner/src/views/QnaManageView.vue',
    'apps/partner/src/views/claims/CancelListView.vue',
    'apps/partner/src/views/claims/ReturnListView.vue',
    'apps/partner/src/views/claims/ExchangeListView.vue',
    'apps/partner/src/views/settlements/SettlementOverviewView.vue',
    'apps/partner/src/views/ShipmentView.vue'
  ]
  for (const f of files) assert.ok(read(f).includes('<OmEmptyState'), `${f} renders the shared empty state`)
})

await t.test('E06 product surfaces load behind skeletons', async () => {
  const sk = read('packages/ui/src/components/OmSkeleton.vue')
  for (const v of ["variant === 'card'", "variant === 'row'", "variant === 'detail'"]) {
    assert.ok(sk.includes(v), `skeleton has the ${v} variant`)
  }
  for (const f of ['HomeView', 'BestSellersView', 'LightningDealsView']) {
    assert.ok(read(`apps/storefront/src/views/${f}.vue`).includes('variant="card"'), `${f} grids load behind card skeletons`)
  }
  // 3-2: search/category grids moved into the shared PLP layout.
  for (const f of ['apps/storefront/src/components/plp/PlpLayout.vue']) {
    assert.ok(read(f).includes('variant="card"'), 'PLP grids load behind card skeletons')
  }
  assert.ok(read('apps/storefront/src/views/ProductDetailView.vue').includes('variant="detail"'), 'detail loads behind the detail skeleton')
  assert.ok(read('apps/storefront/src/views/CheckoutView.vue').includes('variant="row"'), 'quote lines load behind row skeletons')
  // CouponsView keeps its ad-hoc pulse loader: F-S08 pins the animate-pulse marker.
  for (const f of ['AddressesView', 'OrderDetailView', 'OrdersView']) {
    assert.ok(read(`apps/storefront/src/views/${f}.vue`).includes('OmSkeleton'), `${f} loading uses the shared skeleton`)
  }
})

await t.test('E07 spinners never stand alone on storefront screens', async () => {
  const views = walkSrc(['apps/storefront/src/views']).filter((f) => read(f).includes('OmSpinner'))
  assert.deepEqual(views.sort(), ['apps/storefront/src/views/CartView.vue', 'apps/storefront/src/views/PaymentResultView.vue'], 'only the two vetted inline/product uses remain')
  assert.ok(read('apps/storefront/src/views/CartView.vue').includes(':size="12"'), 'cart spinner stays inline-sized')
  assert.ok(read('apps/storefront/src/views/PaymentResultView.vue').includes('label="결제 승인 확인 중"'), 'payment spinner keeps its labelled wait state')
  const spun = walkSrc(['apps/storefront/src']).filter((f) => read(f).includes('animate-spin'))
  assert.equal(spun.length, 0, `no raw spinners in storefront: ${spun.join(', ')}`)
})

await t.test('E08 shared empty state carries icon, title, description, and action', async () => {
  const v = read('packages/ui/src/components/OmEmptyState.vue')
  assert.ok(v.includes('slot name="icon"'), 'icon slot (with neutral default) exists')
  assert.ok(v.includes('title'), 'title prop exists')
  assert.ok(v.includes('description'), 'description prop exists')
  assert.ok(v.includes('$slots.default'), 'action slot exists')
})

await t.test('E09 raw technical errors fall back to friendly copy', async () => {
  const { userErrorMessage } = await import('../../packages/ui/src/format.ts')
  const fb = '상품을 불러오지 못했습니다'
  for (const tech of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed',
    'The operation was aborted', 'Unexpected token < in JSON at position 0', 'Unexpected end of JSON input',
    'HTTP 500', 'request failed with status 500', '주문 조회 실패 (500)']) {
    assert.equal(userErrorMessage(new Error(tech), fb), fb, `technical message hidden: ${tech}`)
  }
  assert.equal(userErrorMessage(new Error('쿠폰이 없습니다'), fb), '쿠폰이 없습니다', 'server copy passes through')
  assert.equal(userErrorMessage(new Error(''), fb), fb, 'empty message falls back')
  assert.equal(userErrorMessage(null, fb), fb, 'null falls back')
  assert.equal(userErrorMessage(undefined, fb), fb, 'undefined falls back')
  assert.equal(userErrorMessage({}, fb), fb, 'message-less object falls back')
})

await t.test('E10 no raw exception message reaches user-facing state', async () => {
  const re = /[a-zA-Z_$][\w$]*\?\.message\s*\|\||\berr\.message\s*\|\|/
  const hits = []
  for (const f of walkSrc(APP_SRC)) {
    if (f.endsWith('/main.ts')) continue // client-error telemetry keeps raw detail; it is not UI
    const s = read(f)
    if (re.test(s)) hits.push(f)
  }
  assert.equal(hits.length, 0, `raw e.message fallbacks remain in:\n${hits.join('\n')}`)
})

t.finish()
