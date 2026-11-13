-- d1_58_promotions.sql
-- Work order 2-6: flash sale approvals, deal allocation guards, exhibitions.
-- Additive only. Rerun-safe (single-apply ALTERs per repo convention).

ALTER TABLE flash_sale_items ADD COLUMN status TEXT NOT NULL DEFAULT 'REQUESTED'
  CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED'));
ALTER TABLE flash_sale_items ADD COLUMN applicant_partner_id TEXT;
UPDATE flash_sale_items SET status = 'APPROVED' WHERE status = 'REQUESTED';

ALTER TABLE order_items ADD COLUMN flash_sale_item_id TEXT;

CREATE TRIGGER IF NOT EXISTS trg_flash_stock_update
BEFORE UPDATE ON flash_sale_items
WHEN NEW.sold_stock < 0 OR NEW.sold_stock > NEW.allocated_stock
BEGIN
  SELECT RAISE(ABORT, 'FLASH_SALE_SOLD_OUT');
END;

CREATE TRIGGER IF NOT EXISTS trg_flash_stock_insert
BEFORE INSERT ON flash_sale_items
WHEN NEW.sold_stock < 0 OR NEW.sold_stock > NEW.allocated_stock
BEGIN
  SELECT RAISE(ABORT, 'FLASH_SALE_SOLD_OUT');
END;

CREATE TABLE IF NOT EXISTS exhibitions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  banner_url TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'ENDED')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exhibition_products (
  exhibition_id TEXT NOT NULL REFERENCES exhibitions(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (exhibition_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_exhibition_products_ex ON exhibition_products(exhibition_id);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_58_promotions.sql', CURRENT_TIMESTAMP);
