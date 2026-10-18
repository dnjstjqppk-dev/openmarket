-- migrations/d1_11_data_integrity_fix.sql
-- OLMOA Data Integrity Hotfix: Category Slugs, Orphan Purge, L2 Taxonomy Alignment & Lowest Price Sync

-- 1. Fix Category Names and Canonical Slugs (WO-06)
UPDATE categories SET name = '홈/주방', slug = 'home-kitchen' WHERE id = 'cat_home';
UPDATE categories SET name = '뷰티/헬스', slug = 'beauty-health' WHERE id = 'cat_beauty';
UPDATE categories SET name = '스포츠/레저', slug = 'sports-outdoors' WHERE id = 'cat_sports';

-- 2. Resolve Orphaned Fashion Tree
UPDATE categories SET parent_id = 'cat_men' WHERE parent_id = 'cat_fashion' AND (id = 'cat_f_men' OR slug LIKE '%men%');
UPDATE categories SET parent_id = 'cat_women' WHERE parent_id = 'cat_fashion' AND (id = 'cat_f_women' OR slug LIKE '%women%');
DELETE FROM categories WHERE id = 'cat_fashion';

-- 3. Correct Review Target Product Mappings
UPDATE product_reviews SET product_id = 'prod_m_03' WHERE id = 'rev_004';
UPDATE product_reviews SET product_id = 'prod_e_02' WHERE id = 'rev_005';

-- 4. Map All Products to Concrete L2 Subcategories
UPDATE products SET category_id = 'sub_e_audio' WHERE id = 'prod_001';
UPDATE products SET category_id = 'sub_cel_03' WHERE id = 'prod_002';
UPDATE products SET category_id = 'sub_h_kitchen' WHERE id = 'prod_003';
UPDATE products SET category_id = 'sub_w_tops' WHERE id = 'prod_004';

UPDATE products SET category_id = 'sub_w_dress' WHERE id = 'prod_w_01';
UPDATE products SET category_id = 'sub_w_tops' WHERE id = 'prod_w_02';
UPDATE products SET category_id = 'sub_w_tops' WHERE id = 'prod_w_03';

UPDATE products SET category_id = 'sub_m_tshirts' WHERE id = 'prod_m_01';
UPDATE products SET category_id = 'sub_m_pants' WHERE id = 'prod_m_02';
UPDATE products SET category_id = 'sub_m_tshirts' WHERE id = 'prod_m_03';

UPDATE products SET category_id = 'sub_e_audio' WHERE id = 'prod_e_01';
UPDATE products SET category_id = 'sub_cel_04' WHERE id = 'prod_e_02';
UPDATE products SET category_id = 'sub_e_smart' WHERE id = 'prod_e_03';

UPDATE products SET category_id = 'sub_h_kitchen' WHERE id = 'prod_h_01';
UPDATE products SET category_id = 'sub_h_decor' WHERE id = 'prod_h_02';
UPDATE products SET category_id = 'sub_h_kitchen' WHERE id = 'prod_h_03';

UPDATE products SET category_id = 'sub_b_skin' WHERE id = 'prod_b_01';
UPDATE products SET category_id = 'sub_b_tool' WHERE id = 'prod_b_02';

UPDATE products SET category_id = 'sub_s_fit' WHERE id = 'prod_s_01';
UPDATE products SET category_id = 'sub_s_camp' WHERE id = 'prod_s_02';

UPDATE products SET category_id = 'sub_sb_bags' WHERE id = 'prod_sb_01';
UPDATE products SET category_id = 'sub_sb_shoes' WHERE id = 'prod_sb_02';

UPDATE products SET category_id = 'sub_t_lego' WHERE id = 'prod_t_01';
UPDATE products SET category_id = 'sub_t_lego' WHERE id = 'prod_t_02';

UPDATE products SET category_id = 'sub_a_mount' WHERE id = 'prod_a_01';
UPDATE products SET category_id = 'sub_a_mount' WHERE id = 'prod_a_02';
UPDATE products SET category_id = 'sub_a_mount' WHERE id = 'prod_a_03';

UPDATE products SET category_id = 'sub_j_watch' WHERE id = 'prod_j_01';
UPDATE products SET category_id = 'sub_j_watch' WHERE id = 'prod_j_02';
UPDATE products SET category_id = 'sub_j_watch' WHERE id = 'prod_j_03';

UPDATE products SET category_id = 'sub_bed_01' WHERE id = 'prod_bed_01';
UPDATE products SET category_id = 'sub_fur_01' WHERE id = 'prod_fur_01';
UPDATE products SET category_id = 'sub_app_02' WHERE id = 'prod_app_01';
UPDATE products SET category_id = 'sub_cel_01' WHERE id = 'prod_cel_01';
UPDATE products SET category_id = 'sub_smh_01' WHERE id = 'prod_smt_01';
UPDATE products SET category_id = 'sub_hlt_02' WHERE id = 'prod_hlt_01';
UPDATE products SET category_id = 'sub_bby_01' WHERE id = 'prod_bby_01';
UPDATE products SET category_id = 'sub_pet_03' WHERE id = 'prod_pet_01';
UPDATE products SET category_id = 'sub_ofc_03' WHERE id = 'prod_off_01';
UPDATE products SET category_id = 'sub_bks_03' WHERE id = 'prod_bok_01';
UPDATE products SET category_id = 'sub_crf_01' WHERE id = 'prod_crf_01';
UPDATE products SET category_id = 'sub_tol_01' WHERE id = 'prod_tol_01';
UPDATE products SET category_id = 'sub_ptg_02' WHERE id = 'prod_pat_01';
UPDATE products SET category_id = 'sub_fod_01' WHERE id = 'prod_fod_01';
UPDATE products SET category_id = 'sub_gam_01' WHERE id = 'prod_gam_01';
UPDATE products SET category_id = 'sub_mus_01' WHERE id = 'prod_mus_01';
UPDATE products SET category_id = 'sub_sec_01' WHERE id = 'prod_sec_01';
UPDATE products SET category_id = 'sub_trv_01' WHERE id = 'prod_trv_01';
UPDATE products SET category_id = 'sub_wat_01' WHERE id = 'prod_wat_01';
UPDATE products SET category_id = 'sub_pty_01' WHERE id = 'prod_prt_01';
UPDATE products SET category_id = 'sub_ind_01' WHERE id = 'prod_ind_01';
UPDATE products SET category_id = 'sub_gft_01' WHERE id = 'prod_gft_01';

-- 5. Synchronize lowest_sale_price & lowest_original_price from product_skus
UPDATE products 
SET lowest_sale_price = (
    SELECT MIN(sale_price) 
    FROM product_skus 
    WHERE product_skus.product_id = products.id
),
lowest_original_price = (
    SELECT MIN(original_price) 
    FROM product_skus 
    WHERE product_skus.product_id = products.id
)
WHERE id IN (SELECT DISTINCT product_id FROM product_skus);
