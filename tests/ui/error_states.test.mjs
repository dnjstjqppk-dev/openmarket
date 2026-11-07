// Static error-state guards (P1): list/wallet/support views must surface load
// failures with a retry affordance instead of empty states or invented data.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

t.finish()
