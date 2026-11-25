// Static guards for partner dispatch/upload wiring (P0 wave):
// image upload must not force a JSON content-type on FormData, and the
// dispatch-po / fulfill actions must collect their required fields.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'

const t = createRunner('Partner dispatch ops')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

await t.test('U01 image upload sends FormData without a JSON content-type', async () => {
  const v = read('apps/partner/src/components/product-form/ProductImageUploader.vue')
  assert.ok(v.includes('body: formData'), 'upload uses FormData')
  assert.ok(!v.includes('headers: getPartnerHeaders(),\n      body: formData'), 'no JSON content-type forced on FormData')
  assert.ok(v.includes('getPartnerAuthHeaders()'), 'auth-only headers used for upload')
})

await t.test('U02 B2B dispatch collects supplier and total cost', async () => {
  const v = read('apps/partner/src/views/MultiChannelListingView.vue')
  assert.ok(v.includes('/api/v1/channels/suppliers'), 'supplier directory loaded')
  assert.ok(v.includes('total_cost_krw'), 'total cost sent to dispatch-po')
  assert.ok(!v.includes("{ supplier_id: 'domeggook_domeme' }"), 'no hardcoded single-field body')
})

await t.test('U03 3PL fulfill collects carrier and tracking number', async () => {
  const v = read('apps/partner/src/views/MultiChannelListingView.vue')
  assert.ok(v.includes('/api/v1/channels/carriers'), 'carrier directory loaded')
  assert.ok(v.includes('tracking_number'), 'tracking number sent to fulfill')
  assert.ok(!v.includes("{ carrier_code: 'CJ_LOGISTICS' }"), 'no hardcoded single-field body')
})

await t.test('U04 dashboard binds real metrics, no fixed figures', async () => {
  const v = read('apps/partner/src/views/DashboardView.vue')
  for (const stale of ['+18.4%', '10.24', '오늘 (10.30)', '98.5%', '1.8일', '0.4%']) {
    assert.ok(!v.includes(stale), `fixed figure removed: ${stale}`)
  }
  for (const live of ['weekly_gmv', 'wow_pct', 'ship_on_time_rate', 'avg_delivery_days', 'claim_rate_pct']) {
    assert.ok(v.includes(live), `live metric bound: ${live}`)
  }
})

await t.test('U05 6-11 product form requires the policy with default prefill', async () => {
  const v = read('apps/partner/src/views/products/ProductEditView.vue')
  assert.ok(v.includes("if (!form.value.shipping_policy_id)"), 'submit validates the policy choice')
  assert.ok(v.includes('Number(p.is_default) === 1'), 'default pre-fills the choice')
  assert.ok(v.includes('/store/shipping-policies'), 'guides to the policy screen when empty')
  assert.ok(!v.includes('기본 정책 사용'), 'no silent default fallback option')
})

await t.test('U06 6-11 bulk upload and URL import require the policy', async () => {
  const b = read('apps/partner/src/views/BulkUploadView.vue')
  assert.ok(b.includes('shipping_policy_id: bulkPolicyId.value'), 'top-level policy sent with the batch')
  assert.ok(b.includes('배송정책을 선택해 주세요'), 'upload validates before sending')
  const u = read('apps/partner/src/views/UrlImportView.vue')
  assert.ok(u.includes('shipping_policy_id: selectedPolicy.value'), 'publish sends the chosen policy')
})

await t.test('U07 6-11 product list flags unassigned rows and bulk-assigns', async () => {
  const v = read('apps/partner/src/views/products/ProductListView.vue')
  assert.ok(v.includes("params.set('shipping', fShipping.value)"), 'unassigned filter param sent')
  assert.ok(v.includes('배송정책 미지정'), 'unassigned badge shown')
  assert.ok(v.includes('shipping_policy_id: bulkPolicyId.value'), 'bulk-update assigns the policy')
  const a = read('apps/admin/src/views/products/ProductListView.vue')
  assert.ok(a.includes("params.set('shipping', fShipping.value)"), 'admin unassigned filter sent')
  const q = read('apps/admin/src/views/products/ReviewQueueView.vue')
  assert.ok(q.includes('shipping_policy'), 'review queue flags the policy check')
})

await t.test('U08 6-12 product form collects brand, maker, model and barcodes', async () => {
  const v = read('apps/partner/src/views/products/ProductEditView.vue')
  assert.ok(v.includes('상품 주요정보'), 'key-info section present')
  assert.ok(v.includes('NOBRAND_VALUE'), 'brandless preset offered')
  assert.ok(v.includes('form.manufacturer') && v.includes('form.model_name'), 'maker and model bound')
  assert.ok(v.includes('isValidGtin'), 'barcode format checked before submit')
  const s = read('apps/partner/src/components/product-form/SkuTableEditor.vue')
  assert.ok(s.includes('바코드(GTIN)') && s.includes('바코드 없음'), 'per-row barcode or exemption')
  assert.ok(s.includes('GTIN_EXEMPT_OPTIONS'), 'exemption reasons offered')
  const b = read('apps/partner/src/views/BulkUploadView.vue')
  assert.ok(b.includes('gtin,gtin_exempt_reason'), 'CSV template carries identifier columns')
  const u = read('apps/partner/src/views/UrlImportView.vue')
  assert.ok(u.includes('editedBrand') && u.includes('editedGtin'), 'import publish collects identifiers')
})

await t.test('U09 6-12 missing-identifiers lists and backfill upload exist', async () => {
  const v = read('apps/partner/src/views/products/ProductListView.vue')
  assert.ok(v.includes("params.set('identifiers', fIdentifiers.value)"), 'missing filter param sent')
  assert.ok(v.includes('식별정보 누락'), 'missing badge shown')
  assert.ok(v.includes('/api/v1/partner/products/identifiers'), 'backfill endpoint wired')
  assert.ok(v.includes('olmoa_identifiers_template.csv'), 'CSV template offered')
  const a = read('apps/admin/src/views/products/ProductListView.vue')
  assert.ok(a.includes("params.set('identifiers', fIdentifiers.value)"), 'admin identifiers filter sent')
  assert.ok(a.includes('바코드 중복'), 'conflict badge shown')
})

t.finish()
