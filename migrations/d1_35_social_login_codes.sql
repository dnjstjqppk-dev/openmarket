-- d1_35_social_login_codes.sql
-- Single-use login codes for the OAuth callback. The callback redirects the browser with
-- ?social_code=<one-time code> instead of the JWT itself (URLs land in history, server logs,
-- and referers); the SPA exchanges the code once for a JWT within 5 minutes.
-- Additive only: safe to apply on top of every earlier migration.
CREATE TABLE IF NOT EXISTS social_login_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_social_login_codes_user ON social_login_codes(user_id);
