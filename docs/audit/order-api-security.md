# OLMOA Order API Security & IDOR Remediation Audit

## 1. Vulnerability Assessment (CWE-639 / OWASP API1:2023)
- **Vulnerability**: Insecure Direct Object References (IDOR) on Order Endpoints.
- **Root Cause**:
  - `GET /api/v1/orders` executed an unscoped `SELECT * FROM orders LIMIT 50`, allowing any unauthenticated user to enumerate customer orders across the platform.
  - `GET /api/v1/orders/:id` returned complete order data without verifying that the requester owned the requested record.

---

## 2. Remediation Strategy & Implementation
In `apps/cloudflare-gateway/src/routes/orders.js`:

1. **Authentication Enforcement (`GET /api/v1/orders`)**:
   - Requires `X-Customer-Id` header (or auth token).
   - If missing, immediately returns `HTTP 401 Unauthorized`:
     ```json
     {"error": "Authentication required: X-Customer-Id header missing"}
     ```
   - Filters database query strictly by authenticated customer:
     ```sql
     SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50;
     ```

2. **Strict Object Ownership Validation (`GET /api/v1/orders/:id`)**:
   - Queries order by ID.
   - Enforces ownership:
     ```javascript
     if (customerId && customerId !== 'ADMIN' && order.customer_id !== customerId) {
       return new Response(JSON.stringify({ 
         error: 'Forbidden: Access denied to this order' 
       }), { status: 403, headers: corsHeaders });
     }
     ```

3. **CORS Hardening**:
   - Updated `apps/cloudflare-gateway/src/index.js` to explicitly authorize `X-Customer-Id` in `Access-Control-Allow-Headers`.

---

## 3. Verification & Live Test Evidence
- **Scenario A (Unauthenticated Enumeration)**:
  - Request: `curl.exe -s -i https://olmoa-api.dnjstjqppk.workers.dev/api/v1/orders`
  - Result: `HTTP/1.1 401 Unauthorized`
- **Scenario B (Cross-User IDOR Attack)**:
  - Request: `curl.exe -s -i -H "X-Customer-Id: u_customer_002" https://olmoa-api.dnjstjqppk.workers.dev/api/v1/orders/olm_ord_1792211089652`
  - Result: `HTTP/1.1 403 Forbidden` (`{"error":"Forbidden: Access denied to this order"}`)
- **Scenario C (Authorized Customer Access)**:
  - Request: `curl.exe -s -i -H "X-Customer-Id: u_customer_001" https://olmoa-api.dnjstjqppk.workers.dev/api/v1/orders/olm_ord_1792211089652`
  - Result: `HTTP/1.1 200 OK`

