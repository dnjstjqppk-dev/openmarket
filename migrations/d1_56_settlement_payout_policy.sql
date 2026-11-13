-- d1_56_settlement_payout_policy.sql
-- Work order 2-4: platform policies with history, settlement PG/source columns,
-- seller payout requests.
-- Additive only. Rerun-safe (single-apply ALTERs per repo convention).

CREATE TABLE IF NOT EXISTS platform_policies (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS trg_policy_no_backdate_insert
BEFORE INSERT ON platform_policies
WHEN NEW.effective_from < date('now')
BEGIN
  SELECT RAISE(ABORT, 'POLICY_NO_BACKDATE');
END;

CREATE TRIGGER IF NOT EXISTS trg_policy_no_backdate_update
BEFORE UPDATE ON platform_policies
WHEN NEW.effective_from < date('now')
BEGIN
  SELECT RAISE(ABORT, 'POLICY_NO_BACKDATE');
END;

CREATE TABLE IF NOT EXISTS platform_policy_history (
  id TEXT PRIMARY KEY,
  policy_key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  old_effective_from TEXT,
  new_effective_from TEXT,
  changed_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_policy_history_key ON platform_policy_history(policy_key);

CREATE TRIGGER IF NOT EXISTS trg_policy_history
AFTER UPDATE ON platform_policies
BEGIN
  INSERT INTO platform_policy_history (id, policy_key, old_value, new_value, old_effective_from, new_effective_from, changed_by)
  VALUES ('ph_' || lower(hex(randomblob(8))), OLD.key, OLD.value, NEW.value, OLD.effective_from, NEW.effective_from, NEW.updated_by);
END;

ALTER TABLE settlements ADD COLUMN pg_fee_bps INTEGER;
ALTER TABLE settlements ADD COLUMN pg_fee_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settlements ADD COLUMN fee_source TEXT;
UPDATE settlements SET fee_source = 'SELLER' WHERE fee_source IS NULL;

CREATE TABLE IF NOT EXISTS payout_requests (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES partners(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED', 'APPROVED', 'REJECTED', 'TRANSFERRED', 'CANCELLED')),
  account_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payout_id TEXT REFERENCES payouts(id),
  reject_reason TEXT,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_requests_key ON payout_requests(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_requests_inflight
  ON payout_requests(partner_id) WHERE status = 'REQUESTED';
CREATE INDEX IF NOT EXISTS idx_payout_requests_partner ON payout_requests(partner_id, status);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_56_settlement_payout_policy.sql', CURRENT_TIMESTAMP);
