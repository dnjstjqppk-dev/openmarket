-- migrations/d1_41_store_cross_border_pccc.sql
-- S-N01: per-item cross-border flag. Products fulfilled from abroad require the
-- buyer's PCCC at checkout (customs clearance); without a catalog flag the
-- checkout PCCC box was opt-in only and overseas orders could succeed with
-- pccc=null. Existing rows default to domestic (0); operators flag overseas
-- products via admin catalog tooling.
ALTER TABLE products ADD COLUMN requires_pccc INTEGER NOT NULL DEFAULT 0 CHECK (requires_pccc IN (0, 1));
