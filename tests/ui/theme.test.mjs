// Unit tests for the theme toggle cycle (pure part of useTheme).
// init()/set() touch document/localStorage, so only the cycle is tested here;
// the header wiring is covered by the storefront typecheck and production build.
import assert from 'node:assert/strict'
import { createRunner } from '../lib/harness.mjs'
import { nextThemeMode } from '../../packages/ui/src/composables/useTheme.ts'

const t = createRunner('Theme toggle')

await t.test('T01 the header button cycles light -> dark -> system -> light', async () => {
  assert.equal(nextThemeMode('light'), 'dark')
  assert.equal(nextThemeMode('dark'), 'system')
  assert.equal(nextThemeMode('system'), 'light')
})

t.finish()
