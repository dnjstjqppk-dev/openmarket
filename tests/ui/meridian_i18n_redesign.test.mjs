// Verification suite for OLMOA Meridian 2.0 redesign, 4-language i18n completeness,
// currency formatting propagation on product cards, and Admin FX Rate Management UI.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'
import { UI_PHRASES, UI_LOCALE_OPTIONS } from '../../packages/ui/src/i18n/phrases.ts'

const t = createRunner('Meridian 2.0 redesign & 4-language i18n')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const HANGUL = /[\uAC00-\uD7A3]/

await t.test('M01 storefront 4-language dictionaries have 150+ keys and zero stray Hangul in non-KR', async () => {
  const ko = JSON.parse(read('apps/storefront/src/locales/ko-KR.json'))
  const en = JSON.parse(read('apps/storefront/src/locales/en-US.json'))
  const ja = JSON.parse(read('apps/storefront/src/locales/ja-JP.json'))
  const zh = JSON.parse(read('apps/storefront/src/locales/zh-TW.json'))
  const keys = Object.keys(ko).sort()
  assert.ok(keys.length >= 150, `expected >= 150 keys, got ${keys.length}`)
  for (const [name, dict] of [['en-US', en], ['ja-JP', ja], ['zh-TW', zh]]) {
    assert.deepEqual(Object.keys(dict).sort(), keys, `${name} key parity`)
    for (const [k, v] of Object.entries(dict)) {
      assert.ok(typeof v === 'string' && v.trim().length > 0, `${name}.${k} non-empty`)
      assert.ok(!HANGUL.test(v), `${name}.${k} must not contain untranslated Hangul: ${v}`)
    }
  }
})

await t.test('M02 shared @olmoa/ui phrasebook covers 180+ entries across 4 locales with zero stray Hangul', async () => {
  assert.equal(UI_LOCALE_OPTIONS.length, 4, '4 supported UI locales')
  const entries = Object.entries(UI_PHRASES)
  assert.ok(entries.length >= 180, `expected >= 180 UI phrases, got ${entries.length}`)
  for (const [ko, tr] of entries) {
    for (const lang of ['en', 'ja', 'zh']) {
      assert.ok(typeof tr[lang] === 'string' && tr[lang].trim().length > 0, `${ko}.${lang} non-empty`)
      assert.ok(!HANGUL.test(tr[lang]), `${ko}.${lang} must not contain Hangul: ${tr[lang]}`)
    }
  }
})

await t.test('M03 OmProductCard forwards formatPrice to OmPrice so non-KRW currencies render on all grids', async () => {
  const card = read('packages/ui/src/components/OmProductCard.vue')
  assert.ok(card.includes(':format-price="formatPrice"'), 'OmProductCard passes formatPrice to OmPrice')
  assert.ok(card.includes('uiT('), 'OmProductCard translates UI labels via uiT')
})

await t.test('M04 all three web apps install DOM locale sync and wire 4-language + theme controls', async () => {
  for (const app of ['storefront', 'partner', 'admin']) {
    const main = read(`apps/${app}/src/main.ts`)
    const shell = read(`apps/${app}/src/App.vue`)
    assert.ok(main.includes('installDomLocaleSync'), `${app} main installs DOM locale sync`)
    assert.ok(main.includes('useTheme().init()'), `${app} main initializes theme`)
    assert.ok(shell.includes('nextThemeMode'), `${app} App wires theme switcher`)
  }
  for (const app of ['partner', 'admin']) {
    const shell = read(`apps/${app}/src/App.vue`)
    assert.ok(shell.includes('useUiLocale'), `${app} App wires 4-language selector`)
    assert.ok(shell.includes('localeOptions'), `${app} App renders all 4 language options`)
  }
  const sfStore = read('apps/storefront/src/stores/locale.ts')
  assert.ok(sfStore.includes('setUiLocale(newLoc)'), 'storefront locale store syncs @olmoa/ui locale')
})

await t.test('M05 Admin FX Rate Management console is routed, linked, and wired to admin FX API', async () => {
  const view = read('apps/admin/src/views/finance/FxRatesView.vue')
  assert.ok(view.includes('/api/v1/admin/fx-rates'), 'wires admin FX API')
  assert.ok(view.includes("method: 'PUT'") && view.includes("method: 'DELETE'"), 'supports PUT and DELETE')
  assert.ok(view.includes('useConfirm'), 'confirms destructive rate deletion')
  assert.ok(view.includes('TWD') && view.includes('USD') && view.includes('JPY'), 'supports core global currencies including TWD')
  const router = read('apps/admin/src/router/index.ts')
  assert.ok(router.includes("path: '/finance/fx-rates'"), 'admin route registered')
  const app = read('apps/admin/src/App.vue')
  assert.ok(app.includes('/finance/fx-rates') && app.includes('환율 관리'), 'admin menu links FX rates')
})

await t.test('M06 Meridian 2.0 tokens set Cobalt brand primary and modern radii', async () => {
  const tokens = read('packages/ui/src/styles/tokens.css')
  assert.ok(tokens.includes('29 78 216'), 'Meridian Cobalt brand primary present')
  assert.ok(tokens.includes('--om-radius-lg: 16px'), 'modern 16px card radius present')
  assert.ok(tokens.includes('--om-header-h: 68px'), '68px header height present')
})

t.finish()
