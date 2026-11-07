// Unit tests for the responsive breakpoint core shared by Vue, Flutter and QA screenshots.
// Runs on Node ≥ 23 (TypeScript type stripping).   node tests/ui/breakpoints.test.mjs
import assert from 'node:assert/strict'
import { createRunner } from '../lib/harness.mjs'
import { BREAKPOINTS, BREAKPOINT_ORDER, breakpointOf, deviceOf, matches, matchesDevice } from '../../packages/ui/src/composables/breakpoints.ts'

const t = createRunner('Breakpoint core')

await t.test('B01 the seven commercial cut-offs are fixed and ordered', async () => {
  assert.deepEqual({ ...BREAKPOINTS }, { phone: 360, phoneLg: 390, phablet: 480, tablet: 768, laptop: 1024, desktop: 1280, wide: 1440 })
  const widths = BREAKPOINT_ORDER.map((k) => BREAKPOINTS[k])
  assert.deepEqual([...widths].sort((a, b) => a - b), widths)
})

await t.test('B02 breakpointOf reports the greatest reached cut-off', async () => {
  assert.equal(breakpointOf(320), 'phone')
  assert.equal(breakpointOf(360), 'phone')
  assert.equal(breakpointOf(389), 'phone')
  assert.equal(breakpointOf(390), 'phoneLg')
  assert.equal(breakpointOf(479), 'phoneLg')
  assert.equal(breakpointOf(480), 'phablet')
  assert.equal(breakpointOf(767), 'phablet')
  assert.equal(breakpointOf(768), 'tablet')
  assert.equal(breakpointOf(1023), 'tablet')
  assert.equal(breakpointOf(1024), 'laptop')
  assert.equal(breakpointOf(1279), 'laptop')
  assert.equal(breakpointOf(1280), 'desktop')
  assert.equal(breakpointOf(1439), 'desktop')
  assert.equal(breakpointOf(1440), 'wide')
  assert.equal(breakpointOf(2560), 'wide')
})

await t.test('B03 deviceOf splits phone / tablet / desktop at 768 and 1280', async () => {
  assert.equal(deviceOf(360), 'phone')
  assert.equal(deviceOf(767), 'phone')
  assert.equal(deviceOf(768), 'tablet')
  assert.equal(deviceOf(1024), 'tablet')
  assert.equal(deviceOf(1279), 'tablet')
  assert.equal(deviceOf(1280), 'desktop')
  assert.equal(deviceOf(1440), 'desktop')
})

await t.test('B04 matches and matchesDevice follow min-width semantics', async () => {
  assert.equal(matches(1024, 'laptop'), true)
  assert.equal(matches(1023, 'laptop'), false)
  assert.equal(matchesDevice(767, 'tablet'), false)
  assert.equal(matchesDevice(768, 'tablet'), true)
  assert.equal(matchesDevice(0, 'phone'), true)
})

await t.test('B05 invalid widths fail closed to the desktop layout', async () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'x', null, undefined]) {
    assert.equal(breakpointOf(bad), 'wide')
    assert.equal(deviceOf(bad), 'desktop')
  }
  assert.equal(breakpointOf(-50), 'phone')
})
