-- d1_67_support_sla_pii_reason.sql
-- Work order 4-20: inquiry assignee + PII access reason on the audit trail.
ALTER TABLE support_inquiries ADD COLUMN assignee_admin_id TEXT REFERENCES users(id);
ALTER TABLE pii_access_log ADD COLUMN reason TEXT;

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_67_support_sla_pii_reason.sql', CURRENT_TIMESTAMP);
