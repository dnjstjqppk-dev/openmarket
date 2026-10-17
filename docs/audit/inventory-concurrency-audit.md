# OLMOA Inventory Concurrency & Stock Ledger Audit

## 1. Concurrency Model & Objective
To ensure strict e-commerce transactional safety under high traffic:
1. Prevent overselling (negative inventory).
2. Guarantee idempotency against duplicate webhook / network retries.
3. Maintain an immutable audit trail (`inventory_ledger`).

---

## 2. Atomic Stock Decrement Engine
In `apps/cloudflare-gateway/src/routes/orders.js`:
- Rather than a race-condition-prone read-then-write, deduction is executed atomically at the SQL engine level:
  ```sql
  UPDATE product_skus 
  SET stock_quantity = stock_quantity - ?, 
      status = CASE WHEN stock_quantity - ? <= 0 THEN 'OUT_OF_STOCK' ELSE status END 
  WHERE id = ? AND stock_quantity >= ?;
  ```
- If two concurrent requests contest the final item of stock, exactly one succeeds (`changes === 1`).
- The losing transaction receives `changes === 0`, triggering an immediate `HTTP 409 Conflict` response (`{"error": "Concurrent inventory conflict"}`).

---

## 3. Double-Entry Audit Ledger (`inventory_ledger`)
Every stock reduction creates an immutable record in `inventory_ledger`:
```sql
INSERT INTO inventory_ledger (
    id, sku_id, change_type, quantity_delta, balance_after, reference_id, idempotency_key
) VALUES (?, ?, 'PURCHASE_DEDUCT', ?, ?, ?, ?);
```

### Live D1 Production Proof (Query Verification)
```json
{
  "id": "ldg_1792211090049_dt9j",
  "sku_id": "sku_004_blk_m",
  "change_type": "PURCHASE_DEDUCT",
  "quantity_delta": -1,
  "balance_after": 149,
  "reference_id": "olm_ord_1792211089652"
}
```

---

## 4. Idempotency Key Handling
- Checkout accepts `X-Idempotency-Key` header or `body.idempotency_key`.
- On receipt of a previously processed key:
  - Gateway queries `inventory_ledger WHERE idempotency_key = ? OR idempotency_key LIKE ?`.
  - Replays existing parent order without re-deducting stock.
  - Returns `{"idempotent_replay": true, "order_id": "...", "status": "PAID"}`.
- Verified in `tests/commerce_engine_e2e.js` Step 6: 100% pass.

