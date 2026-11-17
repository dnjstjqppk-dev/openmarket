# 5-9 pre-fix failure log (rule 13)

Date: 2026-11-17. New tests written before the implementation.

## Gateway: `node tests/remind_notify_test.mjs` (new file, 18 tests)

Result: 0/18 run — the service module does not exist yet.

- `Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '.../apps/cloudflare-gateway/src/services/reminders.js' imported from
  .../tests/remind_notify_test.mjs`

Meaning: no code reads `sku_price_history` drops for `wishlists` members
(K-06), no code sends `remind.confirm_after_days` /
`remind.review_after_days` reminders (K-09), and `scheduled()` in
`apps/cloudflare-gateway/src/index.js` calls neither (it only runs
expire/auto-confirm/reconcile/purge/grading/search-purge). The migration
columns the tests need (`sub_orders.confirm_reminded_at`,
`sub_orders.review_reminded_at`, table `price_drop_notifs`) are also absent.

Raw output kept at `$env:TEMP\remind_prefail.txt` on the run machine.

## UI: `node tests/ui/components_commerce.test.mjs` (new C10)

Result: 9/10 passed, 1 failed.

- `[FAIL] C10 image accepts srcset with origin fallback (5-9/K-15) ->
  components/OmImage.vue must contain srcset?: string`
- C01–C09 pass unchanged.

Meaning: `OmImage` has no `srcset` slot yet (K-15).

Raw output kept at `$env:TEMP\commerce_c10_prefail.txt` on the run machine.
