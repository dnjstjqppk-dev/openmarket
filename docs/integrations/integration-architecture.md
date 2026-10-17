# OLMOA External Integration Architecture & Data Governance

## 1. Overview
OLMOA provides secure, decoupled integration adapters for certified external partners while protecting core transaction engines and D1 database integrity.

```
+--------------------+        +-----------------------+        +-------------------+
| PriceScanner (Agg) | -----> | Feed Adapter (Cloudflare) |---> | Cloudflare D1 SQL |
+--------------------+   ^    +-----------------------+        +-------------------+
                         |
           X-Integration-Key Auth & Edge Caching (60s)
```

## 2. PriceScanner Integration Adapter
To prevent database query exhaustion and security leaks, PriceScanner is NOT granted direct SQL or internal service credentials.

- **Endpoint**: `GET /api/v1/integrations/pricescanner/feed`
- **Authentication**: `X-Integration-Key` header verified against edge environment secret.
- **Data Filtering**:
  - Only products with `status = 'ACTIVE'` and non-empty stock are included.
  - Sensitive internal cost data, partner settlement margins, and customer identifiers are stripped.
- **Deep Linking**: Each item generates a canonical tracking URL (`https://openmarket.dnjstjqppk.workers.dev/product/{id}?ref=pricescanner`).
- **Edge Caching**: Cached with `Cache-Control: public, max-age=60, s-maxage=300`.
- **Incremental Sync**: Supports `since` parameter (`ISO 8601`) returning only catalog updates since specified timestamp.

## 3. Multi-Tenant Partner Isolation
Partner portals and APIs enforce strict multi-tenant boundaries:
- **Tenant Context**: Injected via verified `X-Partner-Id` header (and JWT `sub`/`partner_id`).
- **Product Mutability**: In `PUT /api/v1/partner/products/:id/stock`, the worker validates `SELECT partner_id FROM products WHERE id = ?`. If `partner_id` does not match, request terminates immediately with `403 Forbidden`.
- **Order Isolation**: `sub_orders` are segregated per seller. A merchant only receives shipment and item records corresponding to their merchant ID.

## 4. Selbym Legal Boundary & Zero-Scraping Policy
Selbym (셀바임) integration follows strict compliance rules:
- **Endpoint**: `GET /api/v1/integrations/selbym/status`
- **Current Legal Status**: `AWAITING_COMMERCIAL_AGREEMENT`
- **Scraping Prohibition**: Unauthorized headless browsing or automated bot scraping is actively detected and blocked via Cloudflare WAF bot mitigation rules.
- **Approved Onboarding**: Any data exchange requires mutual commercial agreements and dedicated API tokens.

## 5. Security & Rate Limiting
- Public read rate limit: 120 req/minute per IP.
- Integration feed rate limit: 60 req/minute per API key.
- TLS 1.3 encryption enforced on all endpoints.
