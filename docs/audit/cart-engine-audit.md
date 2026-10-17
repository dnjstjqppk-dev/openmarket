# OLMOA Cart Engine & Reactive Store Audit

## 1. Core Architecture
- **State Store**: `apps/storefront/src/stores/cart.ts` (Pinia + LocalStorage `olmoa_cart_items_v2`)
- **Cart View**: `apps/storefront/src/views/CartView.vue`
- **Configuration**: `apps/storefront/src/config.ts` (`API_BASE_URL`)

---

## 2. Technical Capabilities & Enhancements
1. **In-Cart Option Modification Modal**:
   - Customers can change SKU options directly inside `CartView.vue` without returning to PDP.
   - Fetches product SKUs dynamically via `GET /api/v1/products/:id`.
   - Displays real-time stock and price for each alternative variant.
   - Calls `cartStore.updateSku(oldSkuId, newSku)` to seamlessly replace item while preserving cart state.
2. **Stock Ceiling Enforcement**:
   - `CartItem` interface includes `stock_quantity?: number`.
   - The `+` increment button in `CartView.vue` is disabled when `item.quantity >= item.stock_quantity`.
   - Direct quantity updates in `updateQuantity()` clamp quantity: `Math.min(quantity, ceiling)`.
3. **Threshold-Based Free Shipping Progress**:
   - Real-time calculation: `freeShippingRemaining = Math.max(0, 30000 - totalGoodsAmount)`.
   - Displays celebratory banner (`🎉 전 품목 100% 무료배송 혜택`) once ₩30,000 is met.
4. **Card Catalog Navigation Safety**:
   - Eliminated blind `addItem(p, null, 1)` from `HomeView.vue`, `CategoryView.vue`, and `SearchView.vue`.
   - Replaced with `<router-link :to="'/product/' + p.id">` ("옵션 선택 / 구매") ensuring customers select real options.

---

## 3. Storefront State Contract
```typescript
export interface CartItem {
  sku_id: string;
  product_id: string;
  title: string;
  option_summary: string;
  price: number;
  original_price: number;
  thumbnail_url: string;
  quantity: number;
  stock_quantity?: number;
  partner_id?: string;
}
```

---

## 4. Verification & QA Status
- In-cart option modal tested on live web app.
- Clamping verified on both 1-unit minimum and available stock maximum.
- Total payment and shipping amounts match Edge Gateway checkout calculations to the exact KRW integer.

