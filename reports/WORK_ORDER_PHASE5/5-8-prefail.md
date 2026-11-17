# 5-8 pre-fix failure log (rule 13) — 2026-11-17

Task: policy effective dates follow the KST calendar day
(`apps/cloudflare-gateway/src/lib/ledger.js:87-92` `getPolicy`, the policy
register backdate check, `tests/settlement_policy_test.mjs`).

New expectations (tests 16-19) were written first and run against the
unmodified code (`node tests/settlement_policy_test.mjs`).

## Results before the fix

`17/19 passed, 2 failed`:

- Test 16: `getPolicy compares on the KST date` — `ledger.js` still compares
  `effective_from <= date('now')` (UTC), with no `+9 hours` KST shift and no
  `ORDER BY effective_from DESC LIMIT 1`.
- Test 17: `both rows coexist 1 !== 2` — `platform_policies.key` is a single
  primary key, so the second PUT for the same key overwrites instead of
  coexisting; the latest-effective read cannot be exercised.
- Tests 18 (tomorrow not yet) and 19 (KST backdate ban) pass pre-fix at this
  hour because UTC and KST share the same calendar date right now
  (UTC 2026-11-17 07:54 = KST 16:54); they fail pre-fix during the
  00:00-08:59 KST window when the two dates differ, and guard the behavior
  after the fix.

No production touched: local sqlite harness runs only.
