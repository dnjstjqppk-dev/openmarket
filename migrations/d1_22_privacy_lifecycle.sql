-- migrations/d1_22_privacy_lifecycle.sql
-- V3.1 audit item O10: member withdrawal, retention-based PII destruction, and PII access records.
--   * users.withdrawn_at          : self-service withdrawal (account is pseudonymised immediately)
--   * orders.pii_purged_at        : recipient data destroyed after the legal retention period
--   * support_inquiries.pii_purged_at
--   * pii_access_log              : append-only record of who viewed / exported / destroyed personal data
--
-- Retention defaults (overridable by env, CONFIRM WITH COUNSEL before launch):
--   orders (계약·대금결제·재화공급 기록, 전자상거래법 시행령 제6조) ........ 5 years  PII_ORDER_RETENTION_DAYS
--   support inquiries (소비자 불만·분쟁처리 기록) ............................ 3 years  PII_INQUIRY_RETENTION_DAYS
--   pii_access_log (개인정보의 안전성 확보조치 기준 제8조: 1년 이상, 일부 2년) . never auto-deleted here
--
-- OPERATIONS NOTE (production): additive only (new table, nullable columns). Apply after d1_21 with a
-- fresh `wrangler d1 export` backup and a recorded Time Travel bookmark.

PRAGMA defer_foreign_keys = ON;

ALTER TABLE users ADD COLUMN withdrawn_at TEXT;
ALTER TABLE orders ADD COLUMN pii_purged_at TEXT;
ALTER TABLE support_inquiries ADD COLUMN pii_purged_at TEXT;
CREATE INDEX IF NOT EXISTS idx_users_withdrawn ON users(withdrawn_at);

CREATE TABLE IF NOT EXISTS pii_access_log (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT,                 -- NULL for the system (cron purge)
    actor_role TEXT NOT NULL,           -- ROLE_ADMIN / ROLE_PARTNER / ROLE_CUSTOMER / SYSTEM
    actor_partner_id TEXT,
    action TEXT NOT NULL CHECK (action IN ('VIEW', 'EXPORT', 'WITHDRAW', 'PURGE')),
    resource TEXT NOT NULL,             -- e.g. admin.users, partner.orders, auth.privacy.export
    subject_type TEXT NOT NULL,         -- user / order / inquiry
    subject_ids_json TEXT NOT NULL DEFAULT '[]',
    subject_count INTEGER NOT NULL DEFAULT 0,
    fields TEXT,                        -- which personal data items were exposed
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pii_access_actor ON pii_access_log(actor_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pii_access_created ON pii_access_log(created_at);
CREATE TRIGGER IF NOT EXISTS trg_pii_access_no_update BEFORE UPDATE ON pii_access_log BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_pii_access_no_delete BEFORE DELETE ON pii_access_log BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

-- A withdrawn account can never be re-activated or have its identity restored by an UPDATE.
CREATE TRIGGER IF NOT EXISTS trg_users_withdrawn_final
BEFORE UPDATE ON users
WHEN OLD.withdrawn_at IS NOT NULL AND (NEW.withdrawn_at IS NULL OR NEW.is_active != 0 OR NEW.email != OLD.email OR NEW.password_hash != OLD.password_hash)
BEGIN SELECT RAISE(ABORT, 'ACCOUNT_WITHDRAWN'); END;
