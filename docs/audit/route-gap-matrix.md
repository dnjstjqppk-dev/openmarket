# OLMOA vs Temu Route Gap Analysis Matrix

## 1. 개요 및 분석 기준
본 문서는 Temu의 공개 웹 사이트맵, 고객 쇼핑 여정 및 판매자센터의 핵심 라우팅 구조와 OLMOA의 현재 구현 상태를 1:1로 대조한 감사 매트릭스다.

- **VERIFIED**: 실제 백엔드(D1 SQL) 및 UI 컴포넌트가 바인딩되어 운영 환경에서 정상 동작 검증 완료.
- **PARTIAL**: 핵심 기능은 동작하나 고도화된 다국어/해외 통화 선택 옵션 등이 점진적 확장 대상인 상태.
- **MISSING**: 라우팅 또는 컴포넌트가 누락된 상태.

---

## 2. 라우트 대조 매트릭스

| 영역 | Temu 대응 경로 | OLMOA 경로 | 대응 컴포넌트 및 API | 구현 상태 | 검증 결과 |
|---|---|---|---|---|---|
| **메인** | `https://www.temu.com/` | `/` | `HomeView.vue`<br>`GET /api/v1/products` | **VERIFIED** | 프로모션 배너, 33개 카테고리 퀵링크, 실시간 핫딜 그리드 정상 렌더링 |
| **전체 카테고리** | `https://www.temu.com/ie/sitemap.html` | `/categories` | `CategoriesView.vue`<br>`GET /api/v1/categories` | **VERIFIED** | D1에 등록된 33개 대분류 및 하위 소분류 비주얼 트리 완전 로드 |
| **카테고리 상세** | `https://www.temu.com/category/{slug}` | `/category/:slug` | `CategoryView.vue`<br>`GET /api/v1/products?category=:slug` | **VERIFIED** | 10대/33대 카테고리별 실상품 및 소분류 칩, 정렬 쿼리 100% 작동 |
| **통합 검색** | `https://www.temu.com/search_result.html?search_key={q}` | `/search?q={q}` | `SearchView.vue`<br>`GET /api/v1/products?q={q}` | **VERIFIED** | 상품명/설명 Full-text 검색, 인기순/최신순/가격순 정렬 작동 |
| **상품 상세 (PDP)** | `https://www.temu.com/{slug}-g-{id}.html` | `/product/:id` | `ProductDetailView.vue`<br>`GET /api/v1/products/:id` | **VERIFIED** | 고해상도 썸네일, SKU 옵션 선택기, 수량 조절, 실시간 장바구니/바로구매 |
| **장바구니** | `https://www.temu.com/cart.html` | `/cart` | `CartView.vue`<br>`useCartStore` (Pinia + LocalStorage) | **VERIFIED** | 브라우저 새로고침 시에도 유지되는 영구 장바구니, 무료배송 계산기 |
| **체크아웃** | `https://www.temu.com/checkout.html` | `/checkout` | `CheckoutView.vue`<br>`POST /api/v1/orders/checkout` | **VERIFIED** | 수령인/주소 입력, 결제수단 선택, Split-Order 자동 분기 및 재고 감산 |
| **주문 내역** | `https://www.temu.com/bgo_order_list.html` | `/orders` | `OrdersView.vue`<br>`GET /api/v1/orders` | **VERIFIED** | D1 주문 테이블 기반 실시간 주문 내역, 판매자별 상태 및 운송장 표시 |
| **주문 상세** | `https://www.temu.com/order_detail.html?order_id={id}` | `/order/:id` | `OrderDetailView.vue`<br>`GET /api/v1/orders/:id` | **VERIFIED** | 단일 주문 및 하위 Sub-Order별 파트너사, 운송장번호, 배송상태 추적 |
| **판매자 대시보드** | `https://seller.temu.com/` | `https://olmoa-partner.../` | `DashboardView.vue`<br>`GET /api/v1/partner/metrics` | **VERIFIED** | 입점사 실시간 등록 상품 수, 인입 주문 건수, 누적 매출 실시간 집계 |
| **판매자 상품관리** | `https://seller.temu.com/main/product/list` | `/products` | `ProductManageView.vue`<br>`GET/PUT /api/v1/partner/products` | **VERIFIED** | D1 등록 상품 목록, SKU 재고 원자적 수정 및 D1 영구 반영 |
| **판매자 출고관리** | `https://seller.temu.com/main/order/list` | `/shipments` | `ShipmentView.vue`<br>`PUT /api/v1/partner/orders/:id/shipment` | **VERIFIED** | 인입된 Sub-Order에 택배사 및 운송장 번호 입력 시 '출고완료' 전이 |
| **관리자 대시보드** | `https://admin.temu.com/` (비공개) | `https://olmoa-admin.../` | `DashboardView.vue`<br>`GET /api/v1/admin/dashboard` | **VERIFIED** | 플랫폼 총 거래액(GMV), 총 주문수, 활성 파트너수, 상품수 실시간 표시 |
| **관리자 파트너심사** | `https://admin.temu.com/merchant/kyc` | `/partners` | `PartnerVerifyView.vue`<br>`PUT /api/v1/admin/partners/:id/verify` | **VERIFIED** | 입점 신청 셀러 서류 심사, 승인(APPROVED) 및 반려(REJECTED) 처리 |

---

## 3. 격차(Gap) 분석 결론
초기 감사 당시 누락되었던 **상품 상세(`/product/:id`)**, **통합 검색(`/search`)**, **전용 장바구니(`/cart`)**, **주문 상세 추적(`/order/:id`)** 4개 핵심 쇼핑 경로와 **파트너 상품/주문 실시간 API 연동**이 모두 신규 개발되어 프로덕션에 배포되었으며, E2E 검증을 통해 Gap이 완전히 해소되었다.
