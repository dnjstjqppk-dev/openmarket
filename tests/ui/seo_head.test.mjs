// Unit tests for the SPA head policy's pure core (mirrors gateway seo-head).
// Runs on Node ≥ 23 (TypeScript type stripping).   node tests/ui/seo_head.test.mjs
import assert from 'node:assert/strict'
import { createRunner } from '../lib/harness.mjs'
import { isNoindexPath, canonicalOf, routeHeadOf } from '../../packages/ui/src/composables/useSeoHead.ts'

const t = createRunner('SEO head core')

await t.test('S01 private routes are noindex, public routes index', async () => {
  for (const p of ['/cart', '/checkout', '/my/settings', '/orders/1', '/login', '/payments/success', '/ko/krw/cart', '/en/usd/checkout']) {
    assert.equal(isNoindexPath(p), true, p)
  }
  for (const p of ['/', '/ko/krw', '/ko/krw/p/p1/slug', '/ko/krw/c/beauty', '/ko/krw/search', '/ko/krw/store/s1']) {
    assert.equal(isNoindexPath(p), false, p)
  }
})

await t.test('S02 canonical strips query strings and uses /{lang}/{currency}', async () => {
  assert.equal(canonicalOf('https://olmoa.com/', '/ko/krw/p/p1/slug?sku=BLK&utm=x'), 'https://olmoa.com/ko/krw/p/p1/slug')
  assert.equal(canonicalOf('https://olmoa.com', '/ko/krw'), 'https://olmoa.com/ko/krw')
  assert.equal(canonicalOf('https://olmoa.com', '/ko/usd/p/p1/slug'), 'https://olmoa.com/ko/krw/p/p1/slug')
})

await t.test('S03 route head carries robots, canonical and clipped description', async () => {
  const h = routeHeadOf({ path: '/ko/krw/p/p1/earphone', base: 'https://olmoa.com', title: '이어폰 | OLMOA', description: 'x'.repeat(300) })
  assert.equal(h.robots, 'index,follow')
  assert.equal(h.canonical, 'https://olmoa.com/ko/krw/p/p1/earphone')
  assert.equal(h.description.length, 160)
  assert.equal(routeHeadOf({ path: '/ko/usd/p/p1/earphone', base: 'https://olmoa.com', title: 't' }).robots, 'noindex,follow')
  assert.equal(routeHeadOf({ path: '/ko/krw/cart', base: 'https://olmoa.com', title: 't' }).robots, 'noindex,nofollow')
})

t.finish()
