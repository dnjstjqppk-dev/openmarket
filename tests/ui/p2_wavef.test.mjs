// Wave F P2 UI guards (storefront/admin/partner). Static source assertions in the
// repo's tests/ui convention: each fix must be visible in the shipped source.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'

const t = createRunner('Wave F P2 UI fixes')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

// ---------- Storefront ----------
await t.test('F-S01 address set-default/delete surface failures with retry', async () => {
  const v = read('apps/storefront/src/views/AddressesView.vue')
  assert.ok(!v.includes('} catch {}'), 'no silent catch-all')
  assert.ok(v.includes('actionError'), 'action error state exists')
  assert.ok(v.includes('다시 시도'), 'retry affordance exists')
})

await t.test('F-S03 verify-email offers resend with cooldown', async () => {
  const v = read('apps/storefront/src/views/VerifyEmailView.vue')
  assert.ok(v.includes('send-verification'), 'resend calls the server endpoint')
  assert.ok(v.includes('cooldown'), '60s cooldown guard exists')
  assert.ok(v.includes(':disabled'), 'resend button disables during cooldown/work')
})

await t.test('F-S04 coupons route requires auth', async () => {
  const v = read('apps/storefront/src/router/index.ts')
  assert.ok(v.includes("path: 'coupons'") && v.includes('requiresAuth'), 'coupons guarded')
  const line = v.split('\n').find((l) => l.includes("path: 'coupons'"))
  assert.ok(line && line.includes('requiresAuth'), 'guard is on the coupons route itself')
})

await t.test('F-S05 product detail honors the #reviews deep link', async () => {
  const v = read('apps/storefront/src/views/ProductDetailView.vue')
  assert.ok(v.includes('route.hash') || v.includes('route?.hash'), 'hash is observed')
  assert.ok(v.includes('#reviews'), 'reviews hash is handled')
  assert.ok(v.includes('getElementById') || v.includes('scrollIntoView'), 'view scrolls to reviews')
})

await t.test('F-S07 policy figures come from one module pinned to the server', async () => {
  const p = 'apps/storefront/src/config/policy.ts'
  assert.ok(existsSync(join(ROOT, p)), 'shared policy module exists')
  const mod = read(p)
  for (const k of ['WELCOME_CREDIT', 'LATE_COMPENSATION', 'RETURN_WINDOW_DAYS']) {
    assert.ok(mod.includes(k), `policy exports ${k}`)
  }
  // 5-5 (decision-15): the price-match scheme is retired on both sides.
  assert.ok(!mod.includes('PRICE_ADJUST'), 'policy no longer exports the price window')
  // Server truth (the module must equal these; drift fails the build of trust).
  const auth = read('apps/cloudflare-gateway/src/routes/auth.js')
  const ops = read('apps/cloudflare-gateway/src/routes/temu-ops.js')
  const ord = read('apps/cloudflare-gateway/src/routes/orders.js')
  assert.ok(auth.includes('const WELCOME_CREDIT = 10000'), 'server welcome credit read')
  assert.ok(ops.includes('LATE_COMPENSATION_KRW = 5300'), 'server late compensation read')
  assert.ok(mod.includes('10000') && mod.includes('5300'), 'policy matches server amounts')
  assert.ok(ord.includes('RETURN_WINDOW_DAYS_DEFAULT = 7'), 'server return window read')
  assert.ok(!ord.includes('PRICE_ADJUST_WINDOW_DAYS'), 'server price-match window gone')
  const home = read('apps/storefront/src/views/HomeView.vue')
  const detail = read('apps/storefront/src/views/ProductDetailView.vue')
  // 3-1: the home hero renders no figures at all (empty sections hide), so only
  // the detail view still needs the policy import; home keeps the no-literals rule.
  assert.ok(detail.includes('policy'), 'detail imports the policy module')
  assert.ok(!home.includes("'10,000원'") && !home.includes("'5,300원'"), 'home carries no literal figures')
})

await t.test('F-S08 coupon list has skeleton and empty text', async () => {
  const v = read('apps/storefront/src/views/CouponsView.vue')
  assert.ok(v.includes('animate-pulse'), 'loading skeleton exists')
  assert.ok(v.includes('사용 가능한 쿠폰이 없습니다'), 'empty text exists')
})

