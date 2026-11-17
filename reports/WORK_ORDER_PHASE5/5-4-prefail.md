# 5-4 pre-fix failure log (rule 13)

Command: `node tests/api_plp_filters_test.mjs` (after adding F8–F11, before touching
`apps/cloudflare-gateway/src/routes/catalog.js`).

```
[PASS] F1. sale filter keeps only discounted rows
[PASS] F2. domestic filter drops overseas sellers
[PASS] F3. category and seller filters take comma lists
[PASS] F4. facets follow the new filters
[PASS] F5. list rows carry card badge facts
[PASS] F6. price history reads newest-first per product
[PASS] F7. best-coupon search takes explicit cart lines
[FAIL] F8. no policy: today_shipment ignored and excluded from available filters
       -> param ignored without policy 4 !== 67
[FAIL] F9. with policy: only pre-cutoff + rate-ok sellers pass
       -> post-cutoff excluded
[FAIL] F10. has_today gated on policy, not on the clock
       -> prod_ts_a badge off without policy 1 !== 0
[FAIL] F11. invalid policy value fails closed like a missing policy
       -> garbage policy ignored 4 !== 67

=== PLP filters (3-2/3-3): 7/11 passed, 4 failed ===
```

Reading:

- F8/F11: without an effective `badge.today_ship_min_rate_bps` policy the server
  still applies `today_shipment=1` (67 rows collapse to the 4 cutoff-template
  sellers). Decision-10 pre-state requires the param to be ignored.
- F9: with policy `8000`, the post-cutoff seller (cutoff 09:00, now pinned to
  KST 10:00) is still included — no clock comparison and no ship-rate check.
- F10: `has_today` is 1 for cutoff-template sellers with no policy, so the
  product card shows "오늘출발" although decision-10 pre-state says no badge.

No prod touched: in-memory harness only.
