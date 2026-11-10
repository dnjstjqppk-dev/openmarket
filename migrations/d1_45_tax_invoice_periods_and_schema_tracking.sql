-- d1_45_tax_invoice_periods_and_schema_tracking.sql
-- NEW-15: settlement-period columns for seller commission tax invoices.
-- NEW-16/P2-R1: schema_migrations version tracking (exposed via /health).
-- Additive only.

-- NEW-15: a commission tax invoice covers one partner + period. The partial
-- unique index makes double-issuance for the same period a 409, not a duplicate.
ALTER TABLE tax_invoices ADD COLUMN period_start TEXT;
ALTER TABLE tax_invoices ADD COLUMN period_end TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_tax_invoices_partner_period
  ON tax_invoices(partner_id, invoice_type, period_start, period_end)
  WHERE partner_id IS NOT NULL AND period_start IS NOT NULL;

-- NEW-16: applied-migration ledger.
-- Convention: every future migration ends with
--   INSERT OR IGNORE INTO schema_migrations (version, applied_at)
--   VALUES ('d1_NN_name.sql', CURRENT_TIMESTAMP);
-- (This backfill row set covers d1_01..d1_45 for databases that applied them
-- before the ledger existed; applied_at there records the backfill run.)
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO schema_migrations (version) VALUES
  ('d1_01_core.sql'),
  ('d1_02_seed.sql'),
  ('d1_03_temu_taxonomy.sql'),
  ('d1_04_enrich_catalog.sql'),
  ('d1_05_all_33_categories.sql'),
  ('d1_06_populate_skus.sql'),
  ('d1_07_rich_sku_options.sql'),
  ('d1_08_core_tables.sql'),
  ('d1_09a_new_roots_and_subcategories.sql'),
  ('d1_09b_subcategories_part2.sql'),
  ('d1_10_seed_deals_reviews.sql'),
  ('d1_11_data_integrity_fix.sql'),
  ('d1_12_addresses_notifications_banners.sql'),
  ('d1_13_partner_bank_accounts.sql'),
  ('d1_14_auth_tokens.sql'),
  ('d1_15_global_customs_and_fx.sql'),
  ('d1_16_global_kyc_hscode_and_logistics.sql'),
  ('d1_17_commercial_hardening.sql'),
  ('d1_18_temu_core_features.sql'),
  ('d1_19_category_matched_hs_codes.sql'),
  ('d1_20_integrity_foundation.sql'),
  ('d1_21_reserve_and_ops.sql'),
  ('d1_22_privacy_lifecycle.sql'),
  ('d1_23_seller_onboarding.sql'),
  ('d1_24_admin_security.sql'),
  ('d1_25_claims_policy.sql'),
  ('d1_26_commercial_expansion.sql'),
  ('d1_27_supplier_crawler_3pl.sql'),
  ('d1_28_feature_flags_and_crawler_expansion.sql'),
  ('d1_29_global_multichannel_and_supply_chain.sql'),
  ('d1_30_remove_seeded_reviews_and_sales.sql'),
  ('d1_31_void_unpaid_orders_marked_paid.sql'),
  ('d1_32_cancel_settlements_of_cancelled_orders.sql'),
  ('d1_33_catalog_read_indexes.sql'),
  ('d1_34_social_accounts.sql'),
  ('d1_35_social_login_codes.sql'),
  ('d1_36_consent_history.sql'),
  ('d1_37_honest_seed_copy.sql'),
  ('d1_38_payout_idempotency.sql'),
  ('d1_39_product_brand.sql'),
  ('d1_40_p1_api_data_integrity.sql'),
  ('d1_41_store_cross_border_pccc.sql'),
  ('d1_42_legal_compliance_fields.sql'),
  ('d1_43_p1_fund_abuse_guards.sql'),
  ('d1_44_ai_enhancement_skipped_status.sql'),
  ('d1_45_tax_invoice_periods_and_schema_tracking.sql');
