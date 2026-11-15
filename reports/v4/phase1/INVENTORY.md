# PHASE 1 — 화면·API 전수 인벤토리 (자동 생성)

생성: 2026-11-15T06:30:03.884Z · 생성기: `tests/audit/phase1_inventory.mjs`

API 판정은 각 화면 역할의 토큰으로 개발 시드 게이트웨이에 실제 요청한 결과입니다. `MISSING_ROUTE` = 화면이 존재하지 않는 API를 호출.
**합계** 화면 70 · API 호출 184 · 없는 경로 0 · 서버 오류 1 · 핸들러 없는 버튼 13 · 의심 패턴 화면 6


## storefront

라우터 가드: 없음 · 라우트에 연결되지 않은 화면: MyLayout

| URL | 화면 | 줄 | API(존재/누락/5xx) | 핸들러 없는 버튼 | 로딩·오류·빈 | 반응형 클래스 | 영문 문구 | 의심 패턴 |
|---|---|---:|---|---:|---|---:|---:|---|
| / | HomeView | 255 | 5/0/0 | 0/1 | LE0 | 35 | 0 |  |
| /categories | CategoriesView | 86 | 0/0/0 | 0/0 | LE0 | 12 | 0 | English trust claim×1 |
| /category/:slug | CategoryView | 35 | 0/0/0 | 0/0 | --0 | 2 | 0 |  |
| /product/:slug | ProductDetailView | 315 | 3/0/0 | 0/1 | LE0 | 8 | 0 |  |
| /cart | CartView | 243 | 2/0/0 | 0/0 | -E0 | 11 | 0 |  |
| /checkout | CheckoutView | 544 | 8/0/0 | 0/0 | LE0 | 12 | 0 |  |
| /my | MyHomeView | 144 | 4/0/0 | 0/0 | LE0 | 1 | 0 |  |
| /my/reviews | MyReviewsView | 127 | 2/0/0 | 0/0 | LE0 | 0 | 0 |  |
| /my/qna | MyQnaView | 93 | 1/0/0 | 0/0 | LE0 | 0 | 0 |  |
| /my/recent | RecentlyViewedView | 107 | 2/0/0 | 0/2 | LE0 | 0 | 0 |  |
| /my/credits | CreditsView | 77 | 1/0/0 | 0/0 | LE0 | 0 | 0 |  |
| /my/stores | FollowedStoresView | 111 | 2/0/0 | 0/2 | LE0 | 0 | 0 |  |
| /my/settings | ProfileView | 418 | 4/0/0 | 1/8 | LE0 | 2 | 0 | fake default input×1 |
| /orders | OrdersView | 454 | 3/0/0 | 0/13 | LE0 | 7 | 0 |  |
| /orders/:id | OrderDetailView | 864 | 15/0/0 | 1/28 | LE0 | 13 | 0 |  |
| /search | SearchView | 34 | 0/0/0 | 0/0 | --0 | 2 | 0 |  |
| /login | LoginView | 205 | 2/0/1 | 0/2 | LE0 | 0 | 0 |  |
| /forgot-password | ForgotPasswordView | 133 | 2/0/0 | 0/0 | LE0 | 0 | 0 |  |
| /verify-email | VerifyEmailView | 94 | 2/0/0 | 0/0 | LE0 | 0 | 0 |  |
| /register | RegisterView | 141 | 1/0/0 | 0/0 | LE0 | 0 | 0 |  |
| /channel/lightning-deals | LightningDealsView | 82 | 1/0/0 | 0/0 | LE0 | 11 | 0 |  |
| /channel/best-sellers | BestSellersView | 81 | 1/0/0 | 0/0 | LE0 | 7 | 0 |  |
| /coupons | CouponsView | 182 | 3/0/0 | 0/2 | LE0 | 3 | 0 |  |
| /addresses | AddressesView | 379 | 3/0/0 | 0/8 | LE0 | 3 | 0 |  |
| /wishlist | WishlistView | 100 | 1/0/0 | 0/0 | LE0 | 7 | 0 |  |
| /store/:id | SellerStoreView | 317 | 3/0/0 | 1/1 | LE0 | 20 | 0 |  |
| /support | SupportView | 183 | 2/0/0 | 0/2 | -E0 | 9 | 0 |  |
| /policy/:type | PolicyView | 115 | 1/0/0 | 0/0 | LE0 | 3 | 0 | guarantee claim×1 |
| /legal/terms | LegalTermsView | 92 | 1/0/0 | 0/0 | -E- | 3 | 1 | guarantee claim×2 |
| /legal/privacy | LegalPrivacyView | 84 | 0/0/0 | 0/0 | --- | 3 | 1 |  |
| /payments/success | PaymentResultView | 251 | 3/0/0 | 0/0 | LE- | 1 | 0 |  |
| /payments/fail | PaymentResultView | 251 | 3/0/0 | 0/0 | LE- | 1 | 0 |  |
| /legal/refund | LegalRefundView | 63 | 0/0/0 | 0/0 | --- | 3 | 0 |  |
| /:pathMatch(.*)* | NotFoundView | 28 | 0/0/0 | 0/0 | --0 | 0 | 0 |  |
| /profile | → /my/settings | | | | | | | |

### storefront: 동작하지 않는 API 호출

