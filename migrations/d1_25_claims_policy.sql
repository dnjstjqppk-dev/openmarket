-- migrations/d1_25_claims_policy.sql
-- V3.1 audit item O14: return-shipping-fee policy, a complete exchange flow, quantity-level pre-shipment cancel.
--   * partners.return_shipping_fee     one-way return courier fee charged on customer-fault returns (NULL = base_shipping_fee)
--   * returns.reason_code / fault      CHANGE_OF_MIND, SIZE_COLOR (customer) | DEFECTIVE, WRONG_ITEM, DAMAGED, NOT_AS_DESCRIBED (seller)
--   * returns.return_fee_amount        what was deducted from the refund
--   * returns.exchange_*               replacement option(s), re-shipment carrier / tracking; exchange_status:
--                                      AWAITING_RESHIPMENT -> RESHIPPED
--   * refunds.return_fee_amount        refund money identity: pg_amount + credit_amount + return_fee_amount = refunded items + shipping
--
-- Legal basis to confirm with counsel: 전자상거래법 제18조 (단순변심 반품 비용은 소비자 부담, 재화 하자·오배송은 판매자 부담).
-- OPERATIONS NOTE (production): additive only. Apply after d1_24 with a fresh backup / Time Travel bookmark.

PRAGMA defer_foreign_keys = ON;

ALTER TABLE partners ADD COLUMN return_shipping_fee INTEGER CHECK (return_shipping_fee IS NULL OR (return_shipping_fee >= 0 AND return_shipping_fee <= 100000));

ALTER TABLE returns ADD COLUMN reason_code TEXT CHECK (reason_code IS NULL OR reason_code IN ('CHANGE_OF_MIND', 'SIZE_COLOR', 'DEFECTIVE', 'WRONG_ITEM', 'DAMAGED', 'NOT_AS_DESCRIBED', 'OTHER'));
ALTER TABLE returns ADD COLUMN fault TEXT CHECK (fault IS NULL OR fault IN ('CUSTOMER', 'SELLER'));
ALTER TABLE returns ADD COLUMN fault_note TEXT;
ALTER TABLE returns ADD COLUMN return_fee_amount INTEGER NOT NULL DEFAULT 0 CHECK (return_fee_amount >= 0);
ALTER TABLE returns ADD COLUMN exchange_items_json TEXT;
ALTER TABLE returns ADD COLUMN exchange_status TEXT CHECK (exchange_status IS NULL OR exchange_status IN ('AWAITING_RESHIPMENT', 'RESHIPPED'));
ALTER TABLE returns ADD COLUMN exchange_carrier TEXT;
ALTER TABLE returns ADD COLUMN exchange_tracking_number TEXT;
ALTER TABLE returns ADD COLUMN exchange_shipped_at TEXT;
ALTER TABLE returns ADD COLUMN original_tracking_number TEXT;
ALTER TABLE returns ADD COLUMN return_received INTEGER NOT NULL DEFAULT 0 CHECK (return_received IN (0, 1));

ALTER TABLE refunds ADD COLUMN return_fee_amount INTEGER NOT NULL DEFAULT 0 CHECK (return_fee_amount >= 0);

-- The deducted fee is part of the refund money identity and may never change afterwards.
CREATE TRIGGER IF NOT EXISTS trg_refunds_return_fee_frozen BEFORE UPDATE OF return_fee_amount ON refunds
WHEN NEW.return_fee_amount != OLD.return_fee_amount
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
