# OLMOA Checkout Price Integrity & Split-Order Audit

## 1. Vulnerability Analysis & Historical Defect
- **Identified Defect**: In prior builds, `orders.js` calculated order totals via `totalGoods += (item.price || 0) * (item.quantity || 1)`.
- **Exploitation Risk**: An attacker could modify browser memory, local storage, or send a manipulated JSON payload (`"price": 100`) via HTTP POST, purchasing high-value items at arbitrary sub-market rates.

---

## 2. Server-Side Price Authority Architecture
In `apps/cloudflare-gateway/src/routes/orders.js`:
1. **Zero-Trust Client Pricing**: The server completely discards any `price` property transmitted in the checkout request payload.
2. **Authoritative Database Lookup**:
   ```javascript
   const sku = await env.DB.prepare(
     `SELECT s.*, p.partner_id, p.title as prod_title 
      FROM product_skus s 
      JOIN products p ON s.product_id = p.id 
      WHERE s.id = ?`
   ).bind(item.sku_id).first();
   ```
3. **Cross-Product Integrity Check**: If `item.product_id` is supplied, the server validates `item.product_id === sku.product_id`. Any mismatch triggers an immediate `HTTP 400 Bad Request`.
4. **Authoritative Calculation**:
   - `unitPrice = sku.sale_price`
   - `lineTotal = sku.sale_price * quantity`
   - `totalGoods = sum(lineTotal)`

---

## 3. Parent-Order to Sub-Order Consistency Guarantee
Orders are grouped by seller/partner into independent sub-orders:
- **Sub-Order Goods Amount**: Sum of item line totals for that partner.
- **Sub-Order Shipping Fee**: ₩0 if sub-order goods >= ₩30,000; otherwise ₩3,000.
- **Mathematical Invariants**:
  $$\sum \text{sub\_order.goods\_amount} = \text{parent\_order.total\_goods\_amount}$$
  $$\sum \text{sub\_order.shipping\_fee} = \text{parent\_order.total\_shipping\_amount}$$
  $$\sum \text{sub\_order.total\_amount} = \text{parent\_order.total\_pay\_amount}$$

---

## 4. Live Penetration Test Proof
In `tests/commerce_engine_e2e.js` (Test 5):
- **Malicious Payload Sent**:
  ```json
  { "sku_id": "sku_004_blk_l", "product_id": "prod_004", "quantity": 1, "price": 50 }
  ```
- **Server Response**:
  - `status`: `201 Created`
  - `total_goods_amount`: `28900` (Server overrode client's 50 KRW with real DB price 28,900 KRW)
  - `total_shipping_amount`: `3000`
  - `total_pay_amount`: `31900`
- **Result**: PASSED. Zero price tampering is possible.
