# PHASE 1 — 화면·API 전수 인벤토리 (자동 생성)

생성: 2026-11-27T02:45:39.880Z · 생성기: `tests/audit/phase1_inventory.mjs`

API 판정은 각 화면 역할의 토큰으로 개발 시드 게이트웨이에 실제 요청한 결과입니다. `MISSING_ROUTE` = 화면이 존재하지 않는 API를 호출.
**합계** 화면 97 · API 호출 291 · 없는 경로 1 · 서버 오류 1 · 핸들러 없는 버튼 12 · 의심 패턴 화면 9


## storefront

라우터 가드: 없음 · 라우트에 연결되지 않은 화면: MyLayout

| URL | 화면 | 줄 | API(존재/누락/5xx) | 핸들러 없는 버튼 | 로딩·오류·빈 | 반응형 클래스 | 영문 문구 | 의심 패턴 |
|---|---|---:|---|---:|---|---:|---:|---|
| / | HomeView | 289 | 5/0/0 | 0/1 | LE0 | 38 | 0 | guarantee claim×1 |
| /categories | CategoriesView | 86 | 0/0/0 | 0/0 | LE0 | 12 | 0 | English trust claim×1 |
| /c/:slug | CategoryView | 37 | 0/0/0 | 0/0 | --0 | 2 | 0 |  |
| /p/:slug/:seo? | ProductDetailView | 425 | 4/0/0 | 0/1 | LE0 | 8 | 0 |  |
| /cart | CartView | 243 | 2/0/0 | 0/0 | -E0 | 11 | 0 |  |
| /checkout | CheckoutView | 539 | 8/0/0 | 0/0 | LE0 | 12 | 0 |  |
| /my | MyHomeView | 144 | 4/0/0 | 0/0 | LE0 | 1 | 0 |  |
| /my/reviews | MyReviewsView | 127 | 2/0/0 | 0/0 | LE0 | 0 | 0 |  |
| /my/qna | MyQnaView | 94 | 1/0/0 | 0/0 | LE0 | 0 | 0 |  |
| /my/recent | RecentlyViewedView | 107 | 2/0/0 | 0/2 | LE0 | 0 | 0 |  |
| /my/credits | CreditsView | 77 | 1/0/0 | 0/0 | LE0 | 0 | 0 |  |
| /my/stores | FollowedStoresView | 111 | 2/0/0 | 0/2 | LE0 | 0 | 0 |  |
| /my/settings | ProfileView | 418 | 4/0/0 | 1/8 | LE0 | 2 | 0 | fake default input×1 |
| /orders | OrdersView | 456 | 3/0/0 | 0/13 | LE0 | 7 | 0 |  |
| /orders/:id | OrderDetailView | 850 | 15/0/0 | 1/27 | LE0 | 13 | 0 |  |
| /search | SearchView | 34 | 0/0/0 | 0/0 | --0 | 2 | 0 |  |
| /login | LoginView | 208 | 2/0/1 | 0/2 | LE0 | 0 | 0 |  |
| /forgot-password | ForgotPasswordView | 133 | 2/0/0 | 0/0 | LE0 | 0 | 0 |  |
| /verify-email | VerifyEmailView | 94 | 2/0/0 | 0/0 | LE0 | 0 | 0 |  |
| /register | RegisterView | 158 | 2/0/0 | 0/0 | LE0 | 0 | 0 |  |
| /channel/lightning-deals | LightningDealsView | 82 | 1/0/0 | 0/0 | LE0 | 11 | 0 |  |
| /channel/best-sellers | BestSellersView | 81 | 1/0/0 | 0/0 | LE0 | 7 | 0 |  |
| /coupons | CouponsView | 182 | 3/0/0 | 0/2 | LE0 | 3 | 0 |  |
| /addresses | AddressesView | 379 | 3/0/0 | 0/8 | LE0 | 3 | 0 |  |
| /wishlist | WishlistView | 100 | 1/0/0 | 0/0 | LE0 | 7 | 0 |  |
| /store/:id | SellerStoreView | 330 | 3/0/0 | 1/1 | LE0 | 20 | 0 |  |
| /support | SupportView | 203 | 2/0/0 | 0/2 | -E0 | 8 | 0 |  |
| /policy/:type | PolicyView | 100 | 1/0/0 | 0/0 | LE0 | 3 | 0 | guarantee claim×1 |
| /legal/terms | LegalTermsView | 154 | 2/0/0 | 0/4 | LE- | 3 | 1 |  |
| /legal/privacy | LegalPrivacyView | 146 | 1/0/0 | 0/4 | LE- | 3 | 1 |  |
| /payments/success | PaymentResultView | 242 | 3/0/0 | 0/0 | LE- | 1 | 0 |  |
| /payments/fail | PaymentResultView | 242 | 3/0/0 | 0/0 | LE- | 1 | 0 |  |
| /legal/refund | LegalRefundView | 130 | 1/0/0 | 0/4 | LE- | 3 | 0 |  |
| /:pathMatch(.*)* | NotFoundView | 30 | 0/0/0 | 0/0 | --0 | 0 | 0 |  |

