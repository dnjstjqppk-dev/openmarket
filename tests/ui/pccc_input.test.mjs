// Unit tests for the PCCC (개인통관고유부호) input hook's pure core.
// Runs on Node ≥ 23 (TypeScript type stripping).   node tests/ui/pccc_input.test.mjs
import assert from 'node:assert/strict'
import { createRunner } from '../lib/harness.mjs'
import { PCCC_PATTERN, normalizePcccInput } from '../../packages/ui/src/composables/usePccc.ts'

const t = createRunner('PCCC input core')

await t.test('P01 normalization uppercases and strips separators', async () => {
  assert.equal(normalizePcccInput(' p1234-56789012 '), 'P123456789012')
  assert.equal(normalizePcccInput('P1234 5678 9012'), 'P123456789012')
})

await t.test('P02 pattern accepts P+12 only, mirroring the gateway', async () => {
  assert.equal(PCCC_PATTERN.test('P123456789012'), true)
  assert.equal(PCCC_PATTERN.test('P12345678901'), false)
  assert.equal(PCCC_PATTERN.test('P1234567890123'), false)
  assert.equal(PCCC_PATTERN.test('X123456789012'), false)
  assert.equal(PCCC_PATTERN.test(''), false)
})

t.finish()
