-- d1_77_user_locale.sql
-- Work order 6-2: saved storefront locale behind the /en /ja mirrors.
-- (The legacy 000003 draft carried a locale column that the d1 line never
-- applied; this is the authoritative add. Existing rows default to ko-KR.)
-- Additive only. Rerun-safe (single-apply ALTER per repo convention).

ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'ko-KR';

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES ('d1_77_user_locale.sql', CURRENT_TIMESTAMP);
