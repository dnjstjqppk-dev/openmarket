# 5-3 pre-fix failure log (rule 13)

Date: 2026-11-17. Command: `node tests/restock_notify_test.mjs` (new file, implementation absent).

Result: 5/12 passed, 7 failed.

Passing (negative/guard behavior already correct):
- 2. further 5->7 sends nothing new
- 3. another seller cannot trigger notifications for a foreign SKU
- 4. halted and deleted products send nothing
- 11. notify failure does not fail the stock edit
- 12. notified_at already exists, so d1_68 is not required

Failing (no sender reads `restock_subscriptions` yet — the gap 5-3 closes):
- 1. stock 0->5 notifies two subscribers once each — `subscriber 1 gets exactly one 3 !== 4`
- 5. product edit (skus array) 0->positive notifies — `3 !== 4`
- 6. bulk-update stock 0->positive notifies — `3 !== 4`
- 7. unpaid order cancel restores stock and notifies — `3 !== 4`
- 8. payment expiry restores stock and notifies — `3 !== 4`
- 9. paid order cancel (refund path) notifies — `3 !== 4`
- 10. return approval with restock notifies — `3 !== 4`

(All seven fail the same way: zero notifications created on a 0->positive transition.
Raw output kept at `$env:TEMP\restock_prefail.txt` on the run machine.)

Post-fix addition: test 12 (exchange reship with `return_received`) was added
after the first green run. Red-drill verified: with the reship hook temporarily
disabled (`if (false && ...)`), exactly that test fails (12/13); re-enabled,
13/13 pass.

Schema note: `PRAGMA table_info(restock_subscriptions)` returns
`id, user_id, sku_id, notified_at, created_at` — `notified_at` already exists
since `migrations/d1_57_reviews_social.sql`, so the conditional
`migrations/d1_68_restock_notified.sql` ("컬럼이 없으면") is not created and
`REQUIRED_SCHEMA_VERSION` stays at `d1_67_support_sla_pii_reason.sql`.
