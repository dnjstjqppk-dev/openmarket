// Stale-chunk recovery after a deploy (packages/ui/src/chunkReload.ts) and the
// service-worker rule that keeps SPA HTML out of the hashed-asset cache.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'
import { isChunkLoadError, shouldReloadForChunk } from '../../packages/ui/src/chunkReload.ts'

const t = createRunner('Chunk reload guard')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

function memStore() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }
}

await t.test('C01 browser chunk-failure messages are recognized; ordinary errors are not', () => {
  for (const msg of [
    'Failed to fetch dynamically imported module: https://olmoa.com/assets/CartView-abc.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    "Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of \"text/html\".",
    'Unable to preload CSS for /assets/x.css'
  ]) assert.ok(isChunkLoadError(new TypeError(msg)), msg)
  assert.ok(!isChunkLoadError(new Error('Network request failed: 500')))
  assert.ok(!isChunkLoadError(null))
  assert.ok(!isChunkLoadError(new Error('Cannot read properties of undefined')))
})

await t.test('C02 one reload per 10 s window — a genuinely broken chunk cannot loop', () => {
  const s = memStore()
  assert.equal(shouldReloadForChunk(s, 1_000_000), true)
  assert.equal(shouldReloadForChunk(s, 1_005_000), false, 'second failure right after the reload: stop')
  assert.equal(shouldReloadForChunk(s, 1_011_000), true, 'a later deploy may reload again')
})

await t.test('C03 unusable storage fails safe (no reload instead of a possible loop)', () => {
  assert.equal(shouldReloadForChunk(null, 1), false)
  const throwing = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } }
  assert.equal(shouldReloadForChunk(throwing, 1), false)
})

await t.test('C04 all three apps install the guard on their router', () => {
  for (const app of ['storefront', 'admin', 'partner']) {
    const main = read(`apps/${app}/src/main.ts`)
    assert.ok(main.includes('installChunkReloadGuard(router)'), `${app}: guard installed`)
  }
})

await t.test('C05 service workers never cache an HTML response under /assets/', () => {
  for (const app of ['storefront', 'admin', 'partner']) {
    const sw = read(`apps/${app}/public/sw.js`)
    assert.ok(/res\.ok && !String\(res\.headers\.get\('Content-Type'\) \|\| ''\)\.includes\('text\/html'\)\) cache\.put/.test(sw), `${app}: HTML excluded`)
    assert.ok(!/if \(res\.ok\) cache\.put/.test(sw), `${app}: no unconditional cache.put`)
    assert.ok(!/-v1';/.test(sw), `${app}: cache version bumped past v1 (purges poisoned entries)`)
  }
})

t.finish()
