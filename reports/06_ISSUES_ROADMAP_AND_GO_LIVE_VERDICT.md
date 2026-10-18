# OLMOA Commercialization Audit: Chapter 6 — Issue Register, Roadmap & Go-Live Verdict

## 19. Full P0–P3 Issue Register Summary
A total of 15 prioritized engineering issues have been cataloged in [P0_P3_ISSUE_REGISTER.csv](file:///c:/Users/dnjst/Desktop/openmarket/reports/P0_P3_ISSUE_REGISTER.csv):
- **P0 Severity (7 Items - Launch Blocking)**:
  1. `ISSUE-01`: Header search autocomplete dropdown UI missing.
  2. `ISSUE-02`: PDP static `4.9` rating and missing review list UI.
  3. `ISSUE-03`: Customer order cancellation button missing in `OrdersView.vue`.
  4. `ISSUE-04`: 90-day return & price match claim buttons missing in `OrderDetailView.vue`.
  5. `ISSUE-05`: Partner CSV bulk upload is a non-functional `setTimeout` mock (142 count).
  6. `ISSUE-06`: Partner settlement view is a hardcoded mock array (48.2M KRW).
  7. `ISSUE-07`: Footer terms, privacy, and support links are `href="#"` dead links.
- **P1 Severity (4 Items - Major UX/Operational)**:
  1. `ISSUE-08`: Subheader lacks Temu-style Mega Menu flyout on hover.
  2. `ISSUE-09`: Missing Lightning Deals and Best Sellers promotional channel views.
  3. `ISSUE-10`: Currency switcher does not recalculate displayed prices.
  4. `ISSUE-11`: Flutter mobile app targets obsolete `openmarket-api` endpoint.
- **P2 Severity (3 Items - Usability/Polish)**:
  1. `ISSUE-12`: Missing coupon discount and credit toggle on checkout view.
  2. `ISSUE-13`: PDP lacks multi-thumbnail image carousel.
  3. `ISSUE-14`: PDP lacks sticky floating purchase bar on mobile viewports.
- **P3 Severity (1 Item - Long-Term Optimization)**:
  1. `ISSUE-15`: `sitemap.xml` lists only 3 legacy categories.

## 20. New Development Requirements Summary
1. **Front-End Autocomplete Component (`SearchAutocomplete.vue`)**: Mount 180ms debounce search with recent & trending tabs.
2. **Real CSV Upload Engine (`apps/partner`)**: Client-side CSV parser transmitting batch rows to `POST /api/v1/partner/products/bulk`.
3. **Partner Settlement Aggregator (`apps/partner`)**: Live fetch to D1 `settlements` table.
4. **Customer Claims Engine (`apps/storefront`)**: Return and 30-day price match claim modal forms writing to D1 `returns`.
5. **Policy & FAQ Pages**: Real content views for `/support` and `/policy/:type`.

## 21. Phased Development Execution Plan
See [COMMERCIALIZATION_ROADMAP.md](file:///c:/Users/dnjst/Desktop/openmarket/reports/COMMERCIALIZATION_ROADMAP.md) for full gantt chart and dependencies:
- **Phase 1 (Week 1)**: Eliminate all 7 P0 blockers (zero mock data, real reviews, real uploads, real policies).
- **Phase 2 (Week 2)**: Core promotional channels, Mega Menu flyout, mobile app sync, claims UI.
- **Phase 3 (Week 3)**: PDP multi-image gallery, mobile sticky CTA bar, Core Web Vitals optimization.
- **Phase 4 (Week 4)**: Bind `olmoa.com` custom domain, SSL HSTS, Cloudflare WAF bot fight mode.
- **Phase 5 (Week 5)**: Final E2E regression, load testing, executive Go-Live sign-off.

## 22. Release Gate Verification Matrix
15 commercial gates evaluated in [GO_LIVE_CHECKLIST.md](file:///c:/Users/dnjst/Desktop/openmarket/reports/GO_LIVE_CHECKLIST.md):
- **PASS**: G01 (E2E Core Scenarios), G04 (D1 Database Binding), G05 (Server Authentication), G07 (Automated Deployments), G09 (SPA Deep Linking), G13 (Commit/Server Parity), G14 (D1 Disaster Recovery), G15 (Documentation).
- **FAIL**: G02 (Zero P0s), G03 (Zero P1s), G11 (Partner Management Readiness), G12 (Legal Compliance Notices).
- **PARTIAL**: G06 (Mobile Responsive Parity), G10 (Error Monitoring & Sentry Alerting).
- **BLOCKED**: G08 (Custom Domain `olmoa.com` Pending DNS Binding).

## 23. Official Launch Verdict: CONDITIONAL GO
- **Staging / Alpha Verdict**: **GO (Fully functional on `*.workers.dev` with 20/20 automated E2E tests passing).**
- **Public Commercial Launch Verdict**: **NO-GO (Launch blocked until Phase 1 P0 items are closed and `olmoa.com` is bound).**

## 24. Final Pre-Launch Mandatory Checklist
- [ ] Implement `SearchAutocomplete.vue` and wire into `App.vue` and `SearchView.vue`.
- [ ] Connect `ProductDetailView.vue` to `/api/v1/products/:id/reviews` and remove static `4.9`.
- [ ] Add [주문 취소] button in `OrdersView.vue` and `OrderDetailView.vue`.
- [ ] Replace `setTimeout` mock in `BulkUploadView.vue` with real CSV batch processing.
- [ ] Wire `SettlementView.vue` to live D1 `settlements` table.
- [ ] Replace 8 `href="#"` footer links with functional legal views.
- [ ] Bind `olmoa.com` custom domain in Cloudflare Workers and verify SSL TLS 1.3.
- [ ] Re-run `node tests/full_platform_e2e.js` and verify 100% pass before opening public access.
