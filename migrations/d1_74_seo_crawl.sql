-- d1_74_seo_crawl.sql
-- Phase 4-6 SEO/GEO/AEO + crawl architecture: durable IndexNow URL queue.
-- Prod has no Redis on the request path (local docker-compose remnant only),
-- so the queue lives in D1 like the Phase 3 notify outbox: enqueue is
-- synchronous, drain runs from the admin ops route and the cron tick.
-- Additive only. Rerun-safe (IF NOT EXISTS per repo convention).

CREATE TABLE IF NOT EXISTS indexnow_queue (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  UNIQUE (url, status)
);
CREATE INDEX IF NOT EXISTS idx_indexnow_queue_status ON indexnow_queue(status, created_at);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_74_seo_crawl.sql', CURRENT_TIMESTAMP);
