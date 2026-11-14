-- d1_63_payment_card_summary.sql
-- Work order 3-7: masked card summary on payment transactions for receipts.
-- Only PG-masked values or the fixed simulator label are ever stored here.
-- Additive only. Rerun-safe (single-apply ALTERs per repo convention).

ALTER TABLE payment_transactions ADD COLUMN card_summary TEXT;

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_63_payment_card_summary.sql', CURRENT_TIMESTAMP);
