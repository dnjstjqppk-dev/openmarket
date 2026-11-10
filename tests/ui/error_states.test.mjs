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

await t.test('S04a partner settlement shows a loading state', async () => {
  const v = read('apps/partner/src/views/SettlementView.vue')
  assert.ok(v.includes('v-if="loading"'), 'loading block renders while fetching')
  assert.ok(v.includes('정산 내역을 불러오는 중'), 'loading copy is present')
})

await t.test('S04b partner settlement surfaces load failures with retry', async () => {
  const v = read('apps/partner/src/views/SettlementView.vue')
  assert.ok(v.includes('loadError'), 'loadError state exists')
  assert.ok(v.includes('v-else-if="loadError"'), 'error block renders before the empty state')
  assert.ok(v.includes('@click="loadSettlements"'), 'retry calls the loader')
  assert.ok(v.includes('!res.ok') || v.includes('res.ok'), 'non-OK responses are treated as failures')
  assert.ok(!v.includes('console.error(e)'), 'no console-only failure path')
})

await t.test('S04c partner settlement shows an empty state', async () => {
  const v = read('apps/partner/src/views/SettlementView.vue')
  assert.ok(v.includes('settlements.length === 0'), 'empty condition is checked')
  assert.ok(v.includes('정산 내역이 없습니다'), 'empty copy is present')
})

await t.test('S04d partner settlement CSV escapes cells and keeps Excel-readable output', async () => {
  const v = read('apps/partner/src/views/SettlementView.vue')
  assert.ok(v.includes("replace(/\"/g, '\"\"')"), 'double quotes are escaped per RFC 4180')
  assert.ok(v.includes('\\uFEFF'), 'BOM prefix keeps Korean readable in Excel')
  assert.ok(v.includes('effective_net_payout,settlement_status'), 'CSV header names the effective payout column it exports')
  assert.ok(v.includes('내보낼 정산 내역이 없습니다'), 'empty export is refused with guidance')
})

await t.test('S04e partner settlement copy follows the Korean partner-app convention', async () => {
  const v = read('apps/partner/src/views/SettlementView.vue')
  for (const stale of ['Automated Partner Settlement Ledger', 'Gross Non-Cancelled Sales',
    'Platform Commission', 'Net Partner Payout', 'Escrow Pending', 'Export Tax & Settlement CSV',
    '>Gross Sales<', '>Commission<', '>Shipping Fee<', '>Net Payout<', '>Status<']) {
    assert.ok(!v.includes(stale), `stale English copy removed: ${stale}`)
  }
  for (const ko of ['정산 원장', '총 매출', '플랫폼 수수료', '실지급액', '정산 상태']) {
    assert.ok(v.includes(ko), `Korean copy present: ${ko}`)
  }
})

t.finish()
