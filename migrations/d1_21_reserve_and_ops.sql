-- migrations/d1_21_reserve_and_ops.sql
-- V3.1 follow-up to d1_20 (resolves audit items O18, O19).
--   * O18 Rolling reserve: a payout now withholds partners.rolling_reserve_pct of the gross amount as a
--     reserve hold, released into a later payout once `release_after` has passed. The held money stays
--     in SELLER_PAYABLE (it is still owed to the seller), so reconciliation R10 is unchanged.
--   * O19 Scheduled reconciliation: every run (cron or manual) is recorded; failures raise an alert.
--
-- OPERATIONS NOTE (production): apply only after d1_20, with a fresh `wrangler d1 export` backup and
-- a recorded Time Travel bookmark. Purely additive (new tables / nullable or defaulted columns):
-- rollback = restore the bookmark, or leave the objects unused.

PRAGMA defer_foreign_keys = ON;

-- ---------------------------------------------------------------------------------------------
-- 1. Rolling reserve
-- ---------------------------------------------------------------------------------------------
ALTER TABLE partners ADD COLUMN rolling_reserve_days INTEGER NOT NULL DEFAULT 90;

-- gross_amount = settlements + adjustments consumed by this payout (before reserve)
-- amount       = gross_amount - reserve_held + reserve_released  (what was actually wired)
ALTER TABLE payouts ADD COLUMN gross_amount INTEGER;
ALTER TABLE payouts ADD COLUMN reserve_held INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payouts ADD COLUMN reserve_released INTEGER NOT NULL DEFAULT 0;
UPDATE payouts SET gross_amount = amount WHERE gross_amount IS NULL;

CREATE TABLE IF NOT EXISTS payout_reserve_holds (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    operator_entity_id TEXT REFERENCES business_entities(id),
    held_by_payout_id TEXT NOT NULL REFERENCES payouts(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    reserve_bps INTEGER NOT NULL CHECK (reserve_bps > 0 AND reserve_bps <= 5000),
    release_after TEXT NOT NULL,
    released_payout_id TEXT REFERENCES payouts(id),
    released_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reserve_holds_partner_open ON payout_reserve_holds(partner_id, released_payout_id, release_after);

-- A hold can be released exactly once, and nothing else about it may change.
CREATE TRIGGER IF NOT EXISTS trg_reserve_holds_release_once
BEFORE UPDATE ON payout_reserve_holds
WHEN OLD.released_payout_id IS NOT NULL
  OR NEW.amount != OLD.amount OR NEW.partner_id != OLD.partner_id OR NEW.held_by_payout_id != OLD.held_by_payout_id
  OR NEW.reserve_bps != OLD.reserve_bps OR COALESCE(NEW.operator_entity_id, '') != COALESCE(OLD.operator_entity_id, '')
BEGIN SELECT RAISE(ABORT, 'RESERVE_HOLD_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_reserve_holds_no_delete BEFORE DELETE ON payout_reserve_holds
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

-- Payout money columns are frozen once written.
CREATE TRIGGER IF NOT EXISTS trg_payouts_amounts_frozen
BEFORE UPDATE ON payouts
WHEN NEW.amount != OLD.amount OR COALESCE(NEW.gross_amount, -1) != COALESCE(OLD.gross_amount, -1)
  OR NEW.reserve_held != OLD.reserve_held OR NEW.reserve_released != OLD.reserve_released
  OR NEW.partner_id != OLD.partner_id
BEGIN SELECT RAISE(ABORT, 'PAYOUT_AMOUNTS_FROZEN'); END;
CREATE TRIGGER IF NOT EXISTS trg_payouts_no_delete BEFORE DELETE ON payouts
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

-- ---------------------------------------------------------------------------------------------
-- 2. Reconciliation run history (cron + manual)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reconciliation_runs (
    id TEXT PRIMARY KEY,
    trigger_source TEXT NOT NULL CHECK (trigger_source IN ('CRON', 'MANUAL')),
    ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
    check_count INTEGER NOT NULL,
    failed_checks_json TEXT NOT NULL DEFAULT '[]',
    alert_status TEXT NOT NULL DEFAULT 'NOT_NEEDED' CHECK (alert_status IN ('NOT_NEEDED', 'SENT', 'FAILED', 'NO_CHANNEL')),
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_created ON reconciliation_runs(created_at);
CREATE TRIGGER IF NOT EXISTS trg_reconciliation_runs_no_update BEFORE UPDATE ON reconciliation_runs
WHEN NEW.ok != OLD.ok OR NEW.failed_checks_json != OLD.failed_checks_json OR NEW.check_count != OLD.check_count
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
