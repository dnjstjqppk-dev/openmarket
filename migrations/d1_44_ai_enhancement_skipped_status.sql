-- d1_44_ai_enhancement_skipped_status.sql
-- NEW-02: the AI step never calls an external API, so its honest terminal
-- status is 'SKIPPED'. The d1_28 CHECK only admits COMPLETED /
-- BLOCKED_NO_CREDENTIAL / FAILED, which would force a false report to store.
-- Rebuild the table with SKIPPED admitted (and as the default); existing
-- audit rows are preserved by copy. No table references
-- ai_product_enhancements, so DROP+RENAME is FK-safe.
CREATE TABLE ai_product_enhancements_v44 (
    id TEXT PRIMARY KEY,
    import_job_id TEXT REFERENCES product_import_jobs(id),
    product_id TEXT REFERENCES products(id),
    source_language TEXT NOT NULL DEFAULT 'EN',
    target_language TEXT NOT NULL DEFAULT 'KO',
    original_title TEXT NOT NULL,
    translated_title TEXT,
    enhanced_summary TEXT,
    bullets_json TEXT,
    provider TEXT NOT NULL DEFAULT 'RULE_BASED_LOCALIZER' CHECK (provider IN ('RULE_BASED_LOCALIZER', 'VERTEX_AI', 'OPENAI', 'CLOUDFLARE_AI')),
    status TEXT NOT NULL DEFAULT 'SKIPPED' CHECK (status IN ('COMPLETED', 'BLOCKED_NO_CREDENTIAL', 'FAILED', 'SKIPPED')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO ai_product_enhancements_v44 (id, import_job_id, product_id, source_language, target_language, original_title, translated_title, enhanced_summary, bullets_json, provider, status, created_at)
  SELECT id, import_job_id, product_id, source_language, target_language, original_title, translated_title, enhanced_summary, bullets_json, provider, status, created_at FROM ai_product_enhancements;
DROP TABLE ai_product_enhancements;
ALTER TABLE ai_product_enhancements_v44 RENAME TO ai_product_enhancements;
