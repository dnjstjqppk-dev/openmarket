-- migrations/d1_15_global_customs_and_fx.sql
-- OLMOA Global OpenMarket Engine: Multi-Currency Exchange Rates, PCCC Customs Fields & DDP/DDU

ALTER TABLE orders ADD COLUMN pccc TEXT;
ALTER TABLE orders ADD COLUMN pccc_verified INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN customs_duty_type TEXT DEFAULT 'DDU';
ALTER TABLE orders ADD COLUMN estimated_duty_amount INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN settlement_currency TEXT DEFAULT 'KRW';
ALTER TABLE orders ADD COLUMN fx_rate REAL DEFAULT 1.0;

CREATE TABLE IF NOT EXISTS exchange_rates (
    base_currency TEXT NOT NULL DEFAULT 'KRW',
    target_currency TEXT NOT NULL,
    rate REAL NOT NULL,
    inverse_rate REAL NOT NULL,
    spread_pct REAL NOT NULL DEFAULT 1.2,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (base_currency, target_currency)
);

INSERT OR REPLACE INTO exchange_rates (base_currency, target_currency, rate, inverse_rate, spread_pct) VALUES
('KRW', 'USD', 0.0007246, 1380.0, 1.2),
('KRW', 'JPY', 0.1111, 9.0, 1.2),
('KRW', 'EUR', 0.0006711, 1490.0, 1.2),
('KRW', 'CNY', 0.005208, 192.0, 1.2);

