// Carried-P2 client pins (J-3). Template/logic fixes that a route probe
// cannot see are pinned against the shipped sources instead.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'

const t = createRunner('J-3 carried P2 clients')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

await t.test('J-3 web category parent is a loaded select', async () => {
  const v = read('apps/admin/src/views/CategoriesView.vue')
  assert.ok(v.includes('<select v-model="form.parent_id"'), 'parent select renders')
  assert.ok(v.includes('최상위 (부모 없음)'), 'root option offered')
  assert.ok(!v.includes('placeholder="부모 ID'), 'free-text parent id gone')
})

await t.test('J-3 web role cancel re-renders the operator list', async () => {
  const v = read('apps/admin/src/views/SecurityView.vue')
  assert.ok(v.includes('operatorListKey'), 'cancel path bumps the list key')
  assert.ok(v.includes('<tbody :key="operatorListKey">'), 'tbody bound to the key')
})

await t.test('J-3 web shipment CSV escapes every cell', async () => {
  const v = read('apps/partner/src/views/ShipmentView.vue')
  assert.ok(v.includes('const csvCell ='), 'escaper defined')
  const uses = (v.match(/csvCell\(/g) || []).length
  assert.ok(uses >= 10, `all 10 columns through the escaper, found ${uses}`)
  assert.ok(!v.includes('`"${s.order_no}"`'), 'raw quoted cells gone')
})

await t.test('J-3 web product manage shows loading, error+retry, and empty', async () => {
  const v = read('apps/partner/src/views/ProductManageView.vue')
  assert.ok(v.includes('loadError'), 'load error state exists')
  assert.ok(v.includes('다시 불러오기'), 'retry offered')
  assert.ok(v.includes('등록된 상품이 없습니다'), 'empty state copy present')
  assert.ok(v.includes('불러오는 중입니다'), 'loading state copy present')
})

await t.test('J-3 web bulk upload references category ids', async () => {
  const v = read('apps/partner/src/views/BulkUploadView.vue')
  assert.ok(v.includes('/api/v1/categories'), 'category directory loaded')
  assert.ok(v.includes('카테고리 ID 참조'), 'reference block rendered')
})

t.finish()
