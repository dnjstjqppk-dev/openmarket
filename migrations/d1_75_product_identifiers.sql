-- d1_75_product_identifiers.sql
-- Work order 6-12 (decision-20): domestic-marketplace product identifiers.
-- Brand + manufacturer + model name on the product, barcode (GTIN) or an
-- explicit exemption reason per SKU. Existing rows stay NULL (backfilled via
-- the seller/admin consoles, never by touching this migration).
-- Additive only. Rerun-safe (single-apply ALTERs per repo convention).

ALTER TABLE products ADD COLUMN manufacturer TEXT;
ALTER TABLE products ADD COLUMN model_name TEXT;

ALTER TABLE product_skus ADD COLUMN gtin TEXT;
ALTER TABLE product_skus ADD COLUMN gtin_exempt_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_product_skus_gtin ON product_skus(gtin) WHERE gtin IS NOT NULL;

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_75_product_identifiers.sql', CURRENT_TIMESTAMP);
