-- d1_59_seller_grade_penalty.sql
-- Work order 2-7: penalty rules, grade policies, monthly partner grades.
-- Tables ship empty: rule scores and grade thresholds are operator decisions
-- (see Q-2-7), entered through the 4-21 console once decided.
-- Additive only. Rerun-safe (single-apply ALTERs per repo convention).

CREATE TABLE IF NOT EXISTS penalty_rules (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  is_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS grade_policies (
  grade_code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  min_sales INTEGER CHECK (min_sales IS NULL OR min_sales >= 0),
  max_claim_rate REAL CHECK (max_claim_rate IS NULL OR (max_claim_rate >= 0 AND max_claim_rate <= 1)),
  min_ship_on_time_rate REAL CHECK (min_ship_on_time_rate IS NULL OR (min_ship_on_time_rate >= 0 AND min_ship_on_time_rate <= 1)),
  max_penalty_points INTEGER CHECK (max_penalty_points IS NULL OR max_penalty_points >= 0),
  is_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS partner_grades (
  partner_id TEXT NOT NULL REFERENCES partners(id),
  month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  grade_code TEXT,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (partner_id, month)
);
CREATE INDEX IF NOT EXISTS idx_partner_grades_month ON partner_grades(month);

ALTER TABLE partner_penalties ADD COLUMN rule_code TEXT;
ALTER TABLE partner_penalties ADD COLUMN points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE partner_penalties ADD COLUMN appeal_body TEXT;
ALTER TABLE partner_penalties ADD COLUMN decided_by TEXT;

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_59_seller_grade_penalty.sql', CURRENT_TIMESTAMP);
