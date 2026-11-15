-- d1_66_banner_placement.sql
-- Work order 4-18: banner position and exposure window. The public list
-- defaults to HOME_HERO; HOME_STRIP renders once the storefront adopts it.
ALTER TABLE banners ADD COLUMN position TEXT NOT NULL DEFAULT 'HOME_HERO'
  CHECK (position IN ('HOME_HERO', 'HOME_STRIP'));
ALTER TABLE banners ADD COLUMN starts_at TEXT;
ALTER TABLE banners ADD COLUMN ends_at TEXT;

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_66_banner_placement.sql', CURRENT_TIMESTAMP);
