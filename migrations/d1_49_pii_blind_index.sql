-- d1_49_pii_blind_index.sql
-- SEC-10: notification recipient/content are sealed at rest; recipients need a
-- deterministic blind index so withdrawal purge (services/privacy.js) can still
-- find rows by e-mail/phone without decrypting the table. Legacy plaintext rows
-- (recipient_hash NULL) are matched by the plaintext OR branch until rewritten.
-- Additive only.
ALTER TABLE notification_delivery_logs ADD COLUMN recipient_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_delivery_logs_recipient_hash ON notification_delivery_logs(recipient_hash);
INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_49_pii_blind_index.sql', CURRENT_TIMESTAMP);
