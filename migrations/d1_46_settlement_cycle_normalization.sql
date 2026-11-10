-- d1_46_settlement_cycle_normalization.sql
-- T10: the d1_13 seed wrote 'BI_WEEKLY' (with underscore) for pt_002, but the
-- API contract is WEEKLY/BIWEEKLY/MONTHLY. Normalize the known-bad value so
-- reads, the profile form, and the new write-time 400 all agree.
UPDATE partners SET settlement_cycle = 'BIWEEKLY' WHERE settlement_cycle = 'BI_WEEKLY';

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
  VALUES ('d1_46_settlement_cycle_normalization.sql', CURRENT_TIMESTAMP);
