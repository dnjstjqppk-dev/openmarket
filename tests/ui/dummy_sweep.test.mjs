// Work order 1-11: no dummy content in shipped sources.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'

const t = createRunner('Dummy sweep')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(vue|ts)$/.test(e)) out.push(p)
  }
  return out
}

await t.test('G01 no lorem/picsum/unsplash/TODO in shipped sources', async () => {
  const files = ['apps/storefront/src', 'apps/admin/src', 'apps/partner/src', 'packages/ui/src']
    .flatMap((d) => walk(join(ROOT, d)))
  assert.ok(files.length > 150, `expected 150+ sources, saw ${files.length}`)
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const s of ['lorem', 'picsum', 'unsplash']) {
      assert.ok(!src.toLowerCase().includes(s), `${f} must not contain ${s}`)
    }
    assert.ok(!/\b(?:TODO|FIXME)\b/.test(src), `${f} must not contain TODO/FIXME`)
  }
})

await t.test('G02 order thumbnails degrade to a neutral placeholder', async () => {
  const v = read('apps/storefront/src/views/OrdersView.vue')
  assert.ok(v.includes('이미지 준비 중'), 'missing thumbnails show a neutral placeholder')
})

await t.test('G03 no fabricated carrier or company defaults', async () => {
  assert.ok(!read('apps/admin/src/views/SuppliersView.vue').includes("|| 'CJ대한통운'"), 'carrier input must not default to a brand')
  const terms = read('apps/storefront/src/views/LegalTermsView.vue')
  assert.ok(!terms.includes("|| '올모아'"), 'terms must not assume the company name')
  assert.ok(terms.includes('상호 미등록'), 'missing company shows an honest marker')
})

await t.test('G04 price-match copy uses the real window', async () => {
  assert.ok(read('apps/storefront/src/config/policy.ts').includes('PRICE_ADJUST_WINDOW_DAYS = 30'), 'window pinned at 30')
  assert.ok(read('apps/storefront/src/views/ProductDetailView.vue').includes('PRICE_ADJUST_WINDOW_DAYS'), 'detail view reads the constant')
})

t.finish()
