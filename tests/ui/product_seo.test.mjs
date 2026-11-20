// Unit tests for PDP/PLP SEO builders (pure, live rows only).   node tests/ui/product_seo.test.mjs
import assert from 'node:assert/strict'
import { createRunner } from '../lib/harness.mjs'
import { plainText, lowestPriceOf, inStockOf, productHeadOf, productJsonLdOf, plpJsonLdOf } from '../../apps/storefront/src/lib/productSeo.ts'

const t = createRunner('Product SEO builders')

const live = {
  title: '무선 이어폰 Pro', description_html: '<p>노이즈캔슬링 <b>이어폰</b></p>', thumbnail_url: 'https://cdn/x.jpg',
  category_slug: 'audio', category_name: '오디오', review_count: 12, avg_rating: 4.5,
  skus: [{ sale_price: 59000, stock_quantity: 3 }, { sale_price: 49000, stock_quantity: 0 }]
}

await t.test('P01 lowest price and stock read live SKUs only', async () => {
  assert.equal(lowestPriceOf(live), 49000)
  assert.equal(inStockOf(live), true)
  assert.equal(lowestPriceOf({ skus: [] }), null)
  assert.equal(lowestPriceOf({ lowest_sale_price: 9900 }), 9900)
  assert.equal(inStockOf({ skus: [{ stock_quantity: 0 }] }), false)
  assert.equal(plainText('<p>a  b</p>', 10), 'a b')
})

await t.test('P02 head input carries PDP title, description and image', async () => {
  const h = productHeadOf(live, '/product/earphones', 'https://olmoa.com')
  assert.equal(h.title, '무선 이어폰 Pro | OLMOA')
  assert.ok(h.description.includes('노이즈캔슬링') && !h.description.includes('<p>'))
  assert.equal(h.image, 'https://cdn/x.jpg')
})

await t.test('P03 product JSON-LD omits missing offer and rating nodes', async () => {
  const full = productJsonLdOf(live, 'https://olmoa.com/product/earphones')
  const product = full['@graph'][0]
  assert.equal(product['@type'], 'Product')
  assert.equal(product.offers.price, 49000)
  assert.equal(product.offers.priceCurrency, 'KRW')
  assert.equal(product.aggregateRating.reviewCount, 12)
  assert.equal(full['@graph'][1]['@type'], 'BreadcrumbList')
  const bare = productJsonLdOf({ title: 'X' }, 'https://olmoa.com/product/x')['@graph'][0]
  assert.ok(!('offers' in bare) && !('aggregateRating' in bare))
})

await t.test('P04 PLP ItemList keeps real product URLs only', async () => {
  const g = plpJsonLdOf('오디오', 'https://olmoa.com/category/audio', [
    { slug: 'a', title: 'A' }, { title: 'no-id' }, { id: 'c', title: 'C' }
  ], 'https://olmoa.com/')
  assert.equal(g['@type'], 'CollectionPage')
  assert.equal(g.mainEntity.numberOfItems, 2)
  assert.equal(g.mainEntity.itemListElement[0].url, 'https://olmoa.com/product/a')
})

t.finish()
