-- D1 Migration 06: Ensure every product has at least one valid active SKU for real checkout

INSERT OR IGNORE INTO product_skus (id, product_id, sku_code, option_combination_json, original_price, sale_price, stock_quantity, safety_stock, status)
SELECT 
    'sku_' || p.id,
    p.id,
    'SKU-' || upper(replace(p.id, 'prod_', '')) || '-STD',
    '{"옵션":"기본 표준형"}',
    p.lowest_original_price,
    p.lowest_sale_price,
    250,
    10,
    'IN_STOCK'
FROM products p
WHERE p.id NOT IN (SELECT DISTINCT product_id FROM product_skus);