### storefront: 동작하지 않는 API 호출

| 화면 | 메서드 | 호출 | 판정 | 응답 |
|---|---|---|---|---|
| /login | GET | `${API_BASE_URL}/api/v1/auth/social/kakao/start?state=${state}` | SERVER_ERROR | 501 SOCIAL_LOGIN_NOT_INTEGRATED |

## admin

라우터 가드: 없음 · 라우트에 연결되지 않은 화면: 없음

| URL | 화면 | 줄 | API(존재/누락/5xx) | 핸들러 없는 버튼 | 로딩·오류·빈 | 반응형 클래스 | 영문 문구 | 의심 패턴 |
|---|---|---:|---|---:|---|---:|---:|---|
| /login | LoginView | 82 | 1/0/0 | 0/3 | LE0 | 0 | 2 |  |
| / | DashboardView | 417 | 5/0/0 | 0/15 | LE0 | 19 | 0 |  |
| /products | ProductListView | 236 | 4/0/0 | 0/4 | LE0 | 0 | 0 |  |
| /products/review-queue | ReviewQueueView | 179 | 2/0/0 | 0/6 | LE0 | 0 | 0 |  |
| /partners | PartnerListView | 96 | 1/0/0 | 0/1 | LE0 | 0 | 0 |  |
| /partners/:id | PartnerDetailView | 257 | 4/0/0 | 0/10 | LE0 | 1 | 0 |  |
| /partners/penalties-grades | PenaltyGradeView | 349 | 9/0/0 | 0/16 | LE0 | 2 | 0 |  |
| /ledger | LedgerAuditView | 191 | 2/0/0 | 0/2 | LE0 | 0 | 16 |  |
| /orders | OrderListView | 147 | 1/0/0 | 0/3 | LE0 | 0 | 0 |  |
| /orders/:id | OrderDetailView | 180 | 2/0/0 | 0/3 | LE0 | 2 | 0 |  |
| /claims | ClaimListView | 242 | 2/0/0 | 0/9 | LE0 | 0 | 0 |  |
| /users | UsersView | 230 | 2/0/0 | 0/8 | LE0 | 0 | 0 |  |
| /reviews | ReviewsView | 162 | 4/0/0 | 0/9 | LE0 | 0 | 0 |  |
| /coupons | CouponsView | 236 | 4/0/0 | 0/6 | LE0 | 3 | 0 |  |
| /categories | CategoriesView | 306 | 5/0/0 | 0/10 | LE0 | 5 | 1 |  |
| /marketing/banners | BannerView | 209 | 4/0/0 | 0/9 | LE0 | 5 | 0 |  |
| /marketing/exhibitions | ExhibitionView | 158 | 3/0/0 | 0/6 | LE0 | 5 | 0 |  |
| /marketing/flash-sales | FlashSaleView | 218 | 4/0/0 | 0/9 | LE0 | 2 | 0 |  |
| /marketing/notifications | NotificationSendView | 175 | 3/0/0 | 0/3 | LE0 | 5 | 0 |  |
| /business | BusinessEntitiesView | 129 | 4/0/0 | 1/4 | LE0 | 7 | 0 |  |
| /suppliers | SuppliersView | 363 | 10/0/0 | 2/13 | -E0 | 4 | 0 |  |
| /supplier-integrations | SupplierIntegrationView | 956 | 9/0/0 | 0/17 | LE0 | 22 | 2 |  |
| /reconciliation | ReconciliationView | 91 | 3/0/0 | 0/2 | LE- | 1 | 0 |  |
| /finance/batches | SettlementBatchView | 172 | 3/0/0 | 0/5 | LE0 | 0 | 0 |  |
| /finance/payout-requests | PayoutApprovalView | 200 | 2/0/0 | 0/8 | LE0 | 0 | 0 |  |
| /finance/policies | PolicyView | 210 | 4/0/0 | 0/7 | LE0 | 1 | 0 |  |
| /finance/fx-rates | FxRatesView | 225 | 1/1/0 | 0/0 | LE- | 2 | 0 |  |
| /partner-applications | ApplicationListView | 118 | 1/0/0 | 0/2 | LE0 | 0 | 0 |  |
| /partner-applications/:id | ApplicationDetailView | 210 | 4/0/0 | 0/6 | LE0 | 4 | 0 |  |
| /security | SecurityView | 140 | 6/0/0 | 1/5 | -E- | 4 | 0 |  |
| /audit-log | AuditLogView | 124 | 1/0/0 | 1/4 | LE0 | 2 | 0 |  |
| /inquiries | InquiriesView | 219 | 4/0/0 | 2/9 | LE0 | 0 | 0 |  |
| /faqs | FaqView | 223 | 4/0/0 | 0/9 | LE0 | 1 | 0 |  |
| /shipping-zones | ShippingZonesView | 141 | 2/0/0 | 0/3 | LE0 | 1 | 0 |  |
| /shipping/badges | ShipBadgePolicyView | 293 | 5/0/0 | 1/12 | LE0 | 1 | 0 |  |
| /legal-documents | LegalDocumentsView | 286 | 2/0/0 | 0/7 | LE0 | 1 | 0 |  |
| /:pathMatch(.*)* | NotFoundView | 27 | 0/0/0 | 0/0 | --0 | 0 | 0 |  |
| /marketing | → /marketing/banners | | | | | | | |

