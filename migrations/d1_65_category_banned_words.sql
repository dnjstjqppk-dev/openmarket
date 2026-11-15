-- d1_65_category_banned_words.sql
-- Work order 4-14/4-15: per-category banned words for the product review
-- auto-check. Global exaggeration phrases stay a server constant.
CREATE TABLE IF NOT EXISTS category_banned_words (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  word TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (category_id, word)
);
CREATE INDEX IF NOT EXISTS idx_cat_banned_words_cat ON category_banned_words(category_id);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_65_category_banned_words.sql', CURRENT_TIMESTAMP);
