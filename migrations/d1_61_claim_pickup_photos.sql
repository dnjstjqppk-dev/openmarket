-- d1_61_claim_pickup_photos.sql
-- Work order 2-9 buyer claims: pickup address and photo evidence on returns.
-- Additive only. Rerun-safe (single-apply ALTERs per repo convention).

ALTER TABLE returns ADD COLUMN pickup_address TEXT;
ALTER TABLE returns ADD COLUMN photo_urls_json TEXT;

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_61_claim_pickup_photos.sql', CURRENT_TIMESTAMP);
