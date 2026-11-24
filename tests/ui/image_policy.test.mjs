// Image loading policy guard (H-4). Every storefront <img> must declare its
// loading behavior (lazy, eager, or fetchpriority) and async decoding, and
// live inside a sized box (fixed classes or aspect ratio) so late images do
// not shift layout. Scans the shipped .vue sources; multiline tags included.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'

const t = createRunner('Storefront image policy')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function vueFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...vueFiles(full))
    else if (name.endsWith('.vue')) out.push(full)
  }
  return out
}

function imgTags(source) {
  // Comments may discuss <img> handling (ReviewsPanel documents the renderer
  // allowlist); only real tags are pinned.
  const code = source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1')
  const tags = []
  const re = /<img\b[\s\S]*?\/>/g
  let m
  while ((m = re.exec(code)) !== null) tags.push(m[0])
  return tags
}

await t.test('I01 every storefront img declares loading behavior', async () => {
  const files = vueFiles(join(ROOT, 'apps/storefront/src'))
  assert.ok(files.length > 10, 'scanned the storefront sources')
  let count = 0
  for (const file of files) {
    const rel = file.slice(ROOT.length + 1)
    for (const tag of imgTags(readFileSync(file, 'utf8'))) {
      count++
      // Dynamic :loading counts (ProductCard eager prop); decoding is static.
      const loading = /loading=|fetchpriority=/.test(tag)
      assert.ok(loading, `${rel}: img must declare loading or fetchpriority: ${tag.slice(0, 120)}`)
      assert.ok(/decoding=/.test(tag) || /fetchpriority=/.test(tag), `${rel}: img must decode async or be a priority hero: ${tag.slice(0, 120)}`)
    }
  }
  assert.ok(count >= 8, `expected a real img inventory, found ${count}`)
})

await t.test('I02 every storefront img lives in a sized box', async () => {
  const files = vueFiles(join(ROOT, 'apps/storefront/src'))
  for (const file of files) {
    const rel = file.slice(ROOT.length + 1)
    for (const tag of imgTags(readFileSync(file, 'utf8'))) {
      const sized = /(h-\S+.*w-\S+|w-\S+.*h-\S+|aspect-|inset-0)/.test(tag)
      assert.ok(sized, `${rel}: img needs fixed dimensions or an aspect box (CLS): ${tag.slice(0, 120)}`)
    }
  }
})

// GAP-04: partner sample/template strings use documentation URLs, never a
// stock-photo host (runtime fallbacks were already removed in 4d907d0).
await t.test('I04 partner samples use documentation image URLs', async () => {
  for (const f of ['apps/partner/src/views/BulkUploadView.vue', 'apps/partner/src/views/UrlImportView.vue']) {
    const v = readFileSync(join(ROOT, f), 'utf8')
    for (const host of ['unsplash', 'picsum', 'placeholder.com', 'placehold.co', 'loremflickr']) {
      assert.ok(!v.includes(host), `${f} sample must not use ${host}`)
    }
  }
  const csv = readFileSync(join(ROOT, 'apps/partner/src/views/BulkUploadView.vue'), 'utf8')
  assert.ok(csv.includes('thumbnail_url'), 'template keeps the thumbnail column')
  const httpsCount = (csv.match(/https:\/\//g) || []).length
  assert.ok(httpsCount >= 3, 'template keeps absolute https sample thumbnails')
})

// Work order 1-11: missing product images fall back to a neutral icon, never a stock photo.
await t.test('I03 order thumbnails use the neutral image fallback', async () => {
  const v = readFileSync(join(ROOT, 'apps/storefront/src/views/OrdersView.vue'), 'utf8')
  assert.ok(!v.includes('unsplash'), 'no stock-photo fallback in order thumbnails')
  assert.ok(v.includes('<OmImage'), 'order thumbnails render through OmImage')
  const img = readFileSync(join(ROOT, 'packages/ui/src/components/OmImage.vue'), 'utf8')
  assert.ok(img.includes('ImageOff'), 'neutral error icon present')
  assert.ok(img.includes('이미지 없음'), 'neutral fallback label present')
  assert.ok(!/https?:\/\//.test(img), 'OmImage substitutes no remote fallback')
})

t.finish()