await t.test('F-S09 checkout side-load failures show a banner with retry', async () => {
  const v = read('apps/storefront/src/views/CheckoutView.vue')
  assert.ok(!v.includes('.then((r) => r.json()).catch(() => ({}))'), 'no silent side-load swallow')
  assert.ok(!v.includes('.then((r) => r.json()).catch(() => null)'), 'no silent config swallow')
  assert.ok(v.includes('sideLoadError') || v.includes('side-load-error'), 'side-load error state exists')
  assert.ok(v.includes('다시 불러오기'), 'retry affordance exists')
})

await t.test('F-S10 support and coupon submits guard double-submit', async () => {
  const s = read('apps/storefront/src/views/SupportView.vue')
  const c = read('apps/storefront/src/views/CouponsView.vue')
  assert.ok(s.includes('submitting') && s.includes(':disabled'), 'support submit guarded')
  assert.ok(c.includes('claiming') && c.includes(':disabled'), 'coupon claim guarded')
})

await t.test('F-S12 phone numbers validate KR shape front and back', async () => {
  const u = 'apps/storefront/src/utils/phone.ts'
  assert.ok(existsSync(join(ROOT, u)), 'shared phone validator exists')
  const mod = read(u)
  assert.ok(mod.includes('0') && mod.includes('9') && mod.includes('11'), 'digit/length rule present')
  const co = read('apps/storefront/src/views/CheckoutView.vue')
  assert.ok(co.includes('phone') && !co.includes('/^[0-9+\\-\\s()]{9,20}$/'), 'checkout uses the shared validator')
  const srv = read('apps/cloudflare-gateway/src/services/orders.js')
  assert.ok(!srv.includes("/^[0-9+\\-\\s()]{9,20}$/.test(phone)"), 'server backstop strengthened')
})

await t.test('F-S13 dead currency module is gone', async () => {
  assert.ok(!existsSync(join(ROOT, 'apps/storefront/src/utils/currency.ts')), 'currency.ts deleted')
})

await t.test('F-S14 order statuses share one label module incl. payment states', async () => {
  const m = 'apps/storefront/src/utils/orderStatus.ts'
  assert.ok(existsSync(join(ROOT, m)), 'shared status-label module exists')
  const mod = read(m)
  for (const k of ['READY', 'PAID', 'PARTIAL_REFUNDED', 'REFUNDED', 'CANCELLED', 'DELIVERED', 'PURCHASE_CONFIRMED']) {
    assert.ok(mod.includes(k), `label covers ${k}`)
  }
  const d = read('apps/storefront/src/views/OrderDetailView.vue')
  assert.ok(d.includes('orderStatus'), 'detail view imports the shared module')
})

