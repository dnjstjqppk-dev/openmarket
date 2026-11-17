# 5-5 pre-fix failure log (rule 13) — 2026-11-17

Task: remove the lowest-price guarantee scheme (decision-15). New/updated
expectations were written first and run against the unmodified code.

## Results before the fix

- `node tests/p1_funds_abuse_test.mjs`: 6/9 passed, 3 failed
  - `P0-01 retired: PRICE_ADJUSTMENT claim is rejected 400` → got 201
  - `P0-01 retired: PRICE_MATCH alias is rejected 400, never mapped` → got 201
  - `P0-02 UI copy matches the retired price scheme and the credit cap` →
    OrderDetailView still files PRICE_ADJUSTMENT
  - Both new legacy tests already pass (legacy rows are readable/settleable
    on current code, which the removal must preserve).
- `node tests/security_integrity.mjs`: 87/88 passed, 1 failed
  - `I17 retired price-match` → new claims still accepted
- `node tests/ui/copy_honesty.test.mjs`: 11/13 passed, 2 failed
  - `C06 buyer screens carry no price-guarantee copy` →
    `apps/storefront/src/App.vue must not promise "차액 보상"` (first hit;
    OrderDetail/Orders/Policy/Support/MyQna/LegalTerms/locales/customer-app
    hits follow the same removal)
  - `C07 terms articles stay contiguous after article 5 removal` →
    articles still read 제1..5조
- `node tests/ui/p2_wavef.test.mjs`: 32/33 passed, 1 failed
  - `F-S07` → policy module + gateway still export PRICE_ADJUST_WINDOW_DAYS
- `node tests/p1_phase3_test.mjs`: 22/23 passed, 1 failed
  - `NEW-09 retired PRICE_MATCH inquiry category is rejected 400` →
    PRICE_MATCH still accepted (mapped, not rejected)
- `mobile/partner_app/test/return_claim_test.dart`: expectation updated to
  `가격 보상(종료된 제도)`; source still returns `최저가 보상`
  (verified post-fix with `flutter test`; pre-fix mismatch is static).

No production touched: local sqlite harness runs only.
