// Unit tests for the storefront locale scaffold (vue-i18n + locales/*.json).
// Runs on Node: JSON is read with fs because src/i18n.ts uses Vite-style JSON
// imports (resolveJsonModule) that Node ESM cannot load directly. The wiring
// itself (app.use(i18n), store delegation) is covered by static assertions here
// plus the storefront typecheck and production build.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'
import { createI18n } from 'vue-i18n'

const t = createRunner('Storefront locales')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LOCALES_DIR = join(ROOT, 'apps/storefront/src/locales')
const SRC_DIR = join(ROOT, 'apps/storefront/src')
const read = (p) => readFileSync(p, 'utf8')

function loadMessages() {
  const messages = {}
  for (const f of readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json')).sort()) {
    messages[f.replace('.json', '')] = JSON.parse(read(join(LOCALES_DIR, f)))
  }
  return messages
}

// Same options as apps/storefront/src/i18n.ts (locale 'en-US' forces fallback paths).
function testI18n(messages, locale = 'en-US') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'ko-KR', missingWarn: false, fallbackWarn: false, messages })
}

await t.test('L01 the three locales parse with identical non-empty key sets', async () => {
  const messages = loadMessages()
  assert.deepEqual(Object.keys(messages), ['en-US', 'ja-JP', 'ko-KR'])
  const keySets = Object.entries(messages).map(([loc, dict]) => {
    assert.ok(dict && typeof dict === 'object', `${loc} must be a key:value object`)
    for (const [k, v] of Object.entries(dict)) {
      assert.equal(typeof v, 'string', `${loc}.${k} must be a string`)
      assert.ok(v.trim().length > 0, `${loc}.${k} must not be empty`)
    }
    return [loc, Object.keys(dict).sort()]
  })
  for (const [loc, keys] of keySets.slice(1)) {
    assert.deepEqual(keys, keySets[0][1], `${loc} keys must equal ${keySets[0][0]} keys`)
  }
  assert.ok(keySets[0][1].length >= 30, `expected the 32-key scaffold, got ${keySets[0][1].length}`)
})

await t.test('L02 every t() key used in src exists in the ko-KR inventory', async () => {
  const ko = JSON.parse(read(join(LOCALES_DIR, 'ko-KR.json')))
  const used = new Set()
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(vue|ts)$/.test(e.name)) continue
      for (const m of read(p).matchAll(/(?:locale\.t|\bt)\(\s*['"]([A-Za-z0-9_]+)['"]/g)) used.add(m[1])
    }
  }
  walk(SRC_DIR)
  assert.ok(used.size >= 2, `expected real t() call sites, found ${used.size}`)
  for (const k of [...used].sort()) assert.ok(k in ko, `t('${k}') used in src but missing from ko-KR.json`)
})

await t.test('L03 vue-i18n resolves the active locale and falls back to ko-KR', async () => {
  const messages = loadMessages()
  const en = testI18n(messages, 'en-US')
  assert.equal(en.global.t('buyNow'), messages['en-US'].buyNow)
  assert.equal(en.global.t('addToCart'), messages['en-US'].addToCart)
  const ja = testI18n(messages, 'ja-JP')
  assert.equal(ja.global.t('buyNow'), messages['ja-JP'].buyNow)
  // Fallback path: a key missing from the active locale resolves from ko-KR.
  const partial = structuredClone(messages)
  delete partial['en-US'].slogan
  const fb = testI18n(partial, 'en-US')
  assert.equal(fb.global.t('slogan'), messages['ko-KR'].slogan)
  // Unknown keys echo the key itself (the store's fallback-chain signal).
  assert.equal(fb.global.t('noSuchKey'), 'noSuchKey')
})

await t.test('L04 the storefront wires vue-i18n and delegates the locale store', async () => {
  const i18nSrc = read(join(SRC_DIR, 'i18n.ts'))
  assert.ok(i18nSrc.includes('createI18n'), 'src/i18n.ts must create the vue-i18n instance')
  assert.ok(i18nSrc.includes("fallbackLocale: 'ko-KR'"), 'fallback must be ko-KR')
  assert.ok(i18nSrc.includes('missingWarn: false') && i18nSrc.includes('fallbackWarn: false'), 'fallback must stay silent like the legacy store')
  for (const loc of ['ko-KR', 'en-US', 'ja-JP']) {
    assert.ok(i18nSrc.includes(`./locales/${loc}.json`), `i18n.ts must load ${loc}.json`)
  }
  assert.ok(read(join(SRC_DIR, 'main.ts')).includes('app.use(i18n)'), 'main.ts must install i18n')
  const store = read(join(SRC_DIR, 'stores/locale.ts'))
  assert.ok(store.includes('i18n.global.t(key)'), 'locale store t() must delegate to vue-i18n')
  assert.ok(store.includes('i18n.global.locale.value = newLoc'), 'setLocale must switch the i18n locale')
  assert.ok(!store.includes('promoTop: '), 'inline DICT must be gone from the locale store')
})

t.finish()
