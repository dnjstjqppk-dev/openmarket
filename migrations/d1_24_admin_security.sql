-- migrations/d1_24_admin_security.sql
-- V3.1 audit item O11: operator roles (least privilege), TOTP two-factor authentication, recovery codes.
-- IP allow-listing is configuration (ADMIN_IP_ALLOWLIST), not schema.
--
-- admin_role (ROLE_ADMIN users only):
--   SUPER_ADMIN      everything, incl. operator accounts and business-entity changes
--   FINANCE          payouts, reconciliation, journal, refunds
--   OPERATIONS       catalog, sellers & applications, sourcing / purchase orders, orders, marketing
--   CS               orders / claims / refunds, customer lookup
--   PRIVACY_OFFICER  personal-data access log, customer lookup
-- Existing operator accounts become SUPER_ADMIN so nothing breaks on deploy; narrow them afterwards.
--
-- OPERATIONS NOTE (production): additive only. Apply after d1_23 with a fresh backup / Time Travel bookmark.

PRAGMA defer_foreign_keys = ON;

ALTER TABLE users ADD COLUMN admin_role TEXT CHECK (admin_role IS NULL OR admin_role IN ('SUPER_ADMIN', 'FINANCE', 'OPERATIONS', 'CS', 'PRIVACY_OFFICER'));
ALTER TABLE users ADD COLUMN totp_secret_enc TEXT;        -- AES-GCM encrypted base32 secret (key: TOTP_ENCRYPTION_KEY or derived from JWT_SECRET)
ALTER TABLE users ADD COLUMN totp_pending_enc TEXT;       -- secret shown during setup, not yet confirmed
ALTER TABLE users ADD COLUMN totp_enabled_at TEXT;
ALTER TABLE users ADD COLUMN totp_last_step INTEGER;      -- last accepted 30s time-step (replay protection)
ALTER TABLE users ADD COLUMN mfa_recovery_hashes_json TEXT; -- SHA-256 of unused one-time recovery codes

UPDATE users SET admin_role = 'SUPER_ADMIN' WHERE role = 'ROLE_ADMIN' AND admin_role IS NULL;

-- Only operator accounts carry an operator role.
CREATE TRIGGER IF NOT EXISTS trg_users_admin_role_scope_ins BEFORE INSERT ON users
WHEN NEW.admin_role IS NOT NULL AND NEW.role != 'ROLE_ADMIN'
BEGIN SELECT RAISE(ABORT, 'ADMIN_ROLE_SCOPE'); END;
CREATE TRIGGER IF NOT EXISTS trg_users_admin_role_scope_upd BEFORE UPDATE OF admin_role, role ON users
WHEN NEW.admin_role IS NOT NULL AND NEW.role != 'ROLE_ADMIN'
BEGIN SELECT RAISE(ABORT, 'ADMIN_ROLE_SCOPE'); END;
