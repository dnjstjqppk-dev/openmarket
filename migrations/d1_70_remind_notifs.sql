-- d1_70_remind_notifs.sql
-- Work order 5-9 (master spec K-06, K-09): once-only reminder bookkeeping.
-- K-09: per-sub-order flags so the confirm/review reminders fire at most once.
-- K-06: log of price-drop history rows already bundled per member, with the
-- KST day of the bundle (daily-once gate).
-- Additive only. Rerun-safe (single-apply ALTERs per repo convention).

ALTER TABLE sub_orders ADD COLUMN confirm_reminded_at TEXT;
ALTER TABLE sub_orders ADD COLUMN review_reminded_at TEXT;

CREATE TABLE IF NOT EXISTS price_drop_notifs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  history_id TEXT NOT NULL REFERENCES sku_price_history(id),
  notified_day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, history_id)
);
CREATE INDEX IF NOT EXISTS idx_price_drop_notifs_user_day ON price_drop_notifs(user_id, notified_day);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_70_remind_notifs.sql', CURRENT_TIMESTAMP);
