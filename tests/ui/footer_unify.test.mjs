// Work order 1-10: unified operator identity across headers and footers.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'

const t = createRunner('Footer unify')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

await t.test('F01 admin header shows operator identity and mode', async () => {
  const app = read('apps/admin/src/App.vue')
  assert.ok(app.includes('business_reg_number'), 'registration number shown')
  assert.ok(app.includes('entity_type') || app.includes('법인'), 'entity type shown')
  assert.ok(app.includes('결제 '), 'payment mode shown')
})

await t.test('F02 storefront legal block covers escrow and shipping', async () => {
  const app = read('apps/storefront/src/App.vue')
  assert.ok(app.includes('구매안전서비스 안내'), 'escrow fallback text present')
  assert.ok(app.includes('/policy/escrow'), 'escrow fallback links the article')
  assert.ok(app.includes('remote-zones') || app.includes('도서산간'), 'remote surcharges sourced')
  assert.ok(app.includes('getFullYear'), 'copyright year computed')
})

await t.test('F03 consoles carry the same legal footer', async () => {
  for (const app of ['admin', 'partner']) {
    const src = read(`apps/${app}/src/App.vue`)
    assert.ok(src.includes('/api/v1/business-info'), `${app} reads the operator entity`)
    assert.ok(src.includes('legal_name'), `${app} shows the legal name`)
    assert.ok(src.includes('escrow_service_ref') || src.includes('구매안전서비스'), `${app} covers escrow`)
    assert.ok(src.includes('getFullYear'), `${app} computes the copyright year`)
  }
})

function routerPaths(app) {
  const src = read(`apps/${app}/src/router/index.ts`)
  return [...src.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1])
}

await t.test('F04 footer links resolve to defined routes', async () => {
  const app = read('apps/storefront/src/App.vue')
  const block = app.split('const footerColumns')[1].split('\n]\n')[0]
  const tos = [...block.matchAll(/to:\s*'([^']+)'/g)].map((m) => m[1])
  assert.ok(tos.length >= 10, `footer links enumerated (saw ${tos.length})`)
  const paths = routerPaths('storefront')
  for (const to of tos) {
    const ok = paths.some((p) => {
      if (!p.includes(':')) return p === to
      const re = new RegExp('^' + p.replace(/:[^/]+/g, '[^/]+') + '$')
      return re.test(to)
    })
    assert.ok(ok, `${to} resolves to a defined route`)
  }
})

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(vue|ts)$/.test(e)) out.push(p)
  }
  return out
}

await t.test('F05 no hardcoded support email anywhere', async () => {
  const files = ['apps/storefront/src', 'apps/admin/src', 'apps/partner/src'].flatMap((d) => walk(join(ROOT, d)))
  for (const f of files) {
    assert.ok(!readFileSync(f, 'utf8').includes('privacy@olmoa.com'), `${f} must fetch the address`)
  }
})

t.finish()
