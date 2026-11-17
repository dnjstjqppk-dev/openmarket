-- d1_69_policy_kst_effective.sql
-- Work order 5-8: platform policy days are KST calendar days, and one key may
-- hold several effective_from rows (a future registration coexists with the
-- current value instead of overwriting it). Reads take the latest
-- already-effective row (ORDER BY effective_from DESC LIMIT 1).
-- Additive in effect: existing rows are preserved; the old single-key primary
-- key becomes (key, effective_from).

PRAGMA defer_foreign_keys = ON;

DROP TRIGGER IF EXISTS trg_policy_no_backdate_insert;
DROP TRIGGER IF EXISTS trg_policy_no_backdate_update;
DROP TRIGGER IF EXISTS trg_policy_history;

CREATE TABLE platform_policies_v69 (
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (key, effective_from)
);
INSERT INTO platform_policies_v69 (key, value, effective_from, updated_by, updated_at)
  SELECT key, value, effective_from, updated_by, updated_at FROM platform_policies;
DROP TABLE platform_policies;
ALTER TABLE platform_policies_v69 RENAME TO platform_policies;

CREATE INDEX IF NOT EXISTS idx_platform_policies_key_effective
  ON platform_policies(key, effective_from DESC);

CREATE TRIGGER trg_policy_no_backdate_insert
BEFORE INSERT ON platform_policies
WHEN NEW.effective_from < date('now', '+9 hours')
BEGIN
  SELECT RAISE(ABORT, 'POLICY_NO_BACKDATE');
END;

CREATE TRIGGER trg_policy_no_backdate_update
BEFORE UPDATE ON platform_policies
WHEN NEW.effective_from < date('now', '+9 hours')
BEGIN
  SELECT RAISE(ABORT, 'POLICY_NO_BACKDATE');
END;

CREATE TRIGGER trg_policy_history
AFTER UPDATE ON platform_policies
BEGIN
  INSERT INTO platform_policy_history (id, policy_key, old_value, new_value, old_effective_from, new_effective_from, changed_by)
  VALUES ('ph_' || lower(hex(randomblob(8))), OLD.key, OLD.value, NEW.value, OLD.effective_from, NEW.effective_from, NEW.updated_by);
END;

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_69_policy_kst_effective.sql', CURRENT_TIMESTAMP);
