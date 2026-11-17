# 5-6 pre-fix failure log (rule 13) — 2026-11-17

Task: operator-managed versioned legal documents (TERMS/PRIVACY/REFUND).

New expectations in `tests/legal_documents_test.mjs` were written first and run
against the unmodified code (`node tests/legal_documents_test.mjs`).

## Results before the fix

`0/10 passed, 10 failed`:

- Tests 1, 2, 3, 5, 7, 9, 10: `ROUTE_NOT_FOUND` 404 — neither
  `GET /api/v1/legal/:kind` nor `/api/v1/admin/legal-documents` exists.
- Tests 4, 6: `no such table: legal_documents` — the table does not exist.
- Test 8: signup stores `terms_version = null` when the client sends none —
  the server does not default to the current document versions.

No production touched: local sqlite harness runs only.
