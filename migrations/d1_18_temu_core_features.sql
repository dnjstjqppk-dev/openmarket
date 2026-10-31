-- migrations/d1_18_temu_core_features.sql
-- Temu Core E-Commerce Engines: Returnless Refunds, Late Delivery Guarantee, Sample QC, IPR Takedown, Body Fit Reviews & Seller Penalties

-- 1. Alter sub_orders for Late Delivery Guarantee
ALTER TABLE sub_orders ADD COLUMN estimated_delivery_date TEXT;
ALTER TABLE sub_orders ADD COLUMN is_late_compensated INTEGER DEFAULT 0;
ALTER TABLE sub_orders ADD COLUMN late_compensation_amount INTEGER DEFAULT 0;

-- 2. Alter returns for Returnless Refund
ALTER TABLE returns ADD COLUMN is_returnless INTEGER DEFAULT 0;
ALTER TABLE returns ADD COLUMN returnless_reason TEXT;

-- 3. Alter products for Full-Custody & Supply Price
ALTER TABLE products ADD COLUMN custody_type TEXT DEFAULT 'SEMI_MANAGED';
ALTER TABLE products ADD COLUMN supply_price INTEGER;

-- 4. Product Reviews with Body Metric Information (Height, Weight, Fit)
ALTER TABLE product_reviews ADD COLUMN order_id TEXT;
ALTER TABLE product_reviews ADD COLUMN author_name TEXT;
ALTER TABLE product_reviews ADD COLUMN user_height_cm INTEGER;
ALTER TABLE product_reviews ADD COLUMN user_weight_kg INTEGER;
ALTER TABLE product_reviews ADD COLUMN fit_type TEXT DEFAULT 'TRUE_TO_SIZE';
ALTER TABLE product_reviews ADD COLUMN photo_urls_json TEXT;

-- 5. Factory Sample QC Verification Requests
CREATE TABLE IF NOT EXISTS sample_qc_requests (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    product_id TEXT,
    product_title TEXT NOT NULL,
    sample_tracking_no TEXT,
    carrier TEXT DEFAULT 'CJ대한통운',
    status TEXT NOT NULL DEFAULT 'PENDING',
    inspector_notes TEXT,
    inspected_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. Merchant Penalty Escrow Deductions
CREATE TABLE IF NOT EXISTS partner_penalties (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    sub_order_id TEXT,
    penalty_type TEXT NOT NULL DEFAULT 'LATE_DISPATCH',
    penalty_amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DEDUCTED',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. IPR (Intellectual Property Rights) Notice & Fast-Track Takedown Reports
CREATE TABLE IF NOT EXISTS ipr_takedown_reports (
    id TEXT PRIMARY KEY,
    reporter_name TEXT NOT NULL,
    brand_name TEXT NOT NULL,
    target_product_id TEXT NOT NULL REFERENCES products(id),
    infringement_type TEXT NOT NULL DEFAULT 'TRADEMARK',
    evidence_url TEXT,
    status TEXT NOT NULL DEFAULT 'SUBMITTED',
    admin_notes TEXT,
    processed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
