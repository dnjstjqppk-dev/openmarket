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

t.finish()
