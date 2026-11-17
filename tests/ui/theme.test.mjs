// Unit tests for the theme toggle cycle (pure part of useTheme).
// init()/set() touch document/localStorage, so only the cycle is tested here;
// the header wiring is covered by the storefront typecheck and production build.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createRunner } from '../lib/harness.mjs'
import { nextThemeMode } from '../../packages/ui/src/composables/useTheme.ts'

const t = createRunner('Theme toggle')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const css = readFileSync(join(ROOT, 'packages/ui/src/styles/tokens.css'), 'utf8')

await t.test('T01 the header button cycles light -> dark -> system -> light', async () => {
  assert.equal(nextThemeMode('light'), 'dark')
  assert.equal(nextThemeMode('dark'), 'system')
  assert.equal(nextThemeMode('system'), 'light')
})

// Work order 1-2: commerce color tokens in all three theme blocks.
const EXPECTED = {
  price: ['23 23 22', '236 237 235'],
  discount: ['214 48 74', '240 98 118'],
  urgent: ['183 73 3', '255 140 66'],
  'urgent-soft': ['255 237 222', '66 33 10'],
  'ship-fast': ['36 99 209', '110 160 245'],
  'ship-free': ['22 128 74', '74 196 128'],
  rating: ['155 108 0', '248 204 98'],
  benefit: ['9 90 99', '138 213 221'],
  soldout: ['117 117 108', '128 131 128'],
  direct: ['23 23 22', '255 255 255']
}
function blocks() {
  const darkAt = css.indexOf(":root[data-theme='dark']")
  const mediaAt = css.indexOf('@media (prefers-color-scheme: dark)')
  assert.ok(darkAt > 0 && mediaAt > darkAt, 'both dark blocks must exist')
  return [css.slice(0, darkAt), css.slice(darkAt, mediaAt), css.slice(mediaAt)]
}
function channels(block, name) {
  const m = block.match(new RegExp(`--om-${name}:\\s*([\\d ]+);`))
  assert.ok(m, `--om-${name} must be declared with raw channels`)
  return m[1].trim().split(/\s+/).map(Number)
}

await t.test('T02 commerce tokens exist with exact channels in all themes', async () => {
  const [light, dark, media] = blocks()
  for (const [name, [l, d]] of Object.entries(EXPECTED)) {
    assert.deepEqual(channels(light, name).join(' '), l, `light --om-${name}`)
    assert.deepEqual(channels(dark, name).join(' '), d, `dark --om-${name}`)
    assert.deepEqual(channels(media, name).join(' '), d, `media --om-${name}`)
  }
})

const lum = ([r, g, b]) => {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a, b) => {
  const x = lum(a), y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

// 5-1: Q-1-2 decided (a) — the four deviating pairs now use 4.5-meeting
// values, so T03 covers every text token and the old T04 pin is removed.
await t.test('T03 text tokens meet 4.5:1 against their theme surface', async () => {
  const [light, dark] = blocks()
  const surfaces = { light: [255, 255, 255], dark: [22, 25, 26] }
  for (const name of ['price', 'discount', 'ship-fast', 'ship-free', 'benefit', 'direct', 'urgent', 'rating', 'soldout']) {
    assert.ok(ratio(channels(light, name), surfaces.light) >= 4.5, `light ${name} >= 4.5`)
    assert.ok(ratio(channels(dark, name), surfaces.dark) >= 4.5, `dark ${name} >= 4.5`)
  }
  assert.ok(ratio(channels(light, 'urgent'), channels(light, 'urgent-soft')) >= 4.5, 'light urgent on urgent-soft >= 4.5')
})

await t.test('T05 tailwind preset exposes the commerce utilities', async () => {
  const require = createRequire(import.meta.url)
  const preset = require(join(ROOT, 'packages/ui/tailwind.preset.cjs'))
  const colors = preset.theme.extend.colors
  for (const [key, vars] of Object.entries({
    price: ['--om-price'], discount: ['--om-discount'],
    urgent: ['--om-urgent', '--om-urgent-soft'],
    'ship-fast': ['--om-ship-fast'], 'ship-free': ['--om-ship-free'],
    rating: ['--om-rating'], benefit: ['--om-benefit'],
    soldout: ['--om-soldout'], direct: ['--om-direct']
  })) {
    assert.ok(colors[key], `preset colors.${key} must exist`)
    const blob = JSON.stringify(colors[key])
    for (const v of vars) assert.ok(blob.includes(v), `colors.${key} must reference ${v}`)
  }
})

t.finish()
