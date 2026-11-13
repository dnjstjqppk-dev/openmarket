-- d1_57_reviews_social.sql
-- Work order 2-5: review engagement, stored product ratings, follows, restock.
-- Product aggregates stay fresh through triggers on review write, blind and delete.
-- Additive only. Rerun-safe (single-apply ALTERs per repo convention).

CREATE TABLE IF NOT EXISTS review_helpful_votes (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES product_reviews(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (review_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_helpful_review ON review_helpful_votes(review_id);

CREATE TABLE IF NOT EXISTS review_replies (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL UNIQUE REFERENCES product_reviews(id),
  partner_id TEXT NOT NULL REFERENCES partners(id),
  body TEXT NOT NULL CHECK (length(body) <= 2000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS review_reports (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES product_reviews(id),
  reporter_user_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (reason IN ('PROFANITY', 'PRIVACY', 'AD', 'IRRELEVANT', 'OTHER')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (review_id, reporter_user_id)
);
CREATE INDEX IF NOT EXISTS idx_review_reports_review ON review_reports(review_id);

ALTER TABLE product_reviews ADD COLUMN visibility TEXT NOT NULL DEFAULT 'VISIBLE'
  CHECK (visibility IN ('VISIBLE', 'BLIND'));
ALTER TABLE product_reviews ADD COLUMN blind_reason TEXT;

ALTER TABLE products ADD COLUMN avg_rating_x10 INTEGER;
ALTER TABLE products ADD COLUMN review_count INTEGER NOT NULL DEFAULT 0;

UPDATE products SET
  review_count = (SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = products.id AND r.visibility = 'VISIBLE'),
  avg_rating_x10 = (SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE CAST(ROUND(AVG(rating) * 10) AS INTEGER) END
    FROM product_reviews r WHERE r.product_id = products.id AND r.visibility = 'VISIBLE');

CREATE TRIGGER IF NOT EXISTS trg_review_stats_insert
AFTER INSERT ON product_reviews
BEGIN
  UPDATE products SET
    review_count = (SELECT COUNT(*) FROM product_reviews WHERE product_id = NEW.product_id AND visibility = 'VISIBLE'),
    avg_rating_x10 = (SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE CAST(ROUND(AVG(rating) * 10) AS INTEGER) END
      FROM product_reviews WHERE product_id = NEW.product_id AND visibility = 'VISIBLE'),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.product_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_review_stats_update
AFTER UPDATE OF visibility, rating ON product_reviews
BEGIN
  UPDATE products SET
    review_count = (SELECT COUNT(*) FROM product_reviews WHERE product_id = NEW.product_id AND visibility = 'VISIBLE'),
    avg_rating_x10 = (SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE CAST(ROUND(AVG(rating) * 10) AS INTEGER) END
      FROM product_reviews WHERE product_id = NEW.product_id AND visibility = 'VISIBLE'),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.product_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_review_stats_delete
AFTER DELETE ON product_reviews
BEGIN
  UPDATE products SET
    review_count = (SELECT COUNT(*) FROM product_reviews WHERE product_id = OLD.product_id AND visibility = 'VISIBLE'),
    avg_rating_x10 = (SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE CAST(ROUND(AVG(rating) * 10) AS INTEGER) END
      FROM product_reviews WHERE product_id = OLD.product_id AND visibility = 'VISIBLE'),
    updated_at = CURRENT_TIMESTAMP
  WHERE id = OLD.product_id;
END;

CREATE TABLE IF NOT EXISTS store_follows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  partner_id TEXT NOT NULL REFERENCES partners(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, partner_id)
);
CREATE INDEX IF NOT EXISTS idx_store_follows_partner ON store_follows(partner_id);

CREATE TABLE IF NOT EXISTS partner_store_profiles (
  partner_id TEXT PRIMARY KEY REFERENCES partners(id),
  logo_url TEXT,
  banner_url TEXT,
  intro TEXT CHECK (intro IS NULL OR length(intro) <= 1000),
  notice TEXT CHECK (notice IS NULL OR length(notice) <= 2000),
  featured_product_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS restock_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  sku_id TEXT NOT NULL REFERENCES product_skus(id),
  notified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, sku_id)
);
CREATE INDEX IF NOT EXISTS idx_restock_sku ON restock_subscriptions(sku_id);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_57_reviews_social.sql', CURRENT_TIMESTAMP);
