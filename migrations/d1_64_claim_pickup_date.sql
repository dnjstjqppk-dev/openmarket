-- d1_64_claim_pickup_date.sql
-- Work order 3-8: buyer-requested collection date on return claims.
-- Additive only. Rerun-safe (single-apply ALTERs per repo convention).

ALTER TABLE returns ADD COLUMN pickup_date TEXT;

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_64_claim_pickup_date.sql', CURRENT_TIMESTAMP);
