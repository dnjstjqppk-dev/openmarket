// Unit tests for the autocomplete controller used by every search box (PHASE 3 requirements).
// Runs on Node ≥ 23 (TypeScript type stripping).   node tests/ui/autocomplete_core.test.mjs
import assert from 'node:assert/strict'
import { createRunner } from '../lib/harness.mjs'
import { createAutocomplete, normalizeQuery } from '../../packages/ui/src/composables/autocompleteCore.ts'

const t = createRunner('Autocomplete core')

// Manual clock: debounce timers fire only when we say so.
function clock() {
  const q = []
  return {
    set: (fn, ms) => { const h = { fn, ms }; q.push(h); return h },
    clear: (h) => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1) },
    flush: async () => { while (q.length) { q.shift().fn(); await new Promise((r) => setImmediate(r)) } }
  }
}
const groupsFor = (q) => [{ key: 'product', label: '상품', items: [{ id: `p-${q}`, type: 'product', label: q }] }]

await t.test('A01 debounce: only the last keystroke is sent', async () => {
  const c = clock(); const sent = []
  const ac = createAutocomplete({ timers: c, onChange: () => {}, fetcher: async (q) => { sent.push(q); return groupsFor(q) } })
  ac.input('ㅇ'); ac.input('올'); ac.input('올모')
  await c.flush()
  assert.deepEqual(sent, ['올모'])
})

await t.test('A02 IME: no request during composition, one request after compositionend', async () => {
  const c = clock(); const sent = []
  const ac = createAutocomplete({ timers: c, onChange: () => {}, fetcher: async (q) => { sent.push(q); return groupsFor(q) } })
  ac.compositionStart()
  ac.input('ㅎ'); ac.input('하'); ac.input('한')
  await c.flush()
  assert.deepEqual(sent, [], 'nothing sent while composing')
  ac.compositionEnd('한')
  await c.flush()
  assert.deepEqual(sent, ['한'])
})

await t.test('A03 stale response: a slow earlier reply never overwrites the newer one; earlier request is aborted', async () => {
  const c = clock(); const resolvers = {}; const aborted = []; let last
  const ac = createAutocomplete({
    timers: c,
    onChange: (s) => { last = s },
    fetcher: (q, signal) => new Promise((res) => { resolvers[q] = res; signal.addEventListener('abort', () => aborted.push(q)) })
  })
  ac.input('가방'); await c.flush()
  ac.input('가방끈'); await c.flush()
  assert.deepEqual(aborted, ['가방'])
  resolvers['가방끈'](groupsFor('가방끈')); await new Promise((r) => setImmediate(r))
  resolvers['가방'](groupsFor('가방')); await new Promise((r) => setImmediate(r))
  assert.equal(last.settledQuery, '가방끈')
  assert.equal(last.groups[0].items[0].id, 'p-가방끈')
})

await t.test('A04 min chars / empty query: no request, results cleared', async () => {
  const c = clock(); const sent = []; let last
  const ac = createAutocomplete({ timers: c, minChars: 2, onChange: (s) => { last = s }, fetcher: async (q) => { sent.push(q); return groupsFor(q) } })
  ac.input('a'); await c.flush()
  ac.input('   '); await c.flush()
  assert.deepEqual(sent, [])
  assert.equal(last.groups.length, 0)
})

await t.test('A05 duplicate query and cache: same normalised query is not re-sent', async () => {
  const c = clock(); const sent = []
  const ac = createAutocomplete({ timers: c, onChange: () => {}, fetcher: async (q) => { sent.push(q); return groupsFor(q) } })
  ac.input('Shoes'); await c.flush()
  ac.input('  shoes '); await c.flush()
  ac.input('shoe'); await c.flush()
  ac.input('shoes'); await c.flush()
  assert.deepEqual(sent, ['shoes', 'shoe'])
})

await t.test('A06 errors are surfaced (not shown as "no results") and retry works', async () => {
  const c = clock(); let fail = true; let last
  const ac = createAutocomplete({ timers: c, onChange: (s) => { last = s }, fetcher: async (q) => { if (fail) throw new Error('서버 오류'); return groupsFor(q) } })
  ac.input('mug'); await c.flush(); await new Promise((r) => setImmediate(r))
  assert.equal(last.error, '서버 오류')
  assert.equal(last.settledQuery, '', 'an error is not a settled empty result')
  fail = false
  ac.retry(); await new Promise((r) => setImmediate(r))
  assert.equal(last.error, null)
  assert.equal(last.groups[0].items[0].id, 'p-mug')
})

await t.test('A07 normalisation: NFC, whitespace, case', async () => {
  assert.equal(normalizeQuery('  Ａ  b\tC '), 'ａ b c'.replace('ａ', 'Ａ'.normalize('NFC').toLowerCase()))
  assert.equal(normalizeQuery('한ㄱ'), '한ㄱ')
})

t.finish()
