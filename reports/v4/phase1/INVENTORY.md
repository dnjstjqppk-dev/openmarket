# PHASE 1 — 화면·API 전수 인벤토리 (자동 생성)

생성: 2026-11-05T06:41:15.895Z · 생성기: `tests/audit/phase1_inventory.mjs`

API 판정은 각 화면 역할의 토큰으로 개발 시드 게이트웨이에 실제 요청한 결과입니다. `MISSING_ROUTE` = 화면이 존재하지 않는 API를 호출.
**합계** 화면 57 · API 호출 146 · 없는 경로 6 · 서버 오류 0 · 핸들러 없는 버튼 9 · 의심 패턴 화면 15


## storefront

라우터 가드: 없음 · 라우트에 연결되지 않은 화면: 없음

| URL | 화면 | 줄 | API(존재/누락/5xx) | 핸들러 없는 버튼 | 로딩·오류·빈 | 반응형 클래스 | 영문 문구 | 의심 패턴 |
|---|---|---:|---|---:|---|---:|---:|---|
| / | HomeView | 383 | 4/0/0 | 0/6 | LE- | 23 | 7 | English trust claim×1 |
| /categories | CategoriesView | 115 | 1/0/0 | 0/0 | LE0 | 9 | 1 | English trust claim×1 |
| /category/:slug | CategoryView | 129 | 2/0/0 | 0/0 | LE0 | 8 | 7 |  |
| /product/:slug | ProductDetailView | 757 | 5/0/0 | 0/21 | LE0 | 28 | 16 | English trust claim×7 |
| /cart | CartView | 259 | 1/0/0 | 0/4 | LE0 | 15 | 0 | live/realtime claim×1, guarantee claim×1 |
| /checkout | CheckoutView | 314 | 7/0/0 | 0/4 | -E0 | 11 | 0 |  |
| /profile | ProfileView | 507 | 4/0/0 | 1/8 | LE0 | 16 | 0 |  |
| /orders | OrdersView | 711 | 3/0/0 | 0/18 | LE0 | 18 | 0 |  |
| /orders/:id | OrderDetailView | 710 | 11/0/0 | 1/25 | LE0 | 13 | 0 |  |
| /search | SearchView | 181 | 1/0/0 | 0/6 | LE0 | 10 | 0 |  |
| /login | LoginView | 109 | 1/0/0 | 0/2 | LE0 | 0 | 0 |  |
| /forgot-password | ForgotPasswordView | 105 | 2/0/0 | 0/2 | LE- | 0 | 0 |  |
| /register | RegisterView | 133 | 1/0/0 | 0/1 | LE0 | 0 | 0 |  |
| /channel/lightning-deals | LightningDealsView | 119 | 1/0/0 | 0/0 | LE0 | 9 | 0 |  |
| /channel/best-sellers | BestSellersView | 78 | 1/0/0 | 0/0 | L-- | 8 | 2 | English trust claim×1 |
| /coupons | CouponsView | 117 | 3/0/0 | 0/1 | --- | 6 | 3 |  |
| /addresses | AddressesView | 349 | 3/0/0 | 0/7 | LE0 | 3 | 0 | fake default input×1 |
| /wishlist | WishlistView | 78 | 1/0/0 | 0/1 | L-0 | 4 | 3 |  |
| /store/:id | SellerStoreView | 94 | 1/0/0 | 0/0 | L-- | 8 | 4 | English trust claim×2 |
| /support | SupportView | 121 | 2/0/0 | 0/1 | --0 | 7 | 11 |  |
| /policy/:type | PolicyView | 92 | 0/0/0 | 0/0 | --- | 5 | 0 | guarantee claim×1 |
| /legal/terms | LegalTermsView | 47 | 0/0/0 | 0/0 | --- | 2 | 1 | guarantee claim×1 |
| /legal/privacy | LegalPrivacyView | 50 | 0/0/0 | 0/0 | --- | 2 | 1 |  |
| /payments/success | PaymentResultView | 74 | 1/0/0 | 0/2 | -E- | 0 | 0 |  |
| /payments/fail | PaymentResultView | 74 | 1/0/0 | 0/2 | -E- | 0 | 0 |  |
| /legal/refund | LegalRefundView | 36 | 0/0/0 | 0/0 | --- | 2 | 0 |  |

## admin

라우터 가드: 없음 · 라우트에 연결되지 않은 화면: 없음

