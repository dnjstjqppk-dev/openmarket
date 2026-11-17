# 5-7 pre-fix failure log (rule 13) — 2026-11-17

Task: remove invented exporter data from the cross-border commercial invoice
(`apps/cloudflare-gateway/src/routes/global-customs-fx.js:280-330`).

New expectations in `tests/customs_invoice_test.mjs` were written first and run
against the unmodified code (`node tests/customs_invoice_test.mjs`).

## Results before the fix

`0/6 passed, 6 failed`:

- Gate 1: gateway code still carries the business-number literal
  `120-88-01928` (`routes/global-customs-fx.js`).
- Gate 2: invoice source still contains `120-88-01928` (and the other invented
  defaults: Incheon Free Trade Zone address, `customs-ops@olmoa.com`,
  `OLMOA Official Partner`, `CUSTOMS_EXPRESS`, `|| 0.5`).
- Test 3: order without `operator_entity_id` invoices `200` with the invented
  exporter instead of `EXPORTER_NOT_CONFIGURED` 409.
- Test 4: configured-operator invoice shows
  `OLMOA Global Cross-Border Fulfillment Hub` instead of the seed entity
  (`올모아 (개발용 가상 개인사업자)` / `220-81-00001`).
- Test 5: after an operator switch the old order still shows `120-88-01928`
  instead of the old entity `220-81-00001`.
- Test 6: missing product weight renders as invented `0.5` instead of `null`
  (no missing-weight count header either).

No production touched: local sqlite harness runs only.
