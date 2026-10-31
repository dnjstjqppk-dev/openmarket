-- migrations/d1_17_commercial_hardening.sql
-- OLMOA 100% Commercial Turnkey Readiness: Payment Gateway Logs, Storage Registry & Notification Dispatch

-- 1. Real PG Payment Transactions
CREATE TABLE IF NOT EXISTS payment_transactions (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id),
    payment_key TEXT UNIQUE,
    provider TEXT NOT NULL DEFAULT 'TOSS',
    method TEXT NOT NULL DEFAULT 'CARD',
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'KRW',
    status TEXT NOT NULL DEFAULT 'DONE',
    receipt_url TEXT,
    raw_response_json TEXT,
    approved_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Cloudflare R2 & Media Storage Registry
CREATE TABLE IF NOT EXISTS storage_objects (
    id TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    folder TEXT NOT NULL DEFAULT 'products',
    uploader_id TEXT,
    storage_backend TEXT NOT NULL DEFAULT 'D1_EMBEDDED',
    data_base64 TEXT,
    public_url TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. External SMS / AlimTalk / Email Delivery Logs
CREATE TABLE IF NOT EXISTS notification_delivery_logs (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL DEFAULT 'ALIMTALK',
    recipient TEXT NOT NULL,
    template_code TEXT NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'SENT',
    provider TEXT NOT NULL DEFAULT 'SOLAPI',
    provider_msg_id TEXT,
    sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Add PG tracking columns to orders table safely
ALTER TABLE orders ADD COLUMN payment_key TEXT;
ALTER TABLE orders ADD COLUMN pg_provider TEXT DEFAULT 'TOSS';
ALTER TABLE orders ADD COLUMN pg_receipt_url TEXT;

