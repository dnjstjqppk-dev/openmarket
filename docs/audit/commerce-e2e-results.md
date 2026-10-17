# OLMOA Commerce Engine E2E Automated Test Results

## 1. Execution Summary
- **Execution Timestamp**: 2026-10-17 04:39:12 UTC (13:39:12 KST)
- **Test Runner**: Node.js v24.18.0 (`tests/commerce_engine_e2e.js`)
- **Target Endpoints**:
  - Storefront: `https://openmarket.dnjstjqppk.workers.dev`
  - Edge API Gateway: `https://olmoa-api.dnjstjqppk.workers.dev`
  - D1 Cloud Database: `openmarket-db` (UUID `6935e21b-ffdc-47d1-8e7d-d97b1b8b317a`)
- **Total Test Cases**: 8
- **Passed**: 8 (100%)
- **Failed**: 0 (0%)

---

## 2. Test Execution Log Matrix

| # | Test Scenario | Target URL / Operation | Expected Result | Actual Result | Status |
|---|---------------|------------------------|-----------------|---------------|:------:|
| 1 | Storefront Live Availability | `GET /` on `openmarket.dnjstjqppk.workers.dev` | HTTP 200, contains "OLMOA" / "올모아" | HTTP 200 OK, brand rendered | ✅ PASS |
| 2 | Edge Gateway Health & D1 | `GET /health` on `olmoa-api` | status: UP, db: CONNECTED_D1, >= 33 cats | status: UP, 33 categories, D1 active | ✅ PASS |
| 3 | Multi-Attribute SKU Schema | `GET /api/v1/products/prod_004` | Aggregated `attributes` + multi-SKU list | 2 attributes (색상, 사이즈), 8 SKUs | ✅ PASS |
| 4 | Zero Fallback Enforcement | `POST /api/v1/orders/checkout` with fake SKU | HTTP 400 Bad Request, reject synthetic fallback | HTTP 400, "Zero fallback enforced" | ✅ PASS |
| 5 | Server Price Integrity | `POST /checkout` with manipulated price ₩50 | Server ignores ₩50, charges DB price ₩28,900 | HTTP 201, total ₩31,900 (incl. ₩3,000 ship) | ✅ PASS |
| 6 | Idempotency Key Handling | `POST /checkout` duplicate key replay | Returns cached order, no duplicate stock deduction | HTTP 200, `idempotent_replay: true` | ✅ PASS |
| 7 | Stock Limit Ceiling | `POST /checkout` on out-of-stock SKU | HTTP 409 Conflict, reject overselling | HTTP 409, "Stock insufficient" | ✅ PASS |
| 8 | IDOR Access Control | `GET /api/v1/orders` & `/orders/:id` | 401 on missing header, 403 on cross-user | 401 Unauthorized, 403 Forbidden | ✅ PASS |

---

## 3. Detailed Verification Metrics
- **Parent to Sub-Order Reconciliation**:
  - Parent `total_goods_amount` (₩28,900) == Sub-order `goods_amount` (₩28,900).
  - Parent `total_shipping_amount` (₩3,000) == Sub-order `shipping_fee` (₩3,000).
  - Parent `total_pay_amount` (₩31,900) == Sub-order `total_amount` (₩31,900).
- **Inventory Ledger Audit**:
  - Validated record `ldg_1792211090049_dt9j` in `inventory_ledger`.
  - Balance correctly decremented with matching `reference_id`.

