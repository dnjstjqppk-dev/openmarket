# OLMOA Remaining External Blockers & Production Roadmap

## 1. Overview
All internal core commerce engine blockers identified during the audit have been 100% resolved and verified in Cloudflare production:
- Multi-attribute SKU option selection engine (PDP)
- Server-side price authority and zero-trust payload verification
- In-cart SKU option change modal and stock quantity ceilings
- Concurrency-safe atomic inventory decrement and immutable ledger
- IDOR access controls on order endpoints
- Zero fallback policy rejecting synthetic or mismatched SKUs

The remaining items are strictly external legal, commercial, and domain registration dependencies.

---

## 2. External Dependencies (Non-Technical Blockers)

### 1. Commercial PG Payment Gateway Contracts
- **Current State**: Integrated checkout flow simulates real payment confirmation, updates order states to `PAID`, splits sub-orders, and writes settlement records.
- **External Blocker**: Live credit card charge and automated settlement with banks require corporate business registration, e-commerce permit, and merchant underwriting with PG providers (Toss Payments, KG Inicis, KakaoPay).
- **Activation Action**: Inject production API secret keys and webhook signature secrets once merchant underwriting is approved.

### 2. Live Customs Clearance (UNI-PASS) & Carrier APIs
- **Current State**: Tracking number binding and shipping state transitions operate smoothly across partner and buyer views.
- **External Blocker**: Live automated personal customs code validation via Korea Customs Service (UNI-PASS) and live GPS milestone updates from carriers (CJ Logistics, EMS) require commercial API credentials.
- **Activation Action**: Connect official B2B logistics Webhooks upon contract signing.

### 3. Custom Domain (olmoa.com) Binding
- **Current State**: Fully functional across `openmarket.dnjstjqppk.workers.dev`, `olmoa-storefront.dnjstjqppk.workers.dev`, and `olmoa-api.dnjstjqppk.workers.dev`.
- **External Blocker**: Purchase of `olmoa.com` domain.
- **Activation Action**: Add custom domain route mappings in Cloudflare Dashboard.
