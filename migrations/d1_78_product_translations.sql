-- d1_78_product_translations.sql
-- Owner work order 2026-11-27 (/{lang}/{currency} URLs), decision 22: product
-- names in en / ja / zh-tw come only from the seller. A language without a
-- row here is not indexed for that product (canonical -> the ko page).
-- ko is the source language and stays on products.title (no row here).
-- slug is derived server-side from title (locale.config.ts slugify) and is the
-- PDP URL tail /{lang}/{currency}/p/{product_id}/{slug}; stale slugs 301.
-- Additive only. Rerun-safe (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS product_translations (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  lang TEXT NOT NULL CHECK (lang IN ('en', 'ja', 'zh-tw')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  summary TEXT CHECK (summary IS NULL OR length(summary) <= 2000),
  slug TEXT NOT NULL CHECK (length(slug) BETWEEN 1 AND 200),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id, lang)
);

CREATE INDEX IF NOT EXISTS idx_product_translations_lang ON product_translations (lang, product_id);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_78_product_translations.sql', CURRENT_TIMESTAMP);
