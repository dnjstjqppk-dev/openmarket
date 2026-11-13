// Work order 1-1: stale audit docs must carry a supersede notice and no
// longer claim VERIFIED status that contradicts the actual code.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'

const t = createRunner('Docs notice')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const NOTICE = '2026-11-13 기준 이 문서의 상태 표기는 OPENMARKET_WORK_ORDER.md로 대체됨'
const FILES = [
  'docs/audit/feature-parity-matrix.md',
  'docs/audit/route-gap-matrix.md',
  'reports/COMMERCIALIZATION_100_FINAL.md'
]

await t.test('D01 all three docs carry the supersede notice on top', async () => {
  for (const f of FILES) {
    const head = read(f).split('\n').slice(0, 4).join('\n')
    assert.ok(head.includes(NOTICE), `${f} must carry the notice in its first lines`)
  }
})

await t.test('D02 no stale VERIFIED claims remain', async () => {
  const parity = read(FILES[0])
  assert.ok(!parity.includes('미구현(MISSING)**: 0개'), 'parity matrix must not claim zero missing')
  assert.ok(!parity.includes('/order/:id'), 'parity matrix must not cite the old order path')
  assert.ok(parity.includes('/orders/:id'), 'parity matrix must cite the real order path')
  assert.ok(parity.includes('미구현'), 'parity matrix must mark gallery/gauge as actually missing')
  const routes = read(FILES[1])
  assert.ok(!routes.includes('/order/:id'), 'route matrix must not cite the old order path')
  assert.ok(routes.includes('/orders/:id'), 'route matrix must cite the real order path')
  const fin = read(FILES[2])
  assert.ok(fin.includes('18/27'), 'final report must carry actual design-system counts')
})

t.finish()
