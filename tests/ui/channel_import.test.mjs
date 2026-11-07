// Static dead-end guards for channels and imports (Lane E): import UIs must
// only reference real category IDs, and every banner link target (server
// default + seed rows) must resolve to a storefront route.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'

const t = createRunner('Channel import dead-ends')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const DEAD_CATEGORIES = ['cat_f_shoes', 'cat_l_kitchen', 'cat_s_outdoor', 'cat_s_camp', 'cat_h_cook', 'cat_b_skin']

await t.test('E01 URL import category selects come from the live catalog', async () => {
  const v = read('apps/partner/src/views/UrlImportView.vue')
  assert.ok(v.includes('/api/v1/categories'), 'loads the live category list')
  for (const dead of DEAD_CATEGORIES) assert.ok(!v.includes(dead), `no dead ${dead} option`)
})

await t.test('E02 bulk-upload sample CSV references real category IDs', async () => {
  const v = read('apps/partner/src/views/BulkUploadView.vue')
  for (const dead of DEAD_CATEGORIES) assert.ok(!v.includes(dead), `no dead ${dead} in template`)
  assert.ok(v.includes('cat_sports') && v.includes('cat_h_kitchen') && v.includes('cat_beauty'), 'template uses seed category IDs')
})

await t.test('E03 every banner link target resolves to a storefront route', async () => {
  const router = read('apps/storefront/src/router/index.ts')
  const routes = [...router.matchAll(/path: '([^']+)'/g)].map((m) => m[1]).filter((p) => !p.includes('*'))
  assert.ok(routes.length > 20, `router parsed (${routes.length} routes)`)
  const resolves = (link) => routes.some((r) => {
    if (!r.includes(':')) return r === link
    const base = r.slice(0, r.indexOf(':') - 1)
    return link === base || link.startsWith(`${base}/`)
  })
  const admin = read('apps/cloudflare-gateway/src/routes/admin.js')
  const def = admin.match(/body\.link_url \|\| '([^']+)'/)
  assert.ok(def, 'banner default link found')
  assert.ok(resolves(def[1]), `default banner link ${def[1]} resolves`)
  const seed = read('migrations/d1_12_addresses_notifications_banners.sql')
  const seedLinks = [...seed.matchAll(/'(\/[a-z][a-z0-9/_-]*)', 'from-/g)].map((m) => m[1])
  assert.ok(seedLinks.length >= 3, `seed banner links parsed (${seedLinks.join(', ')})`)
  for (const link of seedLinks) assert.ok(resolves(link), `seed banner link ${link} resolves`)
})

t.finish()
