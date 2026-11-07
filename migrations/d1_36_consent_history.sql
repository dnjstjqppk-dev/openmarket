-- d1_36_consent_history.sql
-- P2R-03: signup required agree_terms + agree_privacy but stored nothing, leaving no
-- audit trail of what the customer consented to. user_consents is append-only history:
-- one row per (user, consent_type) change, the latest row per type is current.
-- consent_type: TERMS_OF_SERVICE | PRIVACY_POLICY | MARKETING.
-- Additive only: safe to apply on top of every earlier migration.
CREATE TABLE IF NOT EXISTS user_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL CHECK (consent_type IN ('TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'MARKETING')),
  consented INTEGER NOT NULL CHECK (consented IN (0, 1)),
  terms_version TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_consents_user_type ON user_consents(user_id, consent_type, created_at);
