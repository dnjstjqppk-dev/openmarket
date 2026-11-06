-- d1_34_social_accounts.sql
-- Social (OAuth) identity columns. A buyer that signs in with Kakao is keyed by
-- (oauth_provider, oauth_subject); password accounts keep both columns NULL.
-- Additive only: safe to apply on top of every earlier migration.
ALTER TABLE users ADD COLUMN oauth_provider TEXT;
ALTER TABLE users ADD COLUMN oauth_subject TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_subject);