| URL | 화면 | 줄 | API(존재/누락/5xx) | 핸들러 없는 버튼 | 로딩·오류·빈 | 반응형 클래스 | 영문 문구 | 의심 패턴 |
|---|---|---:|---|---:|---|---:|---:|---|
| /login | LoginView | 80 | 1/0/0 | 0/3 | LE0 | 0 | 2 |  |
| / | DashboardView | 426 | 10/0/0 | 0/5 | LE0 | 9 | 1 |  |
| /products | ProductManageView | 139 | 3/0/0 | 0/5 | LE0 | 0 | 0 |  |
| /partners | PartnerVerifyView | 181 | 2/0/0 | 0/3 | LE- | 0 | 1 |  |
| /ledger | LedgerAuditView | 223 | 4/0/0 | 0/2 | LE0 | 0 | 25 |  |
| /orders | OrdersView | 124 | 1/0/0 | 0/1 | LE0 | 0 | 0 |  |
| /users | UsersView | 100 | 1/0/0 | 0/1 | LE0 | 0 | 0 |  |
| /reviews | ReviewsView | 97 | 2/0/0 | 0/2 | LE0 | 0 | 0 |  |
| /coupons | CouponsView | 135 | 2/0/0 | 0/2 | LE0 | 1 | 0 |  |
| /categories | CategoriesView | 120 | 2/0/0 | 0/2 | LE0 | 1 | 1 |  |
| /marketing | MarketingView | 454 | 3/0/0 | 0/10 | LE- | 9 | 5 |  |
| /business | BusinessEntitiesView | 109 | 4/0/0 | 1/3 | LE0 | 7 | 0 |  |
| /suppliers | SuppliersView | 283 | 7/3/0 | 2/11 | -E0 | 4 | 0 |  |
| /supplier-integrations | SupplierIntegrationView | 934 | 9/0/0 | 0/17 | LE0 | 22 | 2 | numeric fallback (|| N)×1 |
| /reconciliation | ReconciliationView | 118 | 6/0/0 | 0/3 | LE0 | 1 | 0 |  |
| /partner-applications | PartnerApplicationsView | 114 | 3/0/0 | 1/5 | LE0 | 1 | 0 |  |
| /security | SecurityView | 127 | 6/0/0 | 1/5 | -E- | 4 | 0 |  |

### admin: 동작하지 않는 API 호출

| 화면 | 메서드 | 호출 | 판정 | 응답 |
|---|---|---|---|---|
| /suppliers | GET | `/api/v1/admin/bidding/campaigns` | MISSING_ROUTE | 404  |
| /suppliers | POST | `/api/v1/admin/bidding/campaigns` | MISSING_ROUTE | 404  |
| /suppliers | GET | `/api/v1/admin/bidding/campaigns/${campaignId}/bids` | MISSING_ROUTE | 404  |

## partner

라우터 가드: 있음 · 라우트에 연결되지 않은 화면: 없음

| URL | 화면 | 줄 | API(존재/누락/5xx) | 핸들러 없는 버튼 | 로딩·오류·빈 | 반응형 클래스 | 영문 문구 | 의심 패턴 |
|---|---|---:|---|---:|---|---:|---:|---|
| /login | LoginView | 79 | 1/0/0 | 0/3 | LE0 | 0 | 0 |  |
| /apply | ApplyView | 161 | 2/0/0 | 0/2 | LE0 | 10 | 0 |  |
| /application | ApplicationView | 139 | 5/0/0 | 1/3 | -E0 | 0 | 0 |  |
| / | DashboardView | 245 | 0/0/0 | 0/0 | LE0 | 5 | 0 | guarantee claim×1 |
| /products | ProductManageView | 608 | 5/0/0 | 0/11 | LE0 | 4 | 0 | guarantee claim×2 |
| /bidding | BiddingView | 370 | 2/3/0 | 0/12 | LE0 | 4 | 1 | numeric fallback (|| N)×2 |
| /bulk-upload | BulkUploadView | 191 | 1/0/0 | 0/3 | LE0 | 0 | 10 |  |
| /imports | UrlImportView | 933 | 0/0/0 | 0/9 | LE0 | 17 | 1 | guarantee claim×1 |
| /channels | MultiChannelListingView | 610 | 0/0/0 | 0/11 | LE0 | 13 | 3 |  |
| /shipments | ShipmentView | 661 | 0/0/0 | 1/18 | LE0 | 9 | 0 |  |
| /returns | ReturnsManageView | 435 | 0/0/0 | 0/11 | LE0 | 7 | 0 |  |
| /settlements | SettlementView | 121 | 1/0/0 | 0/1 | LE- | 1 | 14 |  |
| /qna | QnaManageView | 241 | 0/0/0 | 0/7 | LE0 | 4 | 0 |  |
| /profile | ProfileManageView | 286 | 0/0/0 | 0/1 | LE- | 7 | 0 |  |

### partner: 동작하지 않는 API 호출

| 화면 | 메서드 | 호출 | 판정 | 응답 |
|---|---|---|---|---|
| /bidding | GET | `${API_BASE_URL}/api/v1/bidding/my-bids` | MISSING_ROUTE | 404  |
| /bidding | GET | `${API_BASE_URL}/api/v1/bidding/negotiations` | MISSING_ROUTE | 404  |
| /bidding | GET | `${API_BASE_URL}/api/v1/bidding/negotiations/${selectedNego.value.id}/respond` | MISSING_ROUTE | 404  |
