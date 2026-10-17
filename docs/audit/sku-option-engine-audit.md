# OLMOA SKU Option Engine & Relational Schema Audit

## 1. Scope & Objective
- **Database**: Cloudflare D1 SQL (`openmarket-db`, UUID `6935e21b-ffdc-47d1-8e7d-d97b1b8b317a`)
- **Table**: `product_skus` (Foreign keys to `products`, referenced by `order_items`, `inventory_ledger`)
- **Policy**: Zero Fallback Policy — No virtual or synthetic SKUs allowed.

---

## 2. Relational Schema & Constraints
```sql
CREATE TABLE IF NOT EXISTS product_skus (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    sku_code TEXT NOT NULL UNIQUE,
    option_combination_json TEXT NOT NULL,
    original_price INTEGER NOT NULL,
    sale_price INTEGER NOT NULL,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    safety_stock INTEGER NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'IN_STOCK' CHECK (status IN ('IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. Rich Variant Migration (d1_07_rich_sku_options.sql)
Executed directly against production D1 with zero FK violations:
1. `prod_004` (데일리 오버핏 소프트 기모 후드티): 8 SKUs (색상 3종 x 사이즈 3종, ₩28,900 ~ ₩30,900)
2. `prod_w_01` (프렌치 시크 플리츠 롱 원피스): 7 SKUs (색상 3종 x 사이즈 3종, ₩18,900 ~ ₩19,900)
3. `prod_m_01` (헤비웨이트 프리미엄 코튼 반팔티): 6 SKUs (패키지 3종 x 사이즈 3종, ₩19,800 ~ ₩21,800)
4. `prod_e_01` (Hi-Fi 노이즈캔슬링 블루투스 헤드폰): 5 SKUs (색상 3종 x 패키지 2종, ₩45,900 ~ ₩52,900)
5. `prod_e_02` (초고속 보조배터리): 3 SKUs (스펙 20K vs 30K 울트라, ₩27,900 ~ ₩36,900)
6. `prod_sb_02` (통기성 경량 런닝화): 6 SKUs (색상 2종 x 사이즈 4종, ₩24,900)

---

## 4. Zero Fallback Policy Validation
- **Previous Vulnerability**: If `item.sku_id` was invalid or missing, server fell back to `firstSku` or hardcoded `sku_prod_001`.
- **Current Enforcement (`apps/cloudflare-gateway/src/routes/orders.js`)**:
  ```javascript
  if (!item.sku_id) {
    return new Response(JSON.stringify({ error: 'Missing sku_id. Fallback SKUs are forbidden.' }), { status: 400 });
  }
  const sku = await env.DB.prepare('SELECT ... FROM product_skus WHERE id = ?').bind(item.sku_id).first();
  if (!sku) {
    return new Response(JSON.stringify({ error: `Invalid SKU ID: ${item.sku_id}. Zero fallback enforced.` }), { status: 400 });
  }
  ```
- **Automated Verification**:
  - `curl -X POST /api/v1/orders/checkout` with `sku_id: 'sku_fake_phantom_999'` -> Returns `HTTP 400 Bad Request` (`{"error":"Invalid SKU ID: sku_fake_phantom_999. Zero fallback enforced."}`).
