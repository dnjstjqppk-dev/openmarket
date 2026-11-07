-- d1_39_product_brand.sql
-- The seller console sends brand on create/edit but the column never existed,
-- so it was silently dropped. Adds it (nullable, display-only for now).
-- Additive only: safe to apply on top of every earlier migration.
ALTER TABLE products ADD COLUMN brand TEXT;
