// Work order 1-3: type/number/spacing rules live in the shared stylesheet
// and amount formatting funnels through the helpers (frozen, then converted
// as stages 3-4 rewrite each view — see Q-1-3).
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'

const t = createRunner('Type scale')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const css = readFileSync(join(ROOT, 'packages/ui/src/styles/index.css'), 'utf8')

await t.test('T01 base type scale and price sizes', async () => {
  for (const s of [
    'h1', '1.5rem', '@media', '1.25rem',
    '.om-price-final', '1.875rem', '700',
    '.om-price-total', '.om-price-card', '1rem',
    '.om-price-list', 'line-through', '0.75rem'
  ]) assert.ok(css.includes(s), `index.css must contain ${s}`)
})

await t.test('T02 tabular numbers and right-aligned amounts', async () => {
  assert.ok(css.includes('.om-num'), '.om-num must exist')
  assert.ok(css.includes('tabular-nums'), 'tabular-nums must be set')
  assert.ok(css.includes('.om-amount'), '.om-amount must exist')
  assert.ok(/\.om-amount\s*\{[^}]*text-align:\s*right/.test(css), '.om-amount must right-align')
})

await t.test('T03 product grid columns per breakpoint', async () => {
  assert.ok(css.includes('.om-product-grid'), '.om-product-grid must exist')
  for (const s of [
    'repeat(2,', 'min-width: 768px', 'repeat(3,',
    'min-width: 1024px', 'repeat(4,', 'min-width: 1366px', 'repeat(5,',
    'min-width: 1920px', 'repeat(6,', 'gap: 8px 20px', 'gap: 12px 24px'
  ]) assert.ok(css.includes(s), `grid css must contain ${s}`)
})

await t.test('T04 console row and input heights', async () => {
  assert.ok(/\.om-row\s*\{\s*height:\s*44px/.test(css), '.om-row must be 44px')
  assert.ok(/\.om-row-dense\s*\{\s*height:\s*36px/.test(css), '.om-row-dense must be 36px')
  assert.ok(/\.om-input\s*\{\s*height:\s*36px/.test(css), '.om-input must be 36px')
})

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(vue|ts)$/.test(e) && !/(format|locale|policy)\.ts$/.test(e)) out.push(p)
  }
  return out
}

await t.test('T05 direct toLocaleString calls are frozen', async () => {
  let n = 0
  const files = [
    ...walk(join(ROOT, 'apps/storefront/src')),
    ...walk(join(ROOT, 'apps/admin/src')),
    ...walk(join(ROOT, 'apps/partner/src')),
    ...walk(join(ROOT, 'packages/ui/src'))
  ]
  for (const f of files) {
    const m = readFileSync(f, 'utf8').match(/toLocaleString\(/g)
    if (m) n += m.length
  }
  assert.ok(n <= 83, `direct calls must not grow (now ${n}, cap 83)`)
})

t.finish()