### admin: 동작하지 않는 API 호출

| 화면 | 메서드 | 호출 | 판정 | 응답 |
|---|---|---|---|---|
| /finance/fx-rates | GET | `${API_BASE_URL}/api/v1/admin/fx-rates/${code}` | MISSING_ROUTE | 404  |

## partner

라우터 가드: 있음 · 라우트에 연결되지 않은 화면: 없음

| URL | 화면 | 줄 | API(존재/누락/5xx) | 핸들러 없는 버튼 | 로딩·오류·빈 | 반응형 클래스 | 영문 문구 | 의심 패턴 |
|---|---|---:|---|---:|---|---:|---:|---|
| /login | LoginView | 93 | 1/0/0 | 0/3 | LE0 | 0 | 0 |  |
| /apply | ApplyView | 181 | 2/0/0 | 0/2 | LE0 | 11 | 0 |  |
| /application | ApplicationView | 148 | 5/0/0 | 1/3 | -E0 | 0 | 0 |  |
| / | DashboardView | 239 | 6/0/0 | 0/6 | LE0 | 6 | 0 | guarantee claim×1 |
| /products | ProductListView | 470 | 5/0/0 | 0/17 | LE0 | 3 | 0 |  |
| /products/new | ProductEditView | 413 | 5/0/0 | 0/7 | LE0 | 13 | 0 |  |
| /products/:id/edit | ProductEditView | 413 | 5/0/0 | 0/7 | LE0 | 13 | 0 |  |
| /bidding | BiddingView | 410 | 5/0/0 | 0/13 | LE0 | 4 | 1 |  |
| /bulk-upload | BulkUploadView | 251 | 3/0/0 | 0/3 | LE0 | 0 | 10 |  |
| /imports | UrlImportView | 1101 | 0/0/0 | 0/12 | LE0 | 19 | 0 | guarantee claim×1 |
| /channels | MultiChannelListingView | 949 | 0/0/0 | 0/21 | LE0 | 13 | 2 |  |
| /promotions/coupons | CouponListView | 173 | 2/0/0 | 0/5 | LE0 | 2 | 0 | guarantee claim×1 |
| /promotions/flash-sales | FlashSaleApplyView | 153 | 3/0/0 | 0/4 | LE0 | 0 | 0 |  |
| /promotions/exhibitions | ExhibitionApplyView | 87 | 2/0/0 | 0/1 | LE0 | 0 | 0 |  |
| /shipments | ShipmentView | 385 | 7/0/0 | 0/15 | LE0 | 3 | 0 |  |
| /claims/cancel | CancelListView | 118 | 1/0/0 | 0/2 | LE0 | 3 | 0 |  |
| /claims/return | ReturnListView | 280 | 4/0/0 | 0/14 | LE0 | 0 | 0 |  |
| /claims/exchange | ExchangeListView | 217 | 3/0/0 | 0/10 | LE0 | 0 | 0 |  |
| /settlements | SettlementOverviewView | 266 | 5/0/0 | 0/4 | LE0 | 3 | 0 | English trust claim×3 |
| /settlements/deposits | WithdrawableDepositsView | 126 | 3/0/0 | 0/2 | LE0 | 0 | 0 | English trust claim×3 |
| /qna | QnaManageView | 214 | 0/0/0 | 0/8 | LE0 | 1 | 0 |  |
| /reviews | ReviewManageView | 222 | 3/0/0 | 0/8 | LE0 | 0 | 0 |  |
| /profile | ProfileManageView | 270 | 0/0/0 | 0/2 | LE0 | 8 | 0 |  |
| /store-profile | StoreProfileView | 173 | 3/0/0 | 0/3 | LE0 | 2 | 0 |  |
| /store/shipping-policies | ShippingPolicyView | 238 | 3/0/0 | 0/6 | LE0 | 4 | 0 |  |
| /:pathMatch(.*)* | NotFoundView | 27 | 0/0/0 | 0/0 | --0 | 0 | 0 |  |
| /returns | → /claims/return | | | | | | | |

### partner: 동작하지 않는 API 호출

| 화면 | 메서드 | 호출 | 판정 | 응답 |
|---|---|---|---|---|
| components/product-form/ProductTranslationsEditor.vue | GET | `${API_BASE_URL}/api/v1/partner/products/${encodeURIComponent(props.productId)}/translations/${lang}` | MISSING_ROUTE | 404  |
