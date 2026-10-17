# OLMOA PDP (Product Detail Page) Gap Analysis & Engine Audit

## 1. Executive Summary
- **Target Component**: `apps/storefront/src/views/ProductDetailView.vue`
- **Backend API**: `GET /api/v1/products/:id` (`apps/cloudflare-gateway/src/routes/catalog.js`)
- **Status**: Remediated & Verified in Production

---

## 2. Prior Gaps & Technical Debt Identified
1. **Raw SKU Code Exposure**: Displayed flat buttons using internal database codes (`sku_code`) rather than consumer-friendly multi-attribute options (e.g., Color, Size).
2. **Missing Attribute Hierarchy**: No dimensional parsing of `option_combination_json` on the server or client.
3. **Uncapped Quantity Counter**: Users could increment quantity beyond available warehouse stock, causing runtime order failures or overselling.
4. **Zero Fallback & Price Drift**: UI defaulted to product-level lowest price rather than selected variant price.
5. **XSS Security Exposure**: `description_html` was rendered without script tag neutralization.

---

## 3. Remediation Architecture
- **Server Gateway Dynamic Aggregation (`catalog.js`)**:
  - Parses `option_combination_json` for every SKU belonging to the product.
  - Aggregates unique attribute dimensions into structured `attributes` array (`[{ name: "색상", values: [...] }, { name: "사이즈", values: [...] }]`).
  - Sorts SKUs by `sale_price ASC`.
- **Client Reactive Multi-Option Selector (`ProductDetailView.vue`)**:
  - `selectedOptions`: Reactive key-value dictionary matching user attribute selections.
  - `findMatchingSku()`: Resolves matching variant from `product.skus` based on chosen dimensions.
  - Live price recalculation: `selectedSku.sale_price` and `selectedSku.original_price`.
  - Reactive discount badge calculation: `-Math.round(((orig - sale) / orig) * 100)%`.
  - Stock ceiling enforcement: `quantity` clamped between `1` and `selectedSku.stock_quantity`.
  - Out of stock badge (`현재 품절`) with disabled purchase CTA buttons.
  - `safeDescription`: Regex filter removing `<script>` elements.

---

## 4. Verification Evidence (Live D1 prod_004)
- **Product**: 데일리 오버핏 소프트 기모 후드티 (10컬러)
- **Attributes**:
  - `색상`: 그레이, 블랙, 네이비 (3 values)
  - `사이즈`: M, L, XL (3 values)
- **SKU Options Tested**:
  - `sku_004_blk_m`: ₩28,900 / 재고 149개 / IN_STOCK
  - `sku_004_blk_xl`: ₩30,900 / 재고 80개 / IN_STOCK
  - `sku_004_gry_xl`: ₩30,900 / 재고 0개 / OUT_OF_STOCK (CTA Disabled)
- **Automated Test**: `tests/commerce_engine_e2e.js` Step 3 passed.
