-- migrations/d1_23_seller_onboarding.sql
-- V3.1 audit item O05: self-service seller application, private KYB documents, operator review.
--   * partners: application / review columns. kyc_status lifecycle for applicants:
--       DRAFT -> SUBMITTED -> (RESUBMIT_REQUIRED -> SUBMITTED)* -> APPROVED | REJECTED
--     Partners created before this migration keep applied_at = NULL (legacy, reviewed off-system).
--   * partner_kyb_documents: which uploaded file proves what, and the reviewer's decision per document.
--   * storage_objects.visibility: PRIVATE objects are served only to their uploader and to operators.
--
-- Deliberately NOT collected: copies of resident registration cards (주민등록번호 수집 제한, 개인정보 보호법 제24조의2).
--
-- OPERATIONS NOTE (production): additive only. Apply after d1_22 with a fresh backup / Time Travel bookmark.

PRAGMA defer_foreign_keys = ON;

ALTER TABLE partners ADD COLUMN representative_name TEXT;
ALTER TABLE partners ADD COLUMN mail_order_reg_number TEXT;
ALTER TABLE partners ADD COLUMN mail_order_exempt_reason TEXT;
ALTER TABLE partners ADD COLUMN applied_at TEXT;
ALTER TABLE partners ADD COLUMN submitted_at TEXT;
ALTER TABLE partners ADD COLUMN reviewed_at TEXT;
ALTER TABLE partners ADD COLUMN reviewed_by TEXT;
ALTER TABLE partners ADD COLUMN review_note TEXT;
ALTER TABLE partners ADD COLUMN seller_terms_version TEXT;
CREATE INDEX IF NOT EXISTS idx_partners_kyc_status ON partners(kyc_status, submitted_at);

ALTER TABLE storage_objects ADD COLUMN visibility TEXT NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC', 'PRIVATE'));

CREATE TABLE IF NOT EXISTS partner_kyb_documents (
    id TEXT PRIMARY KEY,
    partner_id TEXT NOT NULL REFERENCES partners(id),
    doc_type TEXT NOT NULL CHECK (doc_type IN ('BUSINESS_REGISTRATION', 'MAIL_ORDER_REGISTRATION', 'BANK_ACCOUNT_COPY', 'OTHER')),
    storage_object_id TEXT NOT NULL REFERENCES storage_objects(id),
    status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED')),
    review_note TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kyb_docs_partner ON partner_kyb_documents(partner_id, doc_type, status);
CREATE TRIGGER IF NOT EXISTS trg_kyb_docs_no_delete BEFORE DELETE ON partner_kyb_documents
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS trg_kyb_docs_file_frozen BEFORE UPDATE ON partner_kyb_documents
WHEN NEW.storage_object_id != OLD.storage_object_id OR NEW.partner_id != OLD.partner_id OR NEW.doc_type != OLD.doc_type
BEGIN SELECT RAISE(ABORT, 'KYB_DOCUMENT_FROZEN'); END;
