// Static contract tests for the storefront shell: SEO head tags, the theme
// pre-render snippet, service-worker registration and the worker's own safety
// rules (API bypass, hashed-assets-only cache, offline navigation fallback).
// Behavior proof is the storefront typecheck + production build (sw.js ships at
// dist/sw.js via public/) plus a real browser pass over the route matrix.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'

const t = createRunner('Storefront shell')
const SF = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps/storefront')
const read = (p) => readFileSync(join(SF, p), 'utf8')

await t.test('H01 head carries canonical, x-default hreflang and the theme pre-render snippet', async () => {
  const html = read('index.html')
  assert.ok(html.includes('<link rel="canonical" href="https://olmoa.com/" />'), 'canonical present')
  assert.ok(html.includes('<link rel="alternate" hreflang="x-default" href="https://olmoa.com/" />'), 'x-default hreflang present')
  assert.ok(!/<link rel="alternate" hreflang="(ko|en|ja)[^"]*"/.test(html), 'no per-locale hreflang without locale URLs')
  assert.ok(html.includes("localStorage.getItem('olmoa_theme')"), 'theme pre-render reads the saved mode')
  assert.ok(html.includes("setAttribute('data-theme'"), 'theme pre-render sets data-theme')
  assert.ok(html.includes('<link rel="manifest" href="/manifest.webmanifest" />'), 'PWA manifest linked')
})

await t.test('H02 the service worker is registered for production only', async () => {
  const main = read('src/main.ts')
  assert.ok(main.includes("navigator.serviceWorker.register('/sw.js')"), 'sw registered')
  assert.ok(main.includes('import.meta.env.PROD'), 'registration is production-gated')
  assert.ok(existsSync(join(SF, 'public/sw.js')), 'public/sw.js ships to dist root')
})

await t.test('H03 the worker never caches API or auth traffic', async () => {
  const sw = read('public/sw.js')
  assert.ok(/const VERSION = '[\w-]+'/.test(sw), 'versioned cache namespace')
  assert.ok(sw.includes("url.pathname.startsWith('/api/')"), 'API bypass present')
  assert.ok(sw.includes("req.method !== 'GET'"), 'non-GET pass-through present')
  assert.ok(sw.includes('url.origin !== self.location.origin'), 'cross-origin pass-through present')
  assert.ok(sw.includes("url.pathname.startsWith('/assets/')"), 'asset cache scope is /assets/* only')
  assert.ok(sw.includes('OFFLINE_HTML') && sw.includes("req.mode === 'navigate'"), 'offline navigation fallback present')
})

t.finish()
