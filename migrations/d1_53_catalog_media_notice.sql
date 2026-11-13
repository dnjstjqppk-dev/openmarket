-- d1_53_catalog_media_notice.sql
-- Work order 2-1: product image gallery, category columns, notice templates.
-- Migrates each product's representative thumbnail to gallery order 0.
-- Legacy/external thumbnail URLs are grandfathered: URL-shape enforcement
-- belongs to the future image-write API (see Q-2-1), not to this migration.
-- Additive only. Rerun-safe.

CREATE TABLE IF NOT EXISTS product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  image_url TEXT NOT NULL,
  alt_text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 9),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (product_id, sort_order)
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);

INSERT OR IGNORE INTO product_images (id, product_id, image_url, alt_text, sort_order)
SELECT 'pimg_' || p.id || '_0', p.id, p.thumbnail_url, p.title, 0
FROM products p
WHERE p.thumbnail_url IS NOT NULL AND p.thumbnail_url != '';

ALTER TABLE categories ADD COLUMN icon_key TEXT;
ALTER TABLE categories ADD COLUMN commission_rate_bps INTEGER;
ALTER TABLE categories ADD COLUMN notice_template_id TEXT;

CREATE TABLE IF NOT EXISTS notice_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  items_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE products ADD COLUMN notice_template_id TEXT;
ALTER TABLE products ADD COLUMN notice_template_version INTEGER;

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_53_catalog_media_notice.sql', CURRENT_TIMESTAMP);