| 화면 | 메서드 | 호출 | 판정 | 응답 |
|---|---|---|---|---|
| /login | GET | `${API_BASE_URL}/api/v1/auth/social/kakao/start?state=${state}` | SERVER_ERROR | 501 SOCIAL_LOGIN_NOT_INTEGRATED |

## admin

라우터 가드: 없음 · 라우트에 연결되지 않은 화면: 없음

| URL | 화면 | 줄 | API(존재/누락/5xx) | 핸들러 없는 버튼 | 로딩·오류·빈 | 반응형 클래스 | 영문 문구 | 의심 패턴 |
|---|---|---:|---|---:|---|---:|---:|---|
| /login | LoginView | 83 | 1/0/0 | 0/3 | LE0 | 0 | 2 |  |
| / | DashboardView | 497 | 11/0/0 | 0/6 | LE0 | 9 | 1 |  |
| /products | ProductManageView | 165 | 3/0/0 | 0/5 | LE0 | 0 | 0 |  |
| /partners | PartnerVerifyView | 295 | 3/0/0 | 0/6 | LE- | 0 | 1 |  |
| /ledger | LedgerAuditView | 264 | 4/0/0 | 0/4 | LE0 | 0 | 24 |  |
| /orders | OrdersView | 197 | 2/0/0 | 0/3 | LE0 | 0 | 0 |  |
| /users | UsersView | 171 | 2/0/0 | 0/5 | LE0 | 0 | 0 |  |
| /reviews | ReviewsView | 128 | 2/0/0 | 0/6 | LE0 | 0 | 0 |  |
| /coupons | CouponsView | 176 | 2/0/0 | 0/2 | LE0 | 1 | 0 |  |
| /categories | CategoriesView | 136 | 2/0/0 | 0/2 | LE0 | 1 | 1 |  |
| /marketing | MarketingView | 500 | 4/0/0 | 0/11 | LE- | 9 | 5 |  |
| /business | BusinessEntitiesView | 129 | 4/0/0 | 1/4 | LE0 | 7 | 0 |  |
| /suppliers | SuppliersView | 327 | 10/0/0 | 2/11 | -E0 | 4 | 0 |  |
| /supplier-integrations | SupplierIntegrationView | 959 | 9/0/0 | 0/17 | LE0 | 22 | 2 |  |
| /reconciliation | ReconciliationView | 138 | 6/0/0 | 0/4 | LE0 | 1 | 0 |  |
| /partner-applications | PartnerApplicationsView | 138 | 3/0/0 | 1/5 | LE0 | 1 | 0 |  |
| /security | SecurityView | 140 | 6/0/0 | 1/5 | -E- | 4 | 0 |  |
| /audit-log | AuditLogView | 95 | 1/0/0 | 1/3 | LE0 | 2 | 0 |  |
| /inquiries | InquiriesView | 165 | 2/0/0 | 2/8 | LE0 | 0 | 0 |  |
| /shipping-zones | ShippingZonesView | 141 | 2/0/0 | 0/3 | LE0 | 1 | 0 |  |
| /:pathMatch(.*)* | NotFoundView | 27 | 0/0/0 | 0/0 | --0 | 0 | 0 |  |

## partner

라우터 가드: 있음 · 라우트에 연결되지 않은 화면: 없음

| URL | 화면 | 줄 | API(존재/누락/5xx) | 핸들러 없는 버튼 | 로딩·오류·빈 | 반응형 클래스 | 영문 문구 | 의심 패턴 |
|---|---|---:|---|---:|---|---:|---:|---|
| /login | LoginView | 92 | 1/0/0 | 0/3 | LE0 | 0 | 0 |  |
| /apply | ApplyView | 162 | 2/0/0 | 0/2 | LE0 | 10 | 0 |  |
| /application | ApplicationView | 139 | 5/0/0 | 1/3 | -E0 | 0 | 0 |  |
| / | DashboardView | 269 | 0/0/0 | 0/0 | LE0 | 5 | 0 | guarantee claim×1 |
| /products | ProductManageView | 748 | 6/0/0 | 0/16 | LE0 | 4 | 0 |  |
| /bidding | BiddingView | 410 | 5/0/0 | 0/13 | LE0 | 4 | 1 |  |
| /bulk-upload | BulkUploadView | 221 | 2/0/0 | 0/3 | LE0 | 0 | 10 |  |
| /imports | UrlImportView | 1018 | 0/0/0 | 0/12 | LE0 | 17 | 1 | guarantee claim×1 |
| /channels | MultiChannelListingView | 934 | 0/0/0 | 0/21 | LE0 | 13 | 3 |  |
| /shipments | ShipmentView | 789 | 0/0/0 | 1/23 | LE0 | 9 | 0 |  |
| /returns | ReturnsManageView | 455 | 0/0/0 | 0/12 | LE0 | 7 | 0 |  |
| /settlements | SettlementView | 301 | 2/0/0 | 0/2 | LE0 | 1 | 0 |  |
| /qna | QnaManageView | 256 | 0/0/0 | 0/8 | LE0 | 4 | 0 |  |
| /profile | ProfileManageView | 357 | 0/0/0 | 0/2 | LE0 | 8 | 0 |  |
| /:pathMatch(.*)* | NotFoundView | 27 | 0/0/0 | 0/0 | --0 | 0 | 0 |  |
