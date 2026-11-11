-- d1_48_auth_refresh_tokens.sql
-- P2-SEC-07: opaque single-use refresh tokens (sha256 at rest) with rotation.
-- Tied to users.token_version, so logout-all / password reset kills the family.
-- Additive only.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  token_version INTEGER NOT NULL DEFAULT 0,
  mfa INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_48_auth_refresh_tokens.sql', CURRENT_TIMESTAMP);
