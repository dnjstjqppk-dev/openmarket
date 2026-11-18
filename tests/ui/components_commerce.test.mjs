// Work order 1-4: commerce components. Pure display logic is unit-tested for
// real; SFC structure (states, a11y, tokens) is pinned by source markers.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'
import {
  priceDisplayLines, clampQuantity, countdownParts, ratingVisible, tablePages, soldoutPct
} from '../../packages/ui/src/commerce.ts'

const t = createRunner('Commerce components')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ui = (p) => readFileSync(join(ROOT, 'packages/ui/src', p), 'utf8')
const has = (f, ...marks) => {
  const p = join(ROOT, 'packages/ui/src', f)
  assert.ok(existsSync(p), `${f} must exist`)
  const src = readFileSync(p, 'utf8')
  for (const m of marks) assert.ok(src.includes(m), `${f} must contain ${m}`)
}

await t.test('C01 price order and discount gate', async () => {
  assert.deepEqual(priceDisplayLines(20000, 15000), { list: 20000, rate: 25, final: 15000 })
  assert.deepEqual(priceDisplayLines(15000, 15000), { list: null, rate: null, final: 15000 })
  assert.deepEqual(priceDisplayLines(null, 15000), { list: null, rate: null, final: 15000 })
  assert.deepEqual(priceDisplayLines(0, 15000), { list: null, rate: null, final: 15000 })
  has('components/OmPrice.vue', 'text-price', 'text-discount', 'om-price-list')
})

await t.test('C02 quantity clamps to 1..stock', async () => {
  assert.equal(clampQuantity(100, 5), 5)
  assert.equal(clampQuantity(0, 5), 1)
  assert.equal(clampQuantity(-3, 5), 1)
  assert.equal(clampQuantity(3, 5), 3)
  has('components/OmQuantityStepper.vue', 'clampQuantity', ':disabled')
})

await t.test('C03 countdown parts and expiry', async () => {
  assert.deepEqual(countdownParts(90061000, 0), { d: 1, h: 1, m: 1, s: 1, expired: false })
  assert.deepEqual(countdownParts(0, 1), { d: 0, h: 0, m: 0, s: 0, expired: true })
  has('components/OmCountdown.vue', 'setInterval', 'clearInterval', '1000', 'expired')
})

await t.test('C04 rating hidden without reviews, table page math', async () => {
  assert.equal(ratingVisible(0), false)
  assert.equal(ratingVisible(3), true)
  assert.equal(tablePages(0, 50), 1)
  assert.equal(tablePages(101, 50), 3)
  assert.equal(soldoutPct(30, 100), 30)
  assert.equal(soldoutPct(5, 0), null)
  has('components/OmRating.vue', 'toFixed(1)')
  has('components/OmProgress.vue', 'role="progressbar"', 'aria-valuenow')
})

await t.test('C05 carousel pause, keys and reduced motion', async () => {
  has('components/OmCarousel.vue', 'ause', 'ArrowLeft', 'ArrowRight', 'prefers-reduced-motion', 'touchstart')
})

await t.test('C06 gallery, sheet, tabs, foldable markers', async () => {
  has('components/OmImageGallery.vue', 'thumbnail', 'Maximize2', 'images.length')
  has('components/OmBottomSheet.vue', 'useOverlay', 'om-safe-bottom', 'touchstart')
  has('components/OmStickyTabs.vue', 'sticky', 'IntersectionObserver')
  has('components/OmFoldable.vue', 'gradient', '상세정보 펼쳐보기')
})

await t.test('C07 filter, toggle, cards and number/badge markers', async () => {
  has('components/OmFilterPanel.vue', '240px', 'OmBottomSheet')
  has('components/OmFilterChips.vue', '전체 초기화')
  has('components/OmViewToggle.vue', 'LayoutGrid', 'List')
  has('components/OmProductCard.vue', 'formatPrice')
  has('components/OmSellerCard.vue', '응답률', '스토어 홈', '문의')
  has('components/OmNumber.vue', 'om-num', '▲', '▼')
  has('components/OmCommerceBadge.vue', 'h-5', '무료배송', '오늘출발', '내일출발', '쿠폰', '적립', '직영', '특가', '품절', '신상품')
})

await t.test('C08 confirm dialog, shell, kpi and console markers', async () => {
  has('composables/useConfirm.ts', 'Promise', 'danger')
  has('components/OmConfirmDialog.vue', 'role="alertdialog"')
  has('components/OmConsoleShell.vue', '240px', '64px')
  has('components/OmKpiCard.vue', 'RouterLink')
  has('components/OmDataTable.vue', 'sticky')
  has('components/OmStatusTabs.vue', 'count')
  has('components/OmDateRangePicker.vue', '오늘', '1주일', '1개월', '3개월', '직접 입력')
  has('components/OmSearchFilterBar.vue', '접기')
  has('components/OmAddressSearch.vue', '우편번호', '직접 입력')
  has('components/OmImage.vue', 'loading')
  const img = ui('components/OmImage.vue')
  for (const s of ['picsum', 'unsplash', 'placeholder.com', 'placehold']) assert.ok(!img.includes(s), `OmImage must not use ${s}`)
})

await t.test('C09 barrel exports every new component', async () => {
  const idx = ui('index.ts')
  for (const n of ['OmPrice', 'OmNumber', 'OmRating', 'OmCommerceBadge', 'OmCountdown', 'OmProgress',
    'OmQuantityStepper', 'OmCarousel', 'OmImageGallery', 'OmBottomSheet', 'OmStickyTabs', 'OmFoldable',
    'OmFilterPanel', 'OmFilterChips', 'OmViewToggle', 'OmProductCard', 'OmSellerCard', 'useConfirm',
    'OmConfirmDialog', 'OmConsoleShell', 'OmKpiCard', 'OmStatusTabs', 'OmDateRangePicker',
    'OmSearchFilterBar', 'OmAddressSearch', 'OmImage']) assert.ok(idx.includes(n), `index.ts must export ${n}`)
})

await t.test('C10 image accepts srcset with origin fallback (5-9/K-15)', async () => {
  has('components/OmImage.vue', 'srcset?: string', ':srcset="srcset || undefined"', ':sizes="sizes || undefined"')
})

t.finish()
