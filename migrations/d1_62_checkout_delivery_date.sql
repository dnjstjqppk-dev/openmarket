-- d1_62_checkout_delivery_date.sql
-- Work order 3-6: buyer-requested delivery date on orders.
-- Additive only. Rerun-safe (single-apply ALTERs per repo convention).

ALTER TABLE orders ADD COLUMN requested_delivery_date TEXT;

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_62_checkout_delivery_date.sql', CURRENT_TIMESTAMP);
