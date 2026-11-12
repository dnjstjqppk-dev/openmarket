-- d1_51_wave_h_search_push_recommend.sql
-- Wave H: trigram FTS product search index, push device tokens, product view logs.
-- Additive only. Rerun-safe (IF NOT EXISTS + NOT IN backfill + OR IGNORE ledger).

-- H-1: full-text index over seller-editable text (title/brand/category).
-- Trigram tokenizer: Korean has no word spaces, so whole-token matching
-- (unicode61) misses '이어폰' inside '무선이어폰'; trigrams match substrings.
-- Description stays in LIKE: description_html carries markup and stripping it
-- in SQL is unreliable, so description recall runs as a second UNION arm.
CREATE VIRTUAL TABLE IF NOT EXISTS product_search_fts USING fts5(
  product_id UNINDEXED, title, brand, category_name, tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS trg_product_fts_ai AFTER INSERT ON products BEGIN
  INSERT INTO product_search_fts (product_id, title, brand, category_name)
  VALUES (NEW.id, NEW.title, COALESCE(NEW.brand, ''),
    COALESCE((SELECT name FROM categories WHERE id = NEW.category_id), ''));
END;
CREATE TRIGGER IF NOT EXISTS trg_product_fts_ad AFTER DELETE ON products BEGIN
  DELETE FROM product_search_fts WHERE product_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS trg_product_fts_au AFTER UPDATE ON products BEGIN
  DELETE FROM product_search_fts WHERE product_id = OLD.id;
  INSERT INTO product_search_fts (product_id, title, brand, category_name)
  VALUES (NEW.id, NEW.title, COALESCE(NEW.brand, ''),
    COALESCE((SELECT name FROM categories WHERE id = NEW.category_id), ''));
END;
INSERT INTO product_search_fts (product_id, title, brand, category_name)
SELECT p.id, p.title, COALESCE(p.brand, ''), COALESCE(c.name, '')
FROM products p LEFT JOIN categories c ON c.id = p.category_id
WHERE p.id NOT IN (SELECT product_id FROM product_search_fts);

-- H-2: push device tokens. token_hash is the blind unique index; the token
-- itself is sealed at rest (SEC-10 pattern). Multi-device allowed.
CREATE TABLE IF NOT EXISTS push_device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  app TEXT NOT NULL CHECK (app IN ('CUSTOMER', 'PARTNER')),
  platform TEXT NOT NULL CHECK (platform IN ('ANDROID', 'IOS', 'WEB')),
  token_hash TEXT NOT NULL,
  token_sealed TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_push_device_tokens_hash ON push_device_tokens(token_hash);
CREATE INDEX IF NOT EXISTS ix_push_device_tokens_user ON push_device_tokens(user_id, app);

-- H-3: authenticated product views, one row per user+product+day (bounded growth).
CREATE TABLE IF NOT EXISTS product_views (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  day TEXT NOT NULL,
  viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_product_views_day ON product_views(user_id, product_id, day);
CREATE INDEX IF NOT EXISTS ix_product_views_product ON product_views(product_id, viewed_at);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_51_wave_h_search_push_recommend.sql', CURRENT_TIMESTAMP);
