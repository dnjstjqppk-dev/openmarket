-- d1_47_cart_items.sql
-- P1-M05: server-side customer cart (the mobile app syncs here; lines carry
-- only sku_id + quantity — prices and stock are always re-read live).
CREATE TABLE IF NOT EXISTS cart_items (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sku_id TEXT NOT NULL REFERENCES product_skus(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity >= 1 AND quantity <= 99),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, sku_id)
);
CREATE INDEX IF NOT EXISTS idx_cart_items_user ON cart_items(user_id);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('d1_47_cart_items.sql', CURRENT_TIMESTAMP);
