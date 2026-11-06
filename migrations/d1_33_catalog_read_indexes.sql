-- migrations/d1_33_catalog_read_indexes.sql
-- Indexes for the two catalog queries that dominate D1 row reads.
--
-- D1 insights (24h to 2026-11-06): GET /api/v1/categories 2,112,660 rows over 165 runs (12,804/run) and
-- GET /api/v1/products 388,947 rows over 65 runs (5,984/run). Both are correlated subqueries that did a full SCAN of
-- products / product_skus once per outer row (194 categories x ~65 products; ~63 products x 95 SKUs).
--
-- Measured on a local D1 (wrangler 4.158 / miniflare) loaded with the 2026-11-05 prod backup, same results (sha256):
--   categories          12,610 -> 504 rows_read   (SCAN p -> SEARCH p USING COVERING INDEX idx_products_category_status)
--   products (default)   6,443 -> 426 rows_read   (SCAN s + temp B-tree -> SEARCH s USING INDEX idx_product_skus_product_price)
--   products?category      676 -> 230 rows_read   (SCAN p -> MULTI-INDEX OR on idx_products_category_status)
--
-- product_skus gets (product_id, sale_price), not (product_id) alone: it also removes the per-product sort for
-- "ORDER BY s.sale_price LIMIT 1" (426 vs 615 rows_read with a product_id-only index) and still serves every
-- "WHERE product_id = ?" lookup as a prefix.
-- product_reviews(product_id) is NOT added: idx_prod_reviews_pid (d1_08) already covers it and is already used
-- by both review subqueries; a second index with another name only doubles review write cost.
--
-- Applied to production 2026-11-06 with owner approval (rows_written=162). Verified on prod right after:
--   categories 12,804 -> 505 rows_read, products (default) 5,984 -> 384 rows_read, plans as above.
--
-- Additive and idempotent. Rollback: DROP INDEX IF EXISTS idx_products_category_status;
--                                    DROP INDEX IF EXISTS idx_product_skus_product_price;

CREATE INDEX IF NOT EXISTS idx_products_category_status ON products(category_id, status);
CREATE INDEX IF NOT EXISTS idx_product_skus_product_price ON product_skus(product_id, sale_price);
