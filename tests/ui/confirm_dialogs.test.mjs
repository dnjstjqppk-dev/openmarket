// Work order 1-9: native confirm()/alert() become useConfirm/toasts.
// No native-dialog holds remain. The storefront hold converted with its e2e
// script update under autonomous authority (see Q-G3a), the dashboard
// tribunal hold retired when 4-12 removed arbitration from the dashboard
// (rulings move to views/claims in 4-16, built on useConfirm — see Q-4-12),
// the partner-verify hold converted when 4-13 rebuilt the seller screens
// (see Q-4-13), the ledger-claim hold converted when 4-16 moved rulings
// to the claims screen (see Q-4-16), and the last hold (broadcast push)
// converted when 4-18 rebuilt the marketing screens (see Q-4-18).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'

const t = createRunner('Confirm dialogs')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
// Native dialogs take a string message; the useConfirm replacement takes an
// options object, so only string-first-arg calls count as native.
const nativeRe = () => /\b(?:window\.)?(?:alert|confirm)\s*\(\s*['"`]/g
const countNative = (p) => (read(p).match(nativeRe()) || []).length
const countIn = (src) => (src.match(nativeRe()) || []).length

const CONVERTED = [
  'apps/storefront/src/views/AddressesView.vue',
  'apps/storefront/src/views/ProfileView.vue',
  'apps/storefront/src/views/OrderDetailView.vue',
  'apps/admin/src/views/BusinessEntitiesView.vue',
  'apps/admin/src/views/CategoriesView.vue',
  'apps/admin/src/views/CouponsView.vue',
  'apps/admin/src/views/InquiriesView.vue',
  'apps/admin/src/views/orders/OrderListView.vue',
  'apps/admin/src/views/orders/OrderDetailView.vue',
  'apps/admin/src/views/claims/ClaimListView.vue',
  'apps/admin/src/views/partners/ApplicationListView.vue',
  'apps/admin/src/views/partners/ApplicationDetailView.vue',
  'apps/admin/src/views/partners/PartnerListView.vue',
  'apps/admin/src/views/partners/PartnerDetailView.vue',
  'apps/admin/src/views/products/ProductListView.vue',
  'apps/admin/src/views/products/ReviewQueueView.vue',
  'apps/admin/src/views/finance/ReconciliationView.vue',
  'apps/admin/src/views/finance/SettlementBatchView.vue',
  'apps/admin/src/views/finance/PayoutApprovalView.vue',
  'apps/admin/src/views/finance/PolicyView.vue',
  'apps/admin/src/views/ReviewsView.vue',
  'apps/admin/src/views/SecurityView.vue',
  'apps/admin/src/views/ShippingZonesView.vue',
  'apps/admin/src/views/SupplierIntegrationView.vue',
  'apps/admin/src/views/SuppliersView.vue',
  'apps/partner/src/views/products/ProductListView.vue',
  'apps/partner/src/views/products/ProductEditView.vue',
  'apps/partner/src/views/BiddingView.vue',
  'apps/partner/src/views/claims/CancelListView.vue',
  'apps/partner/src/views/claims/ReturnListView.vue',
  'apps/partner/src/views/claims/ExchangeListView.vue',
  'apps/partner/src/views/ShipmentView.vue',
  'apps/partner/src/views/settlements/SettlementOverviewView.vue'
]

// Q-1-9: no native-dialog holds remain. The last one (broadcast push)
// converted when 4-18 rebuilt the marketing screens on useConfirm.
const HOLDS = []

await t.test('N01 converted views carry no native confirm/alert', async () => {
  for (const f of CONVERTED) assert.equal(countNative(f), 0, `${f} must be clean`)
})

await t.test('N02 no native-dialog holds remain', async () => {
  assert.equal(HOLDS.length, 0, 'every 1-9 hold converted to useConfirm')
  assert.ok(!read('apps/admin/src/router/index.ts').includes('MarketingView'), 'the last hold site is gone')
})

await t.test('N03 converted confirms use useConfirm', async () => {
  const withConfirms = [
    'apps/storefront/src/views/AddressesView.vue',
    'apps/storefront/src/views/ProfileView.vue',
    'apps/storefront/src/views/OrderDetailView.vue',
    'apps/admin/src/views/BusinessEntitiesView.vue',
    'apps/admin/src/views/CategoriesView.vue',
    'apps/admin/src/views/CouponsView.vue',
    'apps/admin/src/views/InquiriesView.vue',
    'apps/admin/src/views/marketing/BannerView.vue',
    'apps/admin/src/views/marketing/ExhibitionView.vue',
    'apps/admin/src/views/marketing/FlashSaleView.vue',
    'apps/admin/src/views/marketing/NotificationSendView.vue',
    'apps/admin/src/views/orders/OrderDetailView.vue',
    'apps/admin/src/views/claims/ClaimListView.vue',
    'apps/admin/src/views/partners/ApplicationDetailView.vue',
    'apps/admin/src/views/partners/PartnerDetailView.vue',
    'apps/admin/src/views/products/ProductListView.vue',
    'apps/admin/src/views/products/ReviewQueueView.vue',
    'apps/admin/src/views/finance/SettlementBatchView.vue',
    'apps/admin/src/views/finance/PayoutApprovalView.vue',
    'apps/admin/src/views/finance/PolicyView.vue',
    'apps/admin/src/views/ReviewsView.vue',
    'apps/admin/src/views/SecurityView.vue',
    'apps/admin/src/views/ShippingZonesView.vue',
    'apps/admin/src/views/SupplierIntegrationView.vue',
    'apps/admin/src/views/SuppliersView.vue'
  ]
  for (const f of withConfirms) {
    assert.ok(read(f).includes('useConfirm'), `${f} must use useConfirm`)
  }
})

await t.test('N04 dialogs mount once per app shell', async () => {
  for (const app of ['storefront', 'admin', 'partner']) {
    assert.ok(read(`apps/${app}/src/App.vue`).includes('OmConfirmDialog'), `${app} mounts OmConfirmDialog`)
  }
  for (const app of ['admin', 'partner']) {
    assert.ok(read(`apps/${app}/src/App.vue`).includes('OmToast'), `${app} mounts OmToast`)
  }
})

await t.test('N05 money-moving confirms are dangerous with amounts', async () => {
  for (const f of [
    'apps/admin/src/views/orders/OrderDetailView.vue',
    'apps/admin/src/views/claims/ClaimListView.vue',
    'apps/admin/src/views/finance/SettlementBatchView.vue',
    'apps/admin/src/views/finance/PayoutApprovalView.vue'
  ]) {
    const src = read(f)
    assert.ok(src.includes('danger: true'), `${f} marks danger`)
    assert.ok(src.includes('amounts:'), `${f} passes bold amounts`)
  }
  assert.ok(read('packages/ui/src/components/OmConfirmDialog.vue').includes('amounts'), 'dialog renders amounts')
})

t.finish()
