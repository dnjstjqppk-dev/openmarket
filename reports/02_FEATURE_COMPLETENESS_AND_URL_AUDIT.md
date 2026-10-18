# OLMOA Commercialization Audit: Chapter 2 — Feature Completeness & URL Audit

## 4. Current Feature Implementation Table

| Feature Domain | Target Requirement | Implementation State | Verification Evidence & File Reference |
| :--- | :--- | :---: | :--- |
| **Catalog & Taxonomy** | 43 Roots & 152 Subcategories | **VERIFIED** | D1 `categories` table loaded dynamically in `HomeView.vue` and `catalog.js` |
| **Search Autocomplete** | Live suggestions & previews | **PARTIAL** | Gateway `/api/v1/search/autocomplete` ready; `SearchAutocomplete.vue` unmounted |
| **PDP SKU Matrix** | Multi-attribute options & stock | **VERIFIED** | `ProductDetailView.vue` dynamically resolves SKUs and enforces inventory ceiling |
| **PDP Reviews** | Real ratings & buyer photos | **PARTIAL** | D1 `product_reviews` and API ready; PDP currently displays static `4.9` |
| **Cart Experience** | In-cart option modal & threshold | **VERIFIED** | `CartView.vue` option switcher and 30,000 KRW free-shipping bar operational |
| **Checkout Flow** | Server price authority & sandbox | **VERIFIED** | `orders.js` calculates totals strictly from D1; ignores client price overrides |
| **Order Restocking** | Cancel order & auto restock | **PARTIAL** | Gateway `POST /orders/:id/cancel` works; `OrdersView.vue` lacks cancel button |
| **Customer Claims** | 90-day returns & price match | **UNIMPLEMENTED**| D1 `returns` table ready; `OrderDetailView.vue` lacks claim action buttons |
| **Partner Isolation** | Multi-tenant tenant scoping | **VERIFIED** | `partner.js` returns 403 on mismatched `partner_id` across products and shipments |
| **Partner Bulk Upload**| CSV/Excel SKU bulk creation | **MOCK_ONLY** | `BulkUploadView.vue` uses `setTimeout` with hardcoded `142` count; no API call |
| **Partner Settlements**| Real escrow calculation | **MOCK_ONLY** | `SettlementView.vue` renders hardcoded 48.2M KRW mock array; no API call |
| **Admin Governance** | Catalog status & ledger audit | **VERIFIED** | `apps/admin` views manage D1 products and inspect `inventory_ledger` |
| **External Integration**| PriceScanner feed & Selbym | **VERIFIED** | `integrations.js` provides authenticated feed with 60s cache; OpenAPI doc ready |

## 5. Mandatory Missing Features & Gap Analysis (vs. Temu.com)
1. **Promotional Channels Gap**: Temu relies heavily on `/channel/lightning-deals` with real-time countdown timers, progress bars, and `/channel/best-sellers` rankings. OLMOA has D1 flash sale tables but lacks the frontend views.
2. **Customer Empowerment Gap**: Customers cannot cancel orders or request 30-day price match credit refunds from the UI without manual customer support intervention.
3. **Merchant Onboarding Gap**: Suppliers cannot upload Excel/CSV catalogs because `BulkUploadView.vue` is a non-functional mock.
4. **Legal Compliance Gap**: All 8 footer links are `href="#"`, preventing users from reading terms of service, privacy policy, and refund policies.

## 6. User, Admin & Partner Role Functionality Audit
- **Customer Role (`u_customer_001`)**: Can browse catalog, configure SKU options, add to cart, and checkout. Cannot self-cancel or submit return claims from UI.
- **Merchant Partner Role (`pt_001`)**: Can log in, review D1 metrics, edit individual SKU stock, and input shipping tracking numbers. Cannot execute batch CSV uploads or view real settlement ledgers.
- **Platform Admin Role (`u_admin_001`)**: Can log in with `ADMIN_SECRET`, monitor platform metrics, approve/suspend products, verify partners, and audit inventory ledger transactions.

## 7. Full URL & Routing Audit Summary
All 29 platform routes have been registered and audited (see [FULL_URL_AUDIT.csv](file:///c:/Users/dnjst/Desktop/openmarket/reports/FULL_URL_AUDIT.csv)):
- **SPA Deep Linking**: Cloudflare Pages/Worker asset configuration (`not_found_handling = "single-page-application"`) ensures direct URL accesses and browser refreshes on `/category/*`, `/product/*`, `/cart`, `/checkout`, `/orders` return `200 OK` without `404 Not Found` errors.
- **Missing Commercial Routes**: 5 promotional channel and customer account routes need to be added to `apps/storefront/src/router/index.ts` (`/channel/lightning-deals`, `/channel/best-sellers`, `/wishlist`, `/coupons`, `/support`).
