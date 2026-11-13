-- d1_55_coupon_engine.sql
-- Work order 2-3: platform/store coupon split, targets, per-item burden columns.
-- Legacy coupons backfill to platform/all/full-share; existing item coupon
-- allocations backfill to the platform share.
-- Additive only. Rerun-safe (single-apply ALTERs per repo convention).

ALTER TABLE coupons ADD COLUMN issuer TEXT;
ALTER TABLE coupons ADD COLUMN seller_id TEXT;
ALTER TABLE coupons ADD COLUMN scope TEXT;
ALTER TABLE coupons ADD COLUMN platform_share_bps INTEGER;
ALTER TABLE coupons ADD COLUMN dup_group TEXT;
ALTER TABLE coupons ADD COLUMN issue_method TEXT;
ALTER TABLE coupons ADD COLUMN total_quantity INTEGER;
ALTER TABLE coupons ADD COLUMN issued_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coupons ADD COLUMN per_user_limit INTEGER;
ALTER TABLE coupons ADD COLUMN starts_at TEXT;

UPDATE coupons SET issuer = 'PLATFORM' WHERE issuer IS NULL;
UPDATE coupons SET scope = 'ALL' WHERE scope IS NULL;
UPDATE coupons SET platform_share_bps = 10000 WHERE platform_share_bps IS NULL;
UPDATE coupons SET dup_group = 'PLATFORM' WHERE dup_group IS NULL;
UPDATE coupons SET issue_method = 'DOWNLOAD' WHERE issue_method IS NULL;

CREATE TABLE IF NOT EXISTS coupon_targets (
  coupon_id TEXT NOT NULL REFERENCES coupons(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('SELLER', 'CATEGORY', 'PRODUCT')),
  target_id TEXT NOT NULL,
  PRIMARY KEY (coupon_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_coupon_targets_coupon ON coupon_targets(coupon_id);

ALTER TABLE user_coupons ADD COLUMN claim_idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_coupons_claim_key
  ON user_coupons(claim_idempotency_key) WHERE claim_idempotency_key IS NOT NULL;

ALTER TABLE order_items ADD COLUMN store_coupon_alloc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN platform_coupon_alloc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN seller_burden_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN refunded_store_coupon_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN refunded_platform_coupon_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN refunded_seller_burden_amount INTEGER NOT NULL DEFAULT 0;
UPDATE order_items SET platform_coupon_alloc = coupon_alloc WHERE platform_coupon_alloc = 0;
UPDATE order_items SET refunded_platform_coupon_amount = refunded_coupon_amount WHERE refunded_platform_coupon_amount = 0;

ALTER TABLE sub_orders ADD COLUMN applied_store_coupon_id TEXT;
ALTER TABLE settlements ADD COLUMN seller_coupon_burden INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER IF NOT EXISTS trg_coupon_issue_cap
BEFORE UPDATE ON coupons
WHEN NEW.issued_count > NEW.total_quantity AND NEW.total_quantity IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'COUPON_SOLD_OUT');
END;

CREATE TRIGGER IF NOT EXISTS trg_coupon_seller_insert
BEFORE INSERT ON coupons
WHEN NEW.issuer = 'SELLER' AND (NEW.seller_id IS NULL OR NEW.dup_group != 'STORE' OR NEW.platform_share_bps != 0)
BEGIN
  SELECT RAISE(ABORT, 'COUPON_SELLER_INTEGRITY');
END;

CREATE TRIGGER IF NOT EXISTS trg_coupon_seller_update
BEFORE UPDATE ON coupons
WHEN NEW.issuer = 'SELLER' AND (NEW.seller_id IS NULL OR NEW.dup_group != 'STORE' OR NEW.platform_share_bps != 0)
BEGIN
  SELECT RAISE(ABORT, 'COUPON_SELLER_INTEGRITY');
END;

CREATE TRIGGER IF NOT EXISTS trg_coupon_per_user_cap
BEFORE INSERT ON user_coupons
WHEN (SELECT per_user_limit FROM coupons WHERE id = NEW.coupon_id) IS NOT NULL
  AND (SELECT COUNT(*) FROM user_coupons WHERE user_id = NEW.user_id AND coupon_id = NEW.coupon_id)
    >= (SELECT per_user_limit FROM coupons WHERE id = NEW.coupon_id)
BEGIN
  SELECT RAISE(ABORT, 'COUPON_LIMIT_REACHED');
END;

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_55_coupon_engine.sql', CURRENT_TIMESTAMP);
