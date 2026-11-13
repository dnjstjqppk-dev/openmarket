// Static contract tests for the admin + partner console shells: PWA manifest
// linkage, production-only service-worker registration, and the worker's own
// safety rules (mirrors tests/ui/storefront_shell.test.mjs H01-H03 for OPS-10).
// Behavior proof is each console's typecheck + production build (sw.js and the
// manifest ship at dist/ via public/).
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'

const t = createRunner('Console shells (admin + partner PWA)')
const UI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps')
const read = (app, p) => readFileSync(join(UI, app, p), 'utf8')
const exists = (app, p) => existsSync(join(UI, app, p))

for (const app of ['admin', 'partner']) {
  await t.test(`${app} C01 head links a valid PWA manifest`, async () => {
    const html = read(app, 'index.html')
    assert.ok(html.includes('<link rel="manifest" href="/manifest.webmanifest" />'), 'manifest linked')
    assert.ok(exists(app, 'public/manifest.webmanifest'), 'public/manifest.webmanifest ships to dist root')
    const manifest = JSON.parse(read(app, 'public/manifest.webmanifest'))
    assert.ok(typeof manifest.name === 'string' && manifest.name.includes('OLMOA'), 'manifest names the console')
    assert.equal(manifest.start_url, '/', 'manifest starts at the console root')
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest carries icons')
    for (const icon of manifest.icons) {
      assert.ok(exists(app, `public${icon.src}`), `icon ships: ${icon.src}`)
    }
  })

  await t.test(`${app} C02 the service worker is registered for production only`, async () => {
    const main = read(app, 'src/main.ts')
    assert.ok(main.includes("navigator.serviceWorker.register('/sw.js')"), 'sw registered')
    assert.ok(main.includes('import.meta.env.PROD'), 'registration is production-gated')
    assert.ok(exists(app, 'public/sw.js'), 'public/sw.js ships to dist root')
  })

  await t.test(`${app} C03 the worker never caches API or auth traffic`, async () => {
    const sw = read(app, 'public/sw.js')
    assert.ok(/const VERSION = '[\w-]+'/.test(sw), 'versioned cache namespace')
    assert.ok(sw.includes("url.pathname.startsWith('/api/')"), 'API bypass present')
    assert.ok(sw.includes("req.method !== 'GET'"), 'non-GET pass-through present')
    assert.ok(sw.includes('url.origin !== self.location.origin'), 'cross-origin pass-through present')
    assert.ok(sw.includes("url.pathname.startsWith('/assets/')"), 'asset cache scope is /assets/* only')
    assert.ok(sw.includes('OFFLINE_HTML') && sw.includes("req.mode === 'navigate'"), 'offline navigation fallback present')
  })
}

// Work order 1-7: both consoles run on OmConsoleShell with grouped menus.
await t.test('S01 partner shell uses OmConsoleShell with a live header', async () => {
  const app = read('partner', 'src/App.vue')
  assert.ok(app.includes('OmConsoleShell'), 'partner App renders OmConsoleShell')
  assert.ok(!app.includes('Top Navigation Bar'), 'old top nav is gone')
  assert.ok(app.includes('/api/v1/partner/profile'), 'header reads the partner profile')
  for (const s of ['입점 상태', '정산계좌']) assert.ok(app.includes(s), `header shows ${s}`)
})

await t.test('S02 admin shell uses OmConsoleShell with role filtering', async () => {
  const app = read('admin', 'src/App.vue')
  assert.ok(app.includes('OmConsoleShell'), 'admin App renders OmConsoleShell')
  assert.ok(app.includes('canSee('), 'role filtering kept')
  assert.ok(app.includes('/api/v1/business-info'), 'header reads the operator entity')
  assert.ok(app.includes('/api/v1/payments/config'), 'header reads the payment mode')
})

await t.test('S03 partner menu groups match the specified structure', async () => {
  const app = read('partner', 'src/App.vue')
  for (const s of ['대시보드', '상품', '주문·배송', '클레임', '정산', '고객', '스토어', '확장']) {
    assert.ok(app.includes(`label: '${s}'`), `partner menu has ${s}`)
  }
})

await t.test('S04 admin menu groups match the specified structure', async () => {
  const app = read('admin', 'src/App.vue')
  for (const s of ['대시보드', '입점·셀러', '상품', '주문·클레임', '정산·재무', '마케팅', '고객', '운영', '보안']) {
    assert.ok(app.includes(`label: '${s}'`), `admin menu has ${s}`)
  }
})

await t.test('S05 pre-existing routes still resolve', async () => {
  const partner = read('partner', 'src/router/index.ts')
  for (const p of ['/login', '/apply', '/application', '/', '/products', '/bidding', '/bulk-upload', '/imports', '/channels', '/shipments', '/returns', '/settlements', '/qna', '/profile']) {
    assert.ok(partner.includes(`path: '${p}'`), `partner keeps ${p}`)
  }
  const admin = read('admin', 'src/router/index.ts')
  for (const p of ['/login', '/', '/products', '/partners', '/ledger', '/orders', '/users', '/reviews', '/coupons', '/categories', '/marketing', '/business', '/suppliers', '/supplier-integrations', '/reconciliation', '/partner-applications', '/security', '/audit-log', '/inquiries', '/shipping-zones']) {
    assert.ok(admin.includes(`path: '${p}'`), `admin keeps ${p}`)
  }
})

t.finish()
