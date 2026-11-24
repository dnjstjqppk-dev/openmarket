// Work order 1-5: design lint. Every .vue file is scanned for default-palette
// color utilities, HEX literals, Font Awesome classes and native dialogs.
// Per-file counts are pinned as caps; exceeding a cap fails. Each stage end
// lowers that stage's app caps to 0 (goal: all three apps at 0 after stage 4).
// Exception: bg-black/40 and text-white directly over images (an <img> tag
// within 12 lines) or on scrim chrome (overlay/absolute on the same line:
// scrims stay dark in both themes, so light icons there are never page text).
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from '../lib/harness.mjs'

const t = createRunner('Design lint')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ROOTS = ['apps/storefront/src', 'apps/admin/src', 'apps/partner/src', 'packages/ui/src'].map((d) => join(ROOT, d))

const PALETTE = '(?:white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)'
const UTIL = '(?:bg|text|border|ring|divide|stroke|fill|placeholder|accent|caret|outline|decoration|from|via|to)'
// 5-1: also match numbered shades (-50..-950) and /opacity suffixes. The old
// trailing lookahead rejected every shade, hiding 100+ violations (Q-3-11c).
// Variant prefixes (hover:, dark:, sm:) were and are matched by [a-z-]+:.
const SHADE = '(?:-(?:50|100|200|300|400|500|600|700|800|900|950))?'
const paletteRe = new RegExp(`(?:^|[^a-zA-Z0-9_:-])!?(?:[a-z-]+:)*!?${UTIL}-${PALETTE}${SHADE}(?:/\\d{1,3})?(?![a-zA-Z0-9-])`, 'g')
const overlayRe = /!?(?:[a-z-]+:)*!?(?:bg-black\/40|text-white)(?![a-zA-Z0-9-])/

function strip(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*/, ''))
    .join('\n')
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (e.endsWith('.vue')) out.push(p)
  }
  return out
}

function violationsOf(file) {
  const key = relative(ROOT, file).split(sep).join('/')
  const allowedHex = HEX_EXCEPTIONS[key]
  const lines = strip(readFileSync(file, 'utf8')).split('\n')
  let n = 0
  const details = []
  lines.forEach((line, i) => {
    paletteRe.lastIndex = 0
    let m
    while ((m = paletteRe.exec(line)) !== null) {
      const isOverlay = overlayRe.test(m[0])
      if (isOverlay) {
        let exempt = /absolute|bg-overlay/.test(line)
        if (!exempt) {
          for (let k = Math.max(0, i - 12); k <= Math.min(lines.length - 1, i + 12); k++) {
            if (/<img[\s>]/.test(lines[k])) { exempt = true; break }
          }
        }
        if (exempt) continue
      }
      n++
      if (details.length < 5) details.push(`${i + 1}:${m[0].trim()}`)
    }
    const hexAll = line.match(/#[0-9a-fA-F]{3,8}\b/g) || []
    const hex = allowedHex ? hexAll.filter((h) => !allowedHex.has(h.toUpperCase())) : hexAll
    if (hex.length) { n += hex.length; if (details.length < 5) details.push(`${i + 1}:${hex[0]}`) }
    const fa = line.match(/fa-(?:solid|regular)/g)
    if (fa) { n += fa.length; if (details.length < 5) details.push(`${i + 1}:${fa[0]}`) }
    const dlg = line.match(/\b(?:alert|confirm|prompt)\s*\(/g)
    if (dlg) { n += dlg.length; if (details.length < 5) details.push(`${i + 1}:${dlg[0]}`) }
  })
  return { n, details }
}

// Measured 2026-11-13 with this scanner (storefront 265, admin 294,
// partner 358, ui package 21). Lower per stage; never raise.
// 3-11: storefront zeroed. The N02 native-confirm hold converted with its
// e2e script update under autonomous authority (see Q-G3a).
// Brand-color exceptions (work order 3-11, S-11): exact hexes only.
const HEX_EXCEPTIONS = {
  'apps/storefront/src/views/LoginView.vue': new Set(['#FEE500', '#000000'])
}
const CAPS = {
  // 4-22: admin zeroed (all console views converted to tokens).
  // 4-11: partner zeroed (all seller-center views converted to tokens).
  // GAP-04: OmAlert/OmBadge/OmButton/OmFooter/OmSidebar zeroed (solid fills
  // take text-primary-on / text-secondary-on per the zeroed-app precedent).
  // Residual 4 cannot tokenize without a behavior change: OmFileUploader's
  // hover:bg-white/20 lightens a theme-stable dark scrim bar over photos
  // (any flipping token breaks dark mode), and the OmSwitch knob must stay
  // light on both track tones. Both need a design-system scrim/knob token
  // (design follow-up); the caps below pin the known residual, never raise.
  'packages/ui/src/components/OmFileUploader.vue': 3,
  'packages/ui/src/components/OmSwitch.vue': 1
}

await t.test('D01 no file exceeds its design-lint cap', async () => {
  const files = ROOTS.flatMap((d) => walk(d))
  assert.ok(files.length > 100, `expected 100+ vue files, saw ${files.length}`)
  if (process.env.DUMP_CAPS === '1') {
    const out = {}
    for (const f of files) {
      const v = violationsOf(f).n
      if (v > 0) out[relative(ROOT, f).split(sep).join('/')] = v
    }
    console.log(JSON.stringify(out))
    return
  }
  let total = 0
  for (const f of files) {
    const key = relative(ROOT, f).split(sep).join('/')
    const { n, details } = violationsOf(f)
    total += n
    const cap = CAPS[key] ?? 0
    assert.ok(n <= cap, `${key} has ${n} violations (cap ${cap}): ${details.join(' ')}`)
  }
  assert.ok(total > 0, 'scanner must find the known violations')
})

await t.test('D04 scanner catches shades, opacity suffixes and variant prefixes (work order 5-1)', async () => {
  const hits = (s) => { paletteRe.lastIndex = 0; let n = 0; while (paletteRe.exec(s) !== null) n++; return n }
  for (const s of ['bg-gray-100', 'hover:text-green-800', 'border-gray-200/80', 'sm:bg-slate-100']) {
    assert.equal(hits(` class="${s}" `), 1, `${s} must count 1`)
  }
  for (const s of ['bg-surface', 'text-ink-muted']) {
    assert.equal(hits(` class="${s}" `), 0, `${s} must count 0`)
  }
})

await t.test('D03 brand exceptions stay pinned to their exact hexes', async () => {
  const v = readFileSync(join(ROOT, 'apps/storefront/src/views/LoginView.vue'), 'utf8')
  assert.ok(v.includes('#FEE500') && v.includes('#000000'), 'kakao button keeps its brand colors')
  const others = (v.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter((h) => !['#FEE500', '#000000'].includes(h.toUpperCase()))
  assert.equal(others.length, 0, `no non-brand hex may ride the exception: ${others.join(',')}`)
})

await t.test('D02 no font awesome usage remains (work order 1-6)', async () => {
  const htmlRoots = ['apps/storefront', 'apps/admin', 'apps/partner'].map((d) => join(ROOT, d, 'index.html'))
  const files = [...ROOTS.flatMap((d) => walk(d)), ...htmlRoots]
  for (const f of files) {
    const src = strip(readFileSync(f, 'utf8'))
    assert.ok(!/\bfa-[a-z]/.test(src), `${relative(ROOT, f)} must not use fa-* classes`)
    assert.ok(!/font-?awesome/i.test(src), `${relative(ROOT, f)} must not reference font awesome`)
  }
})

t.finish()