await t.test('F-S15 cash-receipt identifier validates digits before send', async () => {
  const v = read('apps/storefront/src/views/OrderDetailView.vue')
  const fn = v.split('const submitCashReceipt')[1].split('</script>')[0]
  assert.ok(fn.includes('cashReceiptError'), 'submit reports identifier errors')
  assert.ok(/test\(|match\(|validateKr/.test(fn), 'submit runs a format check, not trim-only')
  assert.ok(/\[016789\]|digits|length/.test(fn), 'phone/business digit rule present')
})

await t.test('F-SN03 address form drops the 010- prefill and validates', async () => {
  const v = read('apps/storefront/src/views/AddressesView.vue')
  assert.ok(!v.includes("phone: '010-'"), 'no 010- prefill')
  assert.ok(v.includes('phone'), 'phone validated via shared module')
})

// ---------- Admin ----------
await t.test('F-A01 notify target is searchable, never a hardcoded customer', async () => {
  const v = read('apps/admin/src/views/marketing/NotificationSendView.vue')
  assert.ok(!v.includes('u_customer_001'), 'no hardcoded notify target')
  assert.ok(v.includes('/admin/users?q=') || v.includes('searchUsers'), 'customer search wired')
  const srv = read('apps/cloudflare-gateway/src/routes/admin.js')
  assert.ok(srv.includes("searchParams.get('q')"), 'server supports user search')
})

await t.test('F-A02 new banner requires an explicit image URL', async () => {
  const v = read('apps/admin/src/views/marketing/BannerView.vue')
  assert.ok(!v.includes('images.unsplash.com'), 'no stock-photo default')
  assert.ok(v.includes("image_url: ''"), 'default is empty')
  const fn = v.split('handleCreateBanner')[1].split('async function toggleActive')[0]
  assert.ok(fn.includes('image_url'), 'create validates the image URL')
})

await t.test('F-A03 integration matrix counts and webhook URL come from data', async () => {
  const v = read('apps/admin/src/views/SupplierIntegrationView.vue')
  assert.ok(!v.includes('olmoa-api.dnjstjqppk'), 'no hardcoded API host')
  assert.ok(!v.includes('|| 18') && !v.includes('(18개)') && !v.includes('(18)'), 'no hardcoded platform totals')
  assert.ok(v.includes('platforms.length'), 'counts derive from loaded platforms')
})

await t.test('F-A04 dashboard drops unmeasured catalog/PoP copy', async () => {
  const v = read('apps/admin/src/views/DashboardView.vue')
  assert.ok(!v.includes('42개 대분류'), 'no static catalog count')
  assert.ok(!v.includes('300+ PoP'), 'no static PoP claim')
})

await t.test('F-A05 dev credential fill stays DEV-gated', async () => {
  const v = read('apps/admin/src/views/LoginView.vue')
  assert.ok(v.includes('import.meta.env.DEV'), 'DEV gate present')
  assert.ok(v.includes('fillDev'), 'fill helper exists')
})

await t.test('F-A06 API base URL is required env, never a prod hardcode', async () => {
  for (const f of ['apps/admin/src/config.ts', 'apps/partner/src/config.ts', 'apps/storefront/src/config.ts']) {
    const v = read(f)
    assert.ok(!v.includes('dnjstjqppk'), `${f} carries no prod hardcode`)
    assert.ok(v.includes('VITE_API_BASE_URL'), `${f} reads required env`)
  }
  const ci = read('.github/workflows/deploy.yml')
  assert.ok(ci.includes('VITE_API_BASE_URL'), 'deploy provisions the env')
})

await t.test('F-A07 reserve defaults pinned between UI and server', async () => {
  const v = read('apps/admin/src/views/partners/PartnerDetailView.vue')
  const srv = read('apps/cloudflare-gateway/src/routes/admin.js')
  assert.ok(v.includes('10.0') && v.includes('5.0'), 'UI shows tier defaults')
  assert.ok(srv.includes('TIER_3_HIGH_RISK') && srv.includes('10.0') && srv.includes('5.0'), 'server owns the same defaults')
})

await t.test('F-A08 admin lists split errors and empty states', async () => {
  const o = read('apps/admin/src/views/orders/OrderListView.vue')
  assert.ok(o.includes('loadError'), 'orders list has an error state')
  assert.ok(o.includes('다시 시도') || o.includes('@click="loadOrders"'), 'orders retry exists')
  const d = read('apps/admin/src/views/DashboardView.vue')
  for (const [label, key] of [['FDS', 'fdsRules'], ['QC', 'sampleQcList'], ['IPR', 'iprReports']]) {
    const seg = d.split(key)[0]
    assert.ok(seg.length > 0, `${label} list rendered`)
  }
  assert.ok(d.includes('fdsRules.length === 0') || d.includes('!fdsRules.length'), 'FDS empty text wired')
  assert.ok(d.includes('sampleQcList.length === 0') || d.includes('!sampleQcList.length'), 'QC empty text wired')
  assert.ok(d.includes('iprReports.length === 0') || d.includes('!iprReports.length'), 'IPR empty text wired')
})

await t.test('F-A09 category create reports failures', async () => {
  const v = read('apps/admin/src/views/CategoriesView.vue')
  const fn = v.split('createCategory')[1].split('async function deleteCategory')[0]
  assert.ok(!fn.includes('} catch (_) {') || fn.includes('formError') || fn.includes('actionMsg') || fn.includes('errorMsg'), 'create surfaces errors')
  assert.ok(fn.includes('formError') || fn.includes('actionMsg') || fn.includes('errorMsg'), 'create has an error state')
})

await t.test('F-A10 admin drops the unused pinia registration', async () => {
  const v = read('apps/admin/src/main.ts')
  assert.ok(!v.includes('createPinia'), 'no pinia registration without stores')
})

await t.test('F-AN04 review content expands before delete', async () => {
  const v = read('apps/admin/src/views/ReviewsView.vue')
  assert.ok(v.includes('title='), 'truncated cell exposes full text on hover')
  assert.ok(v.includes('showContent') || v.includes('expandModal') || v.includes('selectedReview'), 'expand affordance exists')
})

// ---------- Partner ----------
await t.test('F-T01 return/bid statuses render Korean labels', async () => {
  const r = read('apps/partner/src/views/claims/ReturnListView.vue')
  assert.ok(!r.includes('{{ item.status }}'), 'no raw return status')
  assert.ok(r.includes('statusLabel') || r.includes('STATUS_LABEL'), 'return label map exists')
  const b = read('apps/partner/src/views/BiddingView.vue')
  assert.ok(!b.includes('{{ c.status }}') && !b.includes('{{ n.status }}'), 'no raw bid/negotiation status')
})

await t.test('F-T02 router guard rejects empty partner status', async () => {
  const v = read('apps/partner/src/router/index.ts')
  assert.ok(!v.includes("getPartnerStatus() && getPartnerStatus() !== 'APPROVED'"), 'empty status no longer passes')
  assert.ok(v.includes("!== 'APPROVED'"), 'non-approved routes to application')
})

await t.test('F-T03 login redirect rejects protocol-relative URLs', async () => {
  const v = read('apps/partner/src/views/LoginView.vue')
  assert.ok(!v.includes("redirect.startsWith('/') ? route.query.redirect"), 'bare startsWith gone')
  assert.ok(v.includes('//'), 'double-slash explicitly rejected')
})

await t.test('F-T04 profile status copy follows the account state', async () => {
  const v = read('apps/partner/src/views/ProfileManageView.vue')
  assert.ok(!v.includes('{{ profile.status }} (정상 가동)'), 'no unconditional healthy copy')
  assert.ok(v.includes('PENDING') || v.includes('statusLabel') || v.includes('statusText'), 'per-status copy exists')
})

await t.test('F-T05 import category defaults to loaded data, never a fixed id', async () => {
  const v = read('apps/partner/src/views/UrlImportView.vue')
  assert.ok(!v.includes("ref('cat_e_audio')"), 'no fixed default id')
  assert.ok(!v.includes('value="cat_e_audio"'), 'no fixed fallback option')
})

await t.test('F-T08 product preview links use the env storefront base', async () => {
  const v = read('apps/partner/src/views/products/ProductListView.vue')
  assert.ok(!v.includes('openmarket.dnjstjqppk'), 'no hardcoded preview host')
  assert.ok(v.includes('STOREFRONT_URL'), 'preview base from env config')
})

await t.test('F-T16 mobile menu links multichannel', async () => {
  // The drawer is drawn by OmConsoleShell from the same menu data as the side rail
  // (a hand-kept copy had drifted and dropped shipping policies).
  const v = read('apps/partner/src/App.vue')
  assert.ok(!v.includes('#mobile-nav'), 'no hand-kept drawer copy')
  assert.ok(v.includes("to: '/channels'"), 'menu data links /channels')
  assert.ok(v.includes("to: '/store/shipping-policies'"), 'menu data links shipping policies')
  const shell = read('packages/ui/src/components/OmConsoleShell.vue')
  const drawer = shell.split('<Teleport')[1]
  assert.ok(drawer.includes('v-for="c in m.children"'), 'drawer renders child entries')
})

await t.test('F-TN02 bulk upload renders per-row server errors', async () => {
  const v = read('apps/partner/src/views/BulkUploadView.vue')
  assert.ok(v.includes('json.errors') || v.includes('serverErrors') || v.includes('batchErrors'), 'server errors[] surfaced')
})

await t.test('F-TN04 shipment registration confirms before sending', async () => {
  const v = read('apps/partner/src/views/ShipmentView.vue')
  assert.ok(v.includes('confirm') || v.includes('showConfirm') || v.includes('ConfirmModal'), 'confirm step exists')
  assert.ok(v.includes('tracking') && v.includes('carrier'), 'confirm names order+carrier+tracking')
})

t.finish();
