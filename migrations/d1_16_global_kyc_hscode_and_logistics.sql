-- migrations/d1_16_global_kyc_hscode_and_logistics.sql
-- OLMOA Global OpenMarket Phase 2: Partner Global KYC, HS Code, Volumetric Weight & 7-Stage Milestone Tracking

ALTER TABLE partners ADD COLUMN partner_type TEXT DEFAULT 'DOMESTIC';
ALTER TABLE partners ADD COLUMN country_code TEXT DEFAULT 'KR';
ALTER TABLE partners ADD COLUMN kyc_status TEXT DEFAULT 'APPROVED';
ALTER TABLE partners ADD COLUMN risk_tier TEXT DEFAULT 'TIER_1_NORMAL';
ALTER TABLE partners ADD COLUMN rolling_reserve_pct REAL DEFAULT 0.0;
ALTER TABLE partners ADD COLUMN settlement_currency TEXT DEFAULT 'KRW';
ALTER TABLE partners ADD COLUMN swift_bic TEXT;
ALTER TABLE partners ADD COLUMN payout_channel TEXT DEFAULT 'LOCAL_BANK';
ALTER TABLE partners ADD COLUMN payout_account_id TEXT;
ALTER TABLE partners ADD COLUMN representative_id_doc TEXT;
ALTER TABLE partners ADD COLUMN business_cert_doc TEXT;
ALTER TABLE partners ADD COLUMN tax_id_doc TEXT;
ALTER TABLE partners ADD COLUMN kyc_notes TEXT;

ALTER TABLE products ADD COLUMN hs_code TEXT DEFAULT '6109.10';
ALTER TABLE products ADD COLUMN country_origin TEXT DEFAULT 'KR';
ALTER TABLE products ADD COLUMN package_length_cm REAL DEFAULT 20.0;
ALTER TABLE products ADD COLUMN package_width_cm REAL DEFAULT 15.0;
ALTER TABLE products ADD COLUMN package_height_cm REAL DEFAULT 10.0;
ALTER TABLE products ADD COLUMN package_weight_kg REAL DEFAULT 0.5;
ALTER TABLE products ADD COLUMN volumetric_weight_kg REAL DEFAULT 0.6;
ALTER TABLE products ADD COLUMN warehouse_location TEXT DEFAULT 'INCHEON_FBO';

ALTER TABLE sub_orders ADD COLUMN milestone_status TEXT DEFAULT 'PREPARING';
ALTER TABLE sub_orders ADD COLUMN flight_vessel_no TEXT;
ALTER TABLE sub_orders ADD COLUMN customs_clearance_no TEXT;
ALTER TABLE sub_orders ADD COLUMN origin_country TEXT DEFAULT 'KR';
ALTER TABLE sub_orders ADD COLUMN destination_country TEXT DEFAULT 'KR';
ALTER TABLE sub_orders ADD COLUMN last_milestone_location TEXT;
ALTER TABLE sub_orders ADD COLUMN last_milestone_updated_at TEXT;

CREATE TABLE IF NOT EXISTS milestone_tracking_logs (
    id TEXT PRIMARY KEY,
    sub_order_id TEXT NOT NULL REFERENCES sub_orders(id),
    carrier_code TEXT NOT NULL,
    tracking_number TEXT NOT NULL,
    stage_code TEXT NOT NULL,
    stage_name TEXT NOT NULL,
    location TEXT NOT NULL,
    description TEXT,
    occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

