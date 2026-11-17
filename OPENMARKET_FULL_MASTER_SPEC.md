# OPENMARKET FULL MASTER SPEC — OLMOA 상용 오픈마켓 기능 + UX/UI 전면 완성 지시서

- 작성일: 2026-11-13
- 기준 커밋: `3636b74` (branch `fix/v3.2-integrity-regressions`, 작업 트리 clean)
- 작성 관점: 수석 시스템 아키텍트 + 리드 프로덕트 디자이너/PO
- 대상: 웹 3앱(`apps/storefront`, `apps/partner`, `apps/admin`), 공통 UI(`packages/ui`), API(`apps/cloudflare-gateway` + D1 `migrations/d1_*.sql`). Flutter 앱(`mobile/`)은 웹 디자인 토큰을 따라가는 후속 대상으로만 다룬다(§6 Phase 3-M).
- 이 문서는 실행 지시서다. 각 항목은 **현재 상태(증거) → 목표 → 수정/생성 파일 → 완료 기준(테스트)** 순으로 적는다.

---

## 0. 판정 규칙 (이 문서 전체에 적용)

1. **상태 표기는 4종만 쓴다**: `구현`(코드+UI+API가 모두 동작) / `부분`(일부만 동작하거나 UI·API 중 하나가 없음) / `미구현` / `PO결정`(정책 값이 없어 코드만으로 닫을 수 없음).
2. **"100%" "완벽" "VERIFIED" 같은 표현은 자동 테스트 로그로 증명된 범위에서만 쓴다.** 이 문서의 구현률은 §1.3의 항목 목록(총 112항목)을 채점한 값이며, 그 외의 의미를 갖지 않는다.
3. **가짜 수치 금지**: 판매량, 남은 재고 %, 급상승 순위, 평점, "오늘출발", "도착보장", 적립 예정액 등 모든 표시 수치는 DB에서 계산된 값만 보여준다. 데이터가 없으면 그 UI 요소를 숨긴다(빈 0%나 기본값으로 채우지 않는다).
4. **정책 값 발명 금지**: 카테고리 수수료율, PG 수수료율, 쿠폰 분담 비율, 셀러 등급 기준, 페널티 금액은 스키마와 관리 화면만 만들고, 값은 운영자가 입력한다. 값이 NULL이면 해당 기능은 비활성(fail-closed)이다.
5. **운영 반영 금지**: 원격 D1 마이그레이션, `wrangler deploy`, 실결제, 운영 시크릿 변경은 이 문서로 승인되지 않는다. 각 Phase 완료 후 운영자 승인을 별도로 받는다.
6. **사업자 엔티티 하드코딩 금지**: 상호·사업자번호 등은 `business_entities`/`/api/v1/business-info`에서만 읽는다(기존 V3 원칙 유지).

---

## 1. 현재 프로젝트 전수 감사 보고서 (기능 & UX/UI Gap Analysis)

### 1.1 감사 범위와 방법

| 대상 | 수량 | 방법 |
|---|---|---|
| 추적 중인 `.md` 문서 | 90개(`reports/` 30+, `docs/` 45+, `README.md`, `mobile/RELEASE.md`, `tests/README.md` 등) | 기능 주장(VERIFIED/100%/구현됨)을 추출해 코드와 1:1 대조 |
| 스토어프론트 뷰 | 27개(`apps/storefront/src/views`) + 컴포넌트 7개 | 전 파일 정독(홈·검색·카테고리·PDP·장바구니·주문서는 전문 확인) |
| 관리자 뷰 | 21개(`apps/admin/src/views`) | 라우터·셸·대시보드 정독, 전 파일 패턴 스캔 |
| 파트너(셀러센터) 뷰 | 15개(`apps/partner/src/views`) | 라우터·셸·대시보드·상품등록 정독, 전 파일 패턴 스캔 |
| 공통 UI | `packages/ui` 컴포넌트 34개, 컴포저블 7개, `tokens.css`, `tailwind.preset.cjs`, `styles/index.css` | 전문 확인 |
| API | 라우터 28개 파일, 엔드포인트 약 175개 경로 리터럴 | 경로 전수 추출, 주문/정산/쿠폰/리뷰/특가 로직 정독 |
| DB | D1 마이그레이션 `d1_01`~`d1_52`(53개 파일), 테이블 약 110개(스태시 테이블 포함) | 핵심 23개 테이블 DDL 확인, `ALTER TABLE` 전수 추출 |
| 자동 테스트 | `npm test` 1회 전체 실행(2026-11-13) | exit 0, `[PASS]` 514줄, `[FAIL]` 0줄. 마지막 스위트 `Functional E2E 26/26` |

**기준선 해석**: 현재 테스트는 API 계약·금전 불변식·보안·문구 정직성을 검증한다. 이 문서가 지적하는 UX/UI 공백과 미구현 도메인(셀러 쿠폰, 배송비 템플릿, 이미지 갤러리 등)은 테스트 대상이 아니므로, "테스트 녹색"이 곧 "상용 오픈마켓 수준"을 뜻하지 않는다.

### 1.2 문서 주장 vs 실제 구현 불일치 (문서 정정 대상)

| # | 문서(위치) | 문서 주장 | 실제 코드 | 판정 | 조치 |
|---|---|---|---|---|---|
| D-01 | `docs/audit/feature-parity-matrix.md` §A "상품 상세" | "이미지 갤러리, 옵션/SKU 선택 — **100% VERIFIED**" | PDP는 `product.thumbnail_url` 1장만 렌더(`apps/storefront/src/views/ProductDetailView.vue` media 블록). 상품 이미지 다건 테이블 없음(`product_images` 부재) | 불일치 | 문서를 `미구현`으로 정정, §4.2 `product_images` 구현 |
| D-02 | 같은 문서 "영구 장바구니" | "3만원 무료배송 게이지" | 무료배송 기준은 판매자별(`partners.free_shipping_threshold`). 장바구니는 "N원 더 담으면 무료" 텍스트만 있고 게이지 바 없음(`CartView.vue` 판매자 그룹 헤더) | 불일치 | 정정 + §3 S-04 게이지 구현 |
| D-03 | 같은 문서 §3 | "미구현(MISSING): 0개" | 셀러 쿠폰, 배송비 템플릿, 옵션 조합 편집 UI, 필터 사이드바, 타임딜 운영 도구 등 미구현(§1.3) | 불일치 | 문서 폐기 또는 본 문서로 대체 |
| D-04 | `docs/audit/route-gap-matrix.md` "주문 상세" | 경로 `/order/:id` | 실제 경로 `/orders/:id`(`apps/storefront/src/router/index.ts`) | 불일치 | 정정 |
| D-05 | 같은 문서 "메인" | "33개 카테고리 퀵링크, 실시간 핫딜 그리드 정상 렌더링" | 홈에는 대분류 필터 칩만 있음(아이콘 숏컷 그리드 없음). 핫딜은 진행 중 캠페인이 있을 때만 노출되는데, 캠페인을 만드는 관리자 API/화면이 없음(`flash_sale_campaigns`는 마이그레이션 시드로만 생성) | 불일치 | 정정 + §3 A-08 타임딜 운영 도구 |
| D-06 | `reports/COMMERCIALIZATION_100_FINAL.md` §1 #7 | "@olmoa/ui 31종 + Lagoon 토큰 — 동작" | 토큰 기반 뷰: 스토어 18/27, 관리자 1/21, 파트너 1/15(각 앱 `NotFoundView`만). 관리자·파트너 뷰는 `@olmoa/ui` 컴포넌트를 0회 사용 | 부분 | §2, §3 콘솔 전면 이식 |
| D-07 | 같은 문서 §1 #13 | "더미(lorem/TODO/플레이스홀더) 없음, 전 뷰 grep 0건" | 외부 스톡 이미지 폴백 `OrdersView.vue:476`(unsplash), 샘플 CSV/HTML의 unsplash URL(`BulkUploadView.vue:27-29`, `UrlImportView.vue:145-177`), 미입력 시 표시 문구 `OrderDetailView.vue:642`('지정 특송사', '발급 준비중') | 부분 | §1.4 목록대로 제거 |
| D-08 | 메모리/V4 PO 지시 "PHASE 2: 57개 화면 전면 교체, 31개 컴포넌트를 3개 콘솔 모두에서 사용" | 완료 조건 | 위 D-06과 같음. 관리자·파트너 화면 교체 미완 | 미완 | §6 Phase 1·4 |
| D-09 | `reports/COMMERCIALIZATION_100_FINAL.md` §4 "다크모드: 웹 토글 없음" | 토글 없음 | 토글은 이미 있음(`apps/storefront/src/App.vue` `cycleTheme`). 그러나 레거시 화면(`OrdersView`, `OrderDetailView`, `ProfileView`, `AddressesView`, `SupportView`, `CouponsView`, `Legal*`)이 `bg-white`·`text-gray-*`를 직접 써서 다크모드에서 흰 카드가 남음 | 문서는 낡음, 실제 결함은 별도 | 정정 + §3 레거시 화면 이식 |
| D-10 | `docs/audit/feature-parity-matrix.md` "판매자 상품 및 SKU 재고 관리" | VERIFIED | 재고 수정 API는 존재(`partner.js:250` `/partner/products/:id/stock`). 단 상품 **등록** 화면은 단일 가격·단일 재고 입력만 가능해 조합형 옵션(SKU 다건)을 셀러가 만들 수 없음(`apps/partner/src/views/ProductManageView.vue` `newProd`, `partner.js:199,234` 요청당 SKU 1개 INSERT) | 부분 | §3 P-04 옵션 매트릭스 |

문서 정리 원칙: 위 문서들은 삭제하지 말고 상단에 `> 이 문서는 2026-11-13 기준 OPENMARKET_FULL_MASTER_SPEC.md §1.2에 의해 대체됨` 배너를 추가하고, 표의 상태 값을 실제와 맞게 고친다(Phase 1 체크리스트 1-0).

### 1.3 구현률 채점표 (요구사항 112항목)

채점: `구현`=1, `부분`=0.5, `미구현`=0. 영역별 구현률 = 합계 / 항목 수.

#### ① 커머스 디자인 시스템 (8항목) — 5.0/8 = **63%**

| # | 항목 | 상태 | 증거 |
|---|---|---|---|
| 1 | 숫자 `tabular-nums` 전면 적용 | 부분 | `.om-num` 유틸 존재(`packages/ui/src/styles/index.css`), 그러나 `body`에 `font-feature-settings: 'tnum' 0`. `ProductCard.vue` 가격, 콘솔 전 화면은 미적용(콘솔 뷰 `tabular-nums`/`om-num` 사용 0회) |
| 2 | 브랜드 Primary 토큰 | 구현 | `--om-lagoon-600` → `--om-primary` |
| 3 | 할인/긴급 강조색 | 구현 | `--om-accent`(ruby) |
| 4 | 배송/무료배송 신뢰 배지 색 | 부분 | 전용 토큰 없음. `OmBadge tone="primary"`로 대체 |
| 5 | 별점 색 | 구현 | `--om-highlight`(amber) |
| 6 | 품절/비활성 뉴트럴 톤 | 부분 | 토큰 없음, 화면마다 `opacity-40`·`border-dashed` 임의 사용(`ProductDetailView.vue` 옵션 버튼) |
| 7 | 정보 밀도·엘리베이션 계층 | 부분 | `--om-shadow-*` 4단계 있음. 카드 패딩/간격 밀도 규격 없음 |
| 8 | 3개 앱 공통 적용 | 미구현 | 관리자 20/21, 파트너 14/15 뷰가 raw Tailwind 팔레트(`indigo/slate/gray`) + Font Awesome CDN 사용 |

#### ② 스토어 홈 & 탐색 (11항목) — 6.0/11 = **55%**

| # | 항목 | 상태 | 증거 |
|---|---|---|---|
| 1 | 상단 고정 헤더 | 구현 | `OmHeader` sticky(`packages/ui/src/components/OmHeader.vue`) |
| 2 | 대/중/소 3단 호버 플라이아웃 메가메뉴 | 부분 | 클릭으로 여는 팝오버, 2단(대→중)만. 호버는 대분류 전환만(`App.vue:211-243`) |
| 3 | 모바일 바텀 네비(홈/카테고리/검색/마이/최근본) | 부분 | 홈/카테고리/찜/장바구니/마이. 검색·최근 본 상품 없음(`App.vue:145-151`) |
| 4 | 최근 검색어 | 구현 | 로컬 8개, 개별/전체 삭제(`App.vue:81-108`) |
| 5 | 급상승 검색어 + 순위 변동 아이콘 | 부분 | `search_keywords.search_count` 상위 10개(누적), 순위 변동 데이터 없음 |
| 6 | 자동완성 + 추천 카테고리 | 구현 | `/api/v1/search/autocomplete` 상품/카테고리/키워드 그룹 |
| 7 | 히어로 캐러셀(인디케이터/일시정지/배지) | 부분 | 6초 자동 회전, 이전/다음 버튼, 인디케이터는 `sr-only`, **일시정지 버튼 없음**(WCAG 2.2.2 위반)(`HomeView.vue` hero) |
| 8 | 타임딜 실시간 카운트다운 | 구현 | 실제 `ends_at` 기준(`HomeView.vue` countdown) |
| 9 | 재고 소진율 프로그레스(`87% 판매됨`) | 미구현 | `flash_sale_items.sold_stock`을 갱신하는 코드가 없음(`services/orders.js`에 flash_sale 참조 0회). API는 항상 0인 `sold_percent`를 반환(`routes/features.js:104`) |
| 10 | 카테고리 숏컷 아이콘 그리드 | 미구현 | `categories`에 아이콘/이미지 컬럼 없음 |
| 11 | 타임딜 운영 도구(캠페인 생성·상품 편성) | 미구현 | 관리자 API·화면 없음 |

#### ③ 상품 카드 & PLP (14항목) — 6.0/14 = **43%**

| # | 항목 | 상태 | 증거 |
|---|---|---|---|
| 1 | 1:1 썸네일 + 호버 줌 | 구현 | `ProductCard.vue` `aspect-square`, `group-hover:scale-[1.03]` |
| 2 | 카드 내 찜 하트 | 미구현 | — |
| 3 | 카드 내 장바구니 퀵담기 | 미구현 | 의도적으로 제거(옵션 미선택 문제). §3 S-02에서 옵션 바텀시트 방식으로 구현 |
| 4 | 순위/특가 리본 | 부분 | 순위 숫자만(`rank` prop) |
| 5 | 스토어명 + 2줄 말줄임 | 구현 | `line-clamp-2` |
| 6 | 가격 위계(정가 취소선 → 할인율 → 최종가) | 부분 | 순서가 할인율 → 최종가 → 취소선, 고정폭 숫자 미적용 |
| 7 | 배송/혜택 마이크로 배지 | 부분 | `무료배송`만. 쿠폰/적립/오늘출발 없음 |
| 8 | 별점 + 리뷰 수 | 구현 | 리뷰 있을 때만 |
| 9 | 최근 구매 건수 | 부분 | 누적 `주문 N개`(`total_sold_count`). 기간 집계 없음 |
| 10 | 좌측 필터 사이드바(카테고리 트리/브랜드/혜택/배송) | 미구현 | `SearchView.vue`, `CategoryView.vue` 모두 없음 |
| 11 | 가격 범위 필터 | 부분 | 검색 화면에만 입력 2칸. 카테고리 화면 없음 |
| 12 | 적용 필터 칩 + 초기화 | 부분 | 가격 초기화 버튼만 |
| 13 | 그리드/리스트 뷰 전환 | 미구현 | — |
| 14 | 서버 페이지네이션/무한 스크롤 | 미구현 | 홈은 `/products` 전량 로드 후 클라이언트 필터·정렬(`HomeView.vue` `load()`), 검색/카테고리는 `limit=200` 후 클라이언트 정렬. 서버는 이미 `page`/`per_page` 지원(`routes/catalog.js`) |

#### ④ 상품 상세 PDP (15항목) — 7.0/15 = **47%**

| # | 항목 | 상태 | 증거 |
|---|---|---|---|
| 1 | 데스크톱 2단 비대칭 레이아웃 | 구현 | `lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]`(대칭, 비율 조정 필요) |
| 2 | 이미지 갤러리(썸네일 스트립 + 확대) | 미구현 | 1장 |
| 3 | 포토/동영상 리뷰 하이라이트 바 | 미구현 | 판매자 영상 버튼만 |
| 4 | 상단 고정 탭 네비게이션 | 부분 | `OmTabs`는 있으나 sticky 아님 |
| 5 | 상세정보 펼쳐보기(그라데이션 폴딩) | 미구현 | 전체 펼침 |
| 6 | 우측 Sticky 구매 패널 | 부분 | 좌측 이미지가 sticky, 구매 패널은 스크롤과 함께 사라짐 |
| 7 | 다중 옵션 조합 선택 블록(개별 수량/삭제/합산) | 미구현 | 한 번에 1개 조합만 선택 |
| 8 | 쿠폰 다운로드 모달 | 미구현 | — |
| 9 | 총 상품금액 실시간 계산 | 구현 | `lineTotal`(수량 할인 서버 동일 규칙) |
| 10 | 장바구니/바로구매 대형 CTA | 구현 | — |
| 11 | 판매자 미니 프로필 카드(등급/평점/스토어홈/문의) | 부분 | 판매자명 링크 + 법정 고지만 |
| 12 | 모바일 하단 고정 구매 바 | 구현 | safe-area 처리 포함 |
| 13 | 모바일 옵션 선택 바텀시트 | 미구현 | 구매 바에서 옵션 선택 불가(위로 스크롤해야 함) |
| 14 | 상품정보제공고시 | 부분 | 자유 key/value(`products.notice_info_json`). 카테고리별 법정 항목 템플릿 없음 |
| 15 | 연관 상품 | 구현 | `/api/v1/recommendations/related` |

#### ⑤ 멀티셀러 장바구니 & 주문결제 (10항목) — 7.0/10 = **70%**

| # | 항목 | 상태 | 증거 |
|---|---|---|---|
| 1 | 판매자 단위 그룹핑 | 구현 | `CartView.vue` 그룹 + 서버 sub-order 분할 |
| 2 | 스토어별 상품금액+배송비 합계 | 구현 | `selectedGroupById` |
| 3 | 무료배송 유도 게이지 + 묶음 상품 보기 링크 | 부분 | 텍스트만 |
| 4 | 우측 고정 결제 요약 | 구현 | `lg:sticky lg:top-24`(`CartView.vue:235`, `CheckoutView.vue:372`) |
| 5 | 즉시할인/스토어쿠폰/플랫폼쿠폰 분리 표기 | 부분 | 수량할인 + 플랫폼 쿠폰 1장만. 스토어 쿠폰 개념 없음 |
| 6 | 적립 예정 포인트 표시 | 부분 | PDP 안내 문구(1%)만, 요약 박스 금액 없음 |
| 7 | 서버 장바구니(기기 동기화) | 구현 | `cart_items`(d1_47), `/api/v1/cart` |
| 8 | 서버 견적 재계산 | 구현 | `/api/v1/orders/quote`, 가격 변동 반영 |
| 9 | 주소 검색(우편번호 API) | 미구현 | 수기 입력(`CheckoutView.vue`, `AddressesView.vue`) |
| 10 | 결제수단 | 부분 | Toss 구조 + 샌드박스, 실가맹 계약 대기 |

#### ⑥ 셀러센터 & 통합어드민 B2B UX (11항목) — 3.0/11 = **27%**

| # | 항목 | 상태 | 증거 |
|---|---|---|---|
| 1 | 좌측 접이식 LNB | 미구현 | 두 콘솔 모두 상단 가로 메뉴(`apps/partner/src/App.vue:34-42`, `apps/admin/src/App.vue:65+`) |
| 2 | 상단 스토어 상태 헤더(승인상태/정산계좌/페널티) | 미구현 | — |
| 3 | KPI 파이프라인(신규주문/발송대기/배송중/클레임/미답변/정산예정) | 부분 | 파트너: 상품수·주문수·매출·정산예정 4개(`partner/src/views/DashboardView.vue`) |
| 4 | 증감 배지 | 부분 | 주간 GMV `wow_pct`만 |
| 5 | 상태별 탭 필터 | 부분 | 화면별로 제각각 |
| 6 | 기간 선택기 | 미구현 | 관리자·파트너 뷰 date 필터 사실상 없음 |
| 7 | 다중 검색 조건 | 부분 | 관리자 회원(id/email)·문의 일부 |
| 8 | 전체 선택 + 일괄 처리 툴바 | 부분 | 파트너 출고(`ShipmentView.vue`)만 |
| 9 | 엑셀(CSV) 다운로드 | 부분 | 파트너 정산·출고 CSV만, 관리자 0 |
| 10 | 서버 페이지네이션 UI + 우측 고정 액션 컬럼 | 미구현 | API는 `per_page` 지원(`routes/admin.js:257,282,301,538`), 화면은 첫 페이지만 표시 |
| 11 | 디자인 시스템 컴포넌트 사용 | 미구현 | `OmDataTable`, `OmPagination`, `OmSidebar`, `OmDatePicker`를 사용하는 화면 0개 |

#### 핵심 비즈니스 도메인 7종 (43항목) — 27.0/43 = **63%**

| 도메인 | 항목(상태) | 점수 |
|---|---|---|
| D1 다중 권한·입점 심사 | 구매자/셀러/관리자 5역할 RBAC(구현) · 입점 신청+서류 업로드(구현, `routes/onboarding.js`) · 승인/반려+사유(구현) · 정산계좌 검증/변경 승인(구현) · 셀러 미니샵(부분: `/store/:id`에 상품·평점만, 배너/공지/카테고리/스토어찜 없음) | 4.5/5 = 90% |
| D2 고시·옵션·배송비 | 상품정보제공고시(부분: 자유형) · 조합형 옵션 데이터 모델(구현: `option_combination_json`+서버 `attributes`) · 셀러 옵션 조합 편집 UI(미구현) · 옵션별 가격(구현: SKU 단위 가격) · SKU 코드(구현) · 배송비 템플릿 엔진(미구현: 판매자당 기본료+무료기준 2값뿐) · 도서산간 추가운임(구현: d1_52 `shipping_remote_zones`) · 수량별 배송비(미구현) | 4.5/8 = 56% |
| D3 분리 주문·재고 | Master→Sub-Order→Item 3계층(구현) · 판매자별 배송비 계산(구현) · 동시성 재고 차감(구현: D1 batch + `trg_sku_stock_nonnegative` 트리거, `d1_20:512`) · 상품 단위 묶음배송 그룹(미구현) | 3/4 = 75% |
| D4 쿠폰·할인 분담 | 플랫폼 쿠폰(구현) · 셀러 쿠폰(미구현: `coupons`에 발급 주체 컬럼 없음) · 중복 적용 규칙(미구현) · 정산 시 분담금 계산(미구현: 쿠폰은 전액 `PROMOTION_EXPENSE`로 플랫폼 부담, `services/orders.js:395`) · 상품/카테고리/스토어 적용 범위(미구현) | 1/5 = 20% |
| D5 상태 머신·부분 클레임 | 서브오더 상태 머신(구현: 12상태, `d1_20:194`) · 품목·수량 단위 부분 취소(구현: `OrderDetailView.vue:224`, `refunded_quantity`) · 부분 반품(구현: `returns.items_json`) · 교환(구현: `exchange_*` 컬럼) · 귀책별 반품배송비(부분: `returns.fault`/`return_fee_amount` 있음, 수거지시·검수 단계 UI 없음) | 4.5/5 = 90% |
| D6 에스크로·정산 | 구매확정(구현: 자동확정 크론) · 판매자별 수수료(구현: `commission_rate_bps`) · 카테고리 수수료(미구현) · PG 수수료 차감(미구현) · 쿠폰 분담금 가감(미구현) · 정산 내역 산출(구현) · 셀러 출금 신청(미구현: 관리자 지급 승인만) · 롤링 리저브(구현) | 4/8 = 50% |
| D7 리뷰·Q&A·페널티·고지 | 실구매 리뷰(구현: 서버 구매 검증) · 포토 리뷰(구현) · 옵션 노출(구현: `sku_option_summary`) · 도움돼요(미구현: `helpful_count` 컬럼만, 투표 API 없음) · 비밀글 Q&A(구현) · 판매자 페널티(부분: 지연출고 1종, 관리 UI 없음) · 판매자 등급(미구현) · 전자상거래법 고지(구현: 푸터·PDP 판매자 고지) | 5.5/8 = 69% |

#### 종합

| 구분 | 점수 | 구현률 |
|---|---|---|
| UX/UI 6대 영역 | 34.0 / 69 | 49% |
| 비즈니스 7대 도메인 | 27.0 / 43 | 63% |
| **전체** | **61.0 / 112** | **54%** |
| 화면 디자인 시스템 이식률(뷰 파일 기준) | 20 / 63 | 32% (스토어 18/27, 관리자 1/21, 파트너 1/15) |

### 1.4 하드코딩 / 더미 / 반응 없는 UI 전수 목록

| ID | 파일:라인 | 내용 | 위험 | 조치 |
|---|---|---|---|---|
| H-01 | `apps/storefront/src/views/OrdersView.vue:476` | 주문 썸네일 없을 때 unsplash 시계 사진을 표시 | 구매하지 않은 상품 사진 노출 | `OmImage` 폴백(중립 아이콘 박스)으로 교체 |
| H-02 | `apps/storefront/src/views/OrderDetailView.vue:642` | 택배사 없으면 '지정 특송사', 송장 없으면 '발급 준비중' | 사실이 아닌 상태 표시 | 값이 없으면 줄 자체를 숨기고 "송장 등록 전" 상태 배지 |
| H-03 | `apps/storefront/src/views/OrderDetailView.vue:613` | `item.status \|\| 'PREPARING'` 영문 코드 노출 + 기본값 | 상태 위조, 영문 노출 | `utils/orderStatus.ts` 라벨 사용, 기본값 제거 |
| H-04 | `apps/partner/src/views/BulkUploadView.vue:27-29` | 샘플 CSV 3행(가상 브랜드 "OLMOA OUTDOOR" 등 + unsplash 이미지) | 셀러가 샘플 행을 그대로 업로드 | 샘플은 헤더+설명 행만, 서버(`/partner/products/bulk`)에서 unsplash·샘플 SKU 거부 |
| H-05 | `apps/partner/src/views/UrlImportView.vue:145-177` | 데모용 HTML 픽스처(unsplash 이미지) | 운영 화면에 데모 데이터 | 개발 빌드 전용(`import.meta.env.DEV`)으로 격리 |
| H-06 | `apps/partner/src/views/ProductManageView.vue` `defaultDescriptionTemplate` | "[판매자 작성] 상품의 주요 특징과 사양을 적어 주세요." 등 3개 안내 문구가 상세설명 기본값 | 미수정 시 그대로 게시 | 서버 상품 저장 시 `[판매자 작성]` 포함이면 422 |
| H-07 | `apps/partner/src/views/ProductManageView.vue:319` | 품질점수에서 `includes('placeholder')` 문자열 검사 | 클라이언트 임의 점수 | 서버 `computeServerQualityScore`(`partner.js:160`) 값만 표시 |
| H-08 | `apps/cloudflare-gateway/src/routes/features.js:102-105` | `sold_quantity`, `sold_percent`가 갱신되지 않는 `sold_stock`에서 계산되어 항상 0 | 프론트가 쓰는 순간 가짜 수치 | §4.3 특가 엔진에서 실집계 or 필드 제거 |
| H-09 | `migrations/d1_12_*` `banners.bg_gradient DEFAULT 'from-orange-500 to-red-600'` | 레거시 색상 하드코딩 컬럼(화면 미사용) | 디자인 토큰 우회 | 컬럼 사용 금지, 배너 편집 UI에서 제외 |
| H-10 | `apps/storefront/src/views/HomeView.vue` `load()` | 전 상품 1회 로드 후 클라이언트 필터·정렬 | 상품 수 증가 시 성능 붕괴 | 서버 페이지네이션 + 섹션형 홈(§3 S-01) |
| H-11 | `SearchView.vue`, `CategoryView.vue` `limit=200` | 200개 상한 + 클라이언트 정렬 | 201번째 이후 상품 영구 미노출 | `page/per_page` + 서버 정렬 + 무한 스크롤 |
| H-12 | 네이티브 `alert()`/`confirm()` | 스토어 14줄(`AddressesView` 6, `ProfileView` 5, `OrderDetailView` 3), 관리자 24줄(17개 파일), 파트너 14줄(`ProductManageView` 6, `BiddingView` 4, `ReturnsManageView` 2, `ShipmentView` 1, `SettlementView` 1) | 브라우저 기본 대화상자, 모바일 UX 단절, 접근성/스타일 불일치 | `OmConfirmDialog` + `useToast`로 전량 교체(§2.6) |
| H-13 | 사용자에게 알리지 않는 빈 `catch` | `admin/CategoriesView.vue:32,69`, `admin/CouponsView.vue:51,97`, `admin/ProductManageView.vue:39`, `admin/ReviewsView.vue:30,46`, `admin/UsersView.vue:30`, `admin/PartnerVerifyView.vue:46`, `admin/DashboardView.vue:142`, `partner/DashboardView.vue:60` | 실패 시 빈 표가 "데이터 없음"처럼 보임 | `OmErrorState` + 재시도 |
| H-14 | Font Awesome CDN(`apps/*/index.html:11` 또는 `:47`) | 스토어 22회, 콘솔 20개 파일에서 `fa-solid` 사용. 스토어 신규 화면은 lucide | 아이콘 체계 2종, 외부 CDN 의존 | lucide 단일화, CDN 링크 제거 |
| H-15 | raw Tailwind 팔레트/HEX | 스토어 레거시 9개 뷰(`OrderDetailView` 209건, `OrdersView` 163건, `ProfileView` 82건, `AddressesView` 68건 등), 관리자 20개 뷰(`SupplierIntegrationView` 281건, `DashboardView` 158건, `MarketingView` 131건 등), 파트너 14개 뷰(`UrlImportView` 243건, `ShipmentView` 190건, `MultiChannelListingView` 190건, `ProductManageView` 187건 등) | 다크모드 깨짐, 브랜드 불일치 | 시맨틱 토큰 클래스로 이식(§2) |
| H-16 | `apps/admin/src/views/SupplierIntegrationView.vue:778` | "Safe Mock" 문구 | 운영 화면에 개발 용어 | 운영 문구로 교체("외부 발주 차단 모드") |

### 1.5 UX/UI 시각 결함 및 사용성 결함

| ID | 화면 | 결함 | 심각도 |
|---|---|---|---|
| U-01 | 관리자·파트너 전 화면 | 디자인 시스템 미적용, `indigo/slate` 임의 팔레트, 상단 가로 메뉴(메뉴 14~19개가 한 줄에 몰림), 기본 브라우저 대화상자 | P0(상용 B2B 콘솔 품질 미달) |
| U-02 | 스토어 레거시 9개 화면(주문목록/상세, 마이, 배송지, 고객센터, 쿠폰, 약관 3종) | 신규 화면과 다른 시각 언어(`rounded-2xl`, `gray-*`, `bg-white`), 다크모드에서 흰 카드 | P1 |
| U-03 | 홈 히어로 | 자동 회전 중 일시정지 수단 없음, 시각적 인디케이터 없음 | P1(접근성) |
| U-04 | PDP | 이미지 1장, 구매 패널 비고정, 탭 비고정, 옵션 다중 선택 불가, 모바일에서 옵션을 고르려면 위로 스크롤 | P0(전환율 직결) |
| U-05 | PLP(검색/카테고리) | 필터 사이드바·적용 칩·뷰 전환·페이지네이션 없음 | P0 |
| U-06 | 상품 카드 | 가격 위계 역순, 찜 버튼 없음, 혜택 배지 1종 | P1 |
| U-07 | 장바구니 | 무료배송 게이지 없음, 판매자 묶음 상품 보기 없음 | P2 |
| U-08 | 주문서·배송지 | 우편번호 검색 없음(수기 입력) | P1 |
| U-09 | 콘솔 표 | 페이지네이션 UI 없음(첫 50~150건만 보임), 기간 필터 없음, 관리자 엑셀 없음 | P0(운영 불가 수준) |
| U-10 | 콘솔 대시보드 | 실패 시 0 값으로 렌더(`partner/DashboardView.vue:60`), 처리 대기 파이프라인 없음 | P1 |
| U-11 | 숫자 | 가격·금액 열 고정폭 미적용(자릿수 흔들림) — 상품 카드, 콘솔 전 표 | P2 |
| U-12 | 아이콘 | lucide + Font Awesome 혼용 | P2 |

---

## 2. 오픈마켓 전용 UX/UI 디자인 시스템 & 공통 컴포넌트 개편 명세

기존 "OLMOA Lagoon" 토큰(`packages/ui/src/styles/tokens.css`)을 **폐기하지 않고 확장**한다. 브랜드 Primary(lagoon-600 `#0B6E79`)는 유지하고, 커머스 의미 토큰 계층을 추가한다. 모든 앱은 시맨틱 토큰만 쓴다(raw 팔레트 클래스 `gray-*`, `indigo-*`, `bg-white`, HEX 금지 — §2.8 린트로 강제).

### 2.1 컬러 — 커머스 시맨틱 토큰 (추가)

`tokens.css` `:root`에 추가, 다크 테마 블록 2곳(`[data-theme='dark']`, `prefers-color-scheme`)에 대응 값 추가. 값은 "R G B" 채널 형식(기존 규칙).

| 토큰 | 라이트 | 다크 | 용도 | Tailwind 유틸(프리셋 추가) |
|---|---|---|---|---|
| `--om-price` | stone-900 `23 23 22` | `236 237 235` | 최종 판매가 | `text-price` |
| `--om-discount` | ruby-500 `214 48 74` | `240 98 118` | 할인율 숫자, 쿠폰 할인액 | `text-discount` |
| `--om-urgent` | `232 93 4` (#E85D04) | `255 140 66` | 타임딜 카운트다운, 마감 임박, 재고 소량 | `text-urgent`, `bg-urgent-soft` |
| `--om-urgent-soft` | `255 237 222` | `66 33 10` | 타임딜 배경 | |
| `--om-ship-fast` | blue-600 `36 99 209` | `110 160 245` | 오늘출발/도착예정 배지 | `text-ship-fast`, `bg-ship-fast-soft` |
| `--om-ship-free` | green-600 `22 128 74` | `74 196 128` | 무료배송 배지 | `text-ship-free`, `bg-ship-free-soft` |
| `--om-rating` | amber-400 `242 169 0` | `248 204 98` | 별점 | `text-rating` |
| `--om-benefit` | lagoon-700 `9 90 99` | lagoon-200 | 적립/쿠폰 혜택 텍스트 | `text-benefit` |
| `--om-soldout` | stone-400 `154 154 146` | `105 108 105` | 품절 텍스트·아이콘 | `text-soldout` |
| `--om-soldout-overlay` | `255 255 255`(alpha 0.6로 사용) | `14 16 17` | 품절 썸네일 덮개 | `bg-soldout-overlay/60` |
| `--om-direct` | stone-900 | stone-0 | "올모아 직영" 배지(MODEL A) | `bg-direct text-direct-on` |

규칙:
- 할인율은 항상 `--om-discount`, 최종가는 `--om-price`. 최종가를 빨간색으로 칠하지 않는다(쿠팡·스마트스토어 공통 위계: 할인율만 강조색).
- `--om-urgent`는 "실제로 마감 시간이 있는" 요소에만 쓴다(카운트다운, `stock_quantity <= 10`).
- 대비: 모든 텍스트 토큰은 `--om-surface` 대비 4.5:1 이상. `tests/ui/theme.test.mjs`에 신규 토큰 대비 검사 추가.

### 2.2 타이포그래피 스케일

폰트: Pretendard Variable(이미 `main.ts`에서 로드) 유지. 숫자 전용 규칙 추가.

| 토큰 | 크기/행간 | 굵기 | 용도 |
|---|---|---|---|
| `display` | 38/46 | 700 | 기획전 히어로 |
| `h1` | 24/32 (모바일 20/28) | 700 | 페이지 제목 |
| `h2` | 20/28 | 700 | 섹션 제목 |
| `h3` | 17/26 | 600 | 카드 제목, 패널 제목 |
| `body` | 15/24 | 400 | 본문 |
| `body-sm` | 13/20 | 400 | 보조 설명, 표 본문(콘솔 기본) |
| `caption` | 12/18 | 400 | 메타 정보 |
| `micro` | 11/16 | 500 | 배지, 마이크로 태그 |
| `price-xl` | 30/38 | 800 | PDP 최종가 |
| `price-lg` | 20/28 | 700 | 장바구니/주문 합계 |
| `price-md` | 16/22 | 700 | 상품 카드 최종가 |
| `price-strike` | 12/16 | 400 + line-through | 정가 |

숫자 규칙:
1. `packages/ui/src/styles/index.css`의 `body { font-feature-settings: 'tnum' 0; }`를 유지하되, 새 컴포넌트 `OmPrice`, `OmNumber`, `OmCountdown`, `OmDataTable`의 숫자 셀은 **항상** `font-variant-numeric: tabular-nums` 적용.
2. 콘솔(관리자·파트너)의 `<td>`·KPI 숫자는 전부 `OmNumber`를 통해 렌더한다. 금액 열은 우측 정렬.
3. 금액 포맷은 `packages/ui/src/format.ts`(기존 `formatNumber`, `formatDateTime`)와 스토어 `locale.formatPrice`만 사용. `toLocaleString()` 직접 호출 금지(린트).

### 2.3 그리드·반응형·밀도

- 브레이크포인트: 기존 프리셋 유지 `xs 375 / sm 640 / md 768 / lg 1024 / xl 1366 / 2xl 1440 / 3xl 1920`.
- 컨테이너: 스토어 `--om-container: 1320px` 유지, 콘솔은 전폭(LNB 제외 영역 `max-width: none`, 좌우 24px).
- 스토어 상품 그리드 열 수: `xs 2 / md 3 / lg 4 / xl 5 / 3xl 6`, 간격 `gap-x-3 gap-y-6`(모바일 `gap-x-2 gap-y-5`). 카드 내부 패딩 상하 10px, 좌우 2px(이미지 아래 텍스트는 카드 테두리 없이 정렬 — 상용 PLP 표준. 카드 테두리는 호버 시에만).
- 콘솔 밀도: 표 행 높이 기본 44px, `compact` 36px. 폼 컨트롤 높이 36px. 카드 패딩 16px.
- 엘리베이션: `shadow-sm`(카드 기본·콘솔 패널) → `shadow-md`(호버 카드·드롭다운) → `shadow-lg`(스티키 구매 패널·바텀시트) → `shadow-overlay`(모달). 테두리는 `border-line` 1px 단일 두께.
- 가로 스크롤 금지: 모든 화면 375px에서 `document.documentElement.scrollWidth <= 375`(`tests/browser/route_smoke.mjs` 기존 검사 유지).

### 2.4 아이콘

- `lucide-vue-next` 단일 체계. Font Awesome CDN 링크를 `apps/storefront/index.html`, `apps/admin/index.html`, `apps/partner/index.html`에서 제거하고 `fa-*` 클래스 사용 0건을 테스트로 고정(`tests/ui/design_lint.test.mjs` 신규).
- 크기: 16(표·인라인), 20(헤더 액션), 24(바텀 네비).

### 2.5 공통 컴포넌트 규격 (신규·확장)

기존 34개(`packages/ui/src/components`)는 유지. 아래를 추가·확장하고 `packages/ui/src/index.ts`에서 export한다. 모든 컴포넌트는 default/hover/focus-visible/active/disabled/loading/error 상태를 갖는다.

| 컴포넌트 | 신규/확장 | 핵심 props/slots | 규격 |
|---|---|---|---|
| `OmPrice` | 신규 | `sale`, `original?`, `size: sm\|md\|lg\|xl`, `range?: {min,max}`, `currency` | 순서: 정가 취소선(윗줄, `price-strike`) → 할인율(`text-discount`, 굵게) + 최종가(`text-price`). 할인율은 `discountRate(original, sale) > 0`일 때만. `tabular-nums` 고정 |
| `OmNumber` | 신규 | `value`, `format: number\|won\|percent`, `delta?` | 고정폭, `delta` 있으면 ▲/▼ 배지(`success`/`danger`) |
| `OmRating` | 신규 | `value`, `count`, `size` | 별 1개 + 소수 1자리 + `(1,420)`. `count=0`이면 렌더 안 함 |
| `OmCommerceBadge` | 신규(`OmBadge` 래핑) | `kind: free-ship\|fast-ship\|coupon\|benefit\|direct\|deal\|soldout\|new` | 높이 20px, `micro` 글꼴, 각 kind는 §2.1 토큰. kind별 표시 조건은 §3 S-02 카드 규칙에서 정의 |
| `OmCountdown` | 신규 | `endsAt`, `format: hms\|dhms`, `@expire` | 1초 틱, 고정폭, `--om-urgent`, 만료 시 `@expire` 후 숨김. `prefers-reduced-motion`에서도 숫자는 갱신(애니메이션만 제거) |
| `OmProgress` | 신규 | `value(0-100)`, `tone`, `label` | 타임딜 소진율 등. 값이 서버 실집계일 때만 사용(§0-3) |
| `OmQuantityStepper` | 신규 | `modelValue`, `min`, `max`, `size` | `-`/입력/`+`, 최대치 도달 시 `+` 비활성 + "최대 N개" 툴팁 |
| `OmCarousel` | 신규 | `items`, `interval`, `autoplay` | 인디케이터 점(보이는 UI), 이전/다음, **일시정지/재생 버튼**, 키보드 ←/→, 스와이프, 호버·포커스 시 자동 정지, `prefers-reduced-motion`이면 자동 회전 없음 |
| `OmImageGallery` | 신규 | `images: {url, alt}[]` | 메인 1:1 + 썸네일 스트립(데스크톱 세로 좌측 또는 하단 가로), 호버 확대(lens 2x) 데스크톱, 모바일은 스와이프 + 페이지 표시 `1/7`, 클릭 시 전체화면 라이트박스 |
| `OmBottomSheet` | 신규 | `open`, `title`, `snap: half\|full` | 모바일 전용 하단 시트, 드래그 핸들, 배경 탭/ESC 닫기, 포커스 트랩, safe-area 패딩. `useOverlay` 재사용 |
| `OmStickyTabs` | 신규(`OmTabs` 확장) | `tabs`, `offsetTop` | 스크롤 시 헤더 아래 고정, 섹션 진입에 따라 활성 탭 자동 변경(IntersectionObserver), 클릭 시 해당 섹션으로 스크롤 |
| `OmFoldable` | 신규 | `collapsedHeight` | 상세 설명 접힘 + 하단 그라데이션 + "상세정보 펼쳐보기" 버튼 |
| `OmFilterPanel` | 신규 | `groups: {key, label, type: tree\|checkbox\|range\|toggle, options}[]`, `modelValue` | 데스크톱 좌측 240px, 모바일은 `OmBottomSheet`(full)로 열림. 그룹 접기/펼치기, 옵션별 개수 표시(서버 facet) |
| `OmFilterChips` | 신규 | `chips`, `@remove`, `@clear` | 적용 필터 칩 + "전체 초기화" |
| `OmViewToggle` | 신규 | `modelValue: grid\|list` | 아이콘 토글 2개, 선택값 `localStorage`(try/catch) |
| `OmProductCard` | 이동+확장 | 기존 `apps/storefront/src/components/ProductCard.vue`를 `packages/ui`로 이동 | §3 S-02 카드 규격 |
| `OmSellerCard` | 신규 | `seller: {name, grade?, rating?, review_count, response_rate?}` | PDP·장바구니용 판매자 미니 프로필 |
| `OmConfirmDialog` | 신규 | `useConfirm()` 컴포저블: `await confirm({title, body, tone: default\|danger, confirmLabel})` → `boolean` | 네이티브 `confirm()` 대체. danger 톤은 확인 버튼 빨강 + 2단계 확인 옵션(`requireText`) |
| `OmToast` | 확장 | 기존 | `alert()` 대체. 성공 3초, 오류는 수동 닫기 |
| `OmEmptyState` / `OmErrorState` / `OmSkeleton` | 기존 유지 | — | 모든 목록 화면에 3상태 필수(§2.7) |
| `OmConsoleShell` | 신규 | `menu: MenuGroup[]`, `#header-status`, `#user` | 좌측 LNB 240px(접힘 64px, 아이콘만, 상태 `localStorage`), 그룹 헤더, 활성 표시, 모바일은 `OmDrawer`. 상단 56px 헤더: 앱명·스토어 상태 슬롯·검색·알림·사용자 |
| `OmKpiCard` | 신규 | `label`, `value`, `delta?`, `to?`, `tone?`, `loading`, `error` | 숫자 `OmNumber`, 클릭 시 해당 필터가 걸린 목록으로 이동 |
| `OmDataTable` | 확장 | 기존 + `selectable`, `stickyActions`, `serverPagination {page, perPage, total}`, `columns[].align/width/sticky`, `#bulk-actions`, `density` | 전체 선택(현재 페이지) 체크박스, 선택 시 상단 일괄 처리 바(`OmBulkActionBar`), 우측 고정 액션 열, 헤더 고정, 빈/오류/로딩 상태 내장 |
| `OmBulkActionBar` | 신규 | `count`, `#actions` | "N건 선택됨 · 선택 해제" + 액션 버튼 |
| `OmStatusTabs` | 신규 | `tabs: {key, label, count}[]` | 상태별 탭 + 건수 배지(서버 count) |
| `OmDateRangePicker` | 신규(`OmDatePicker` 확장) | `presets: today\|7d\|1m\|3m\|custom` | 빠른 선택 버튼 + 직접 입력, KST 기준 `YYYY-MM-DD` |
| `OmSearchFilterBar` | 신규 | `fields: {key, type: select\|text\|date-range}[]`, `@search`, `@reset` | 콘솔 다중 검색 조건 영역(접기 가능) |
| `OmAddressSearch` | 신규 | `@select({zip, road, jibun})` | 우편번호 검색(Daum 우편번호 서비스 스크립트 지연 로드, 실패 시 수기 입력 폴백) |
| `OmImage` | 신규 | `src`, `alt`, `ratio` | 로딩 스켈레톤, 오류 시 중립 아이콘 박스(외부 스톡 이미지 폴백 금지) |

### 2.6 대화상자·알림 표준

- 파괴적 작업(삭제, 환불, 지급, 정산 확정, 입점 반려, 상품 판매중지): `useConfirm({tone: 'danger'})`. 금액이 걸린 작업은 금액을 본문에 굵게 표기.
- 성공: `toast.success`. 실패: `toast.error(서버 error 메시지)` + 폼 필드 오류는 `OmField` 인라인.
- `window.alert`, `window.confirm`, `window.prompt` 사용 0건(린트 + `tests/ui/design_lint.test.mjs`).

### 2.7 상태(로딩/빈/오류) 표준

모든 데이터 영역은 다음 4분기를 가진다: `loading → OmSkeleton(해당 레이아웃 모양)`, `error → OmErrorState(재시도)`, `empty → OmEmptyState(다음 행동 버튼 1개 이상)`, `data`. 콘솔 KPI 카드는 개별 실패 시 해당 카드만 "불러오지 못함" 표시(0으로 렌더 금지).

### 2.8 디자인 린트 (자동 강제)

신규 `tests/ui/design_lint.test.mjs`:
1. `apps/*/src/**/*.vue`에서 정규식 `(bg|text|border|ring|from|to)-(gray|slate|zinc|neutral|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose)-\d{2,3}` 및 `bg-white`, `#[0-9a-fA-F]{6}` 0건(허용 목록: 이미지 위 오버레이 `bg-black/40`, `text-white`는 이미지 위 텍스트에 한함).
2. `fa-solid|fa-regular|font-awesome` 0건.
3. `alert(|confirm(|prompt(` 0건(함수명 `confirm` 로컬 정의 제외 — 호출 대상이 `window`이거나 전역인 경우만 검출).
4. 각 Phase 진행 중에는 파일별 허용 상한(현재 건수)을 두고, Phase 종료 시 0으로 고정.

---

## 3. 화면별(Page-by-Page) UX/UI 리디자인 및 프론트엔드 상세 작업 명세

표기: **[수정]** 기존 파일 수정, **[신규]** 새 파일. API 표기는 §4 참조.

### 3.A 구매자 스토어프론트 (`apps/storefront`)

#### S-00 앱 셸 — `src/App.vue` [수정]

- 레이아웃: 유틸바(36px, 데스크톱) → 메인 헤더(64px, sticky: 로고 · 카테고리 버튼 · 검색창 · 액션) → 카테고리 바(44px, 스크롤 시 숨김, 위로 스크롤 시 노출) → `<main>` → 푸터(법정 고지) → 모바일 바텀 네비.
- **메가메뉴 3단 플라이아웃** [신규 `src/components/MegaMenu.vue`]: 카테고리 버튼에 마우스 진입 시 150ms 지연 후 열림(클릭·키보드 Enter도 열림), 좌측 대분류 열(아이콘 + 이름) → 호버 시 우측에 중분류 제목 + 그 아래 소분류 링크 목록(다열 그리드). 마우스 이동 경로 보정(삼각형 영역 안에서 이동 중이면 대분류 전환 지연 120ms). 대분류 아이콘은 `categories.icon_key`(§4.2) 사용, 없으면 아이콘 없이.
- **검색 오버레이**: 포커스 시 패널 2열(데스크톱) — 좌: 최근 검색어(현행 유지), 우: 급상승 검색어 Top10 + 순위 변동(`▲3`, `▼1`, `NEW`, `-`). 데이터: `GET /api/v1/search/trending`(§4.3, 1시간 단위 스냅샷 대비). 입력 시 자동완성(현행 `OmSearchBar`) + "카테고리 추천" 그룹 상단 고정.
- **모바일 바텀 네비** 5칸: 홈 / 카테고리 / 검색(전체화면 검색 시트 열기) / 최근 본(최근 본 상품 시트) / 마이. 장바구니는 헤더 우측 아이콘(배지)으로 이동.
- **최근 본 상품**: 데스크톱은 우측 플로팅 미니 바(1440px 이상에서만, 최근 3개 썸네일 + 장바구니 개수 + 맨 위로). 데이터: 비로그인 `localStorage`(최대 50, try/catch), 로그인 `GET /api/v1/me/recently-viewed`(§4.3, 기존 `product_views` 활용).
- 완료 기준: 375~1920 6구간 가로 스크롤 0, 메가메뉴 키보드 탐색(↑↓→←, ESC) 가능, `fa-*` 0건.

#### S-01 홈 — `src/views/HomeView.vue` [수정]

섹션 순서(각 섹션은 데이터가 없으면 통째로 숨김):
1. **히어로 캐러셀** — `OmCarousel`(배너 `GET /api/v1/banners`). 배지 텍스트, 페이지 표시 `2 / 5`, 일시정지 버튼, 인디케이터 점. 데스크톱 높이 360px, 모바일 비율 16:9.
2. **카테고리 숏컷 그리드** — 대분류 중 `product_count > 0` 상위 10개(관리자 `sort_order` 순). 데스크톱 10열 1줄, 모바일 5열 2줄. 아이콘 56px 원형 배경 `surface-2` + 이름 12px.
3. **타임딜(번개특가)** — 헤더: 제목 + `OmCountdown`(campaign.ends_at) + 전체보기. 가로 스크롤 카드 6개(모바일 스냅 스크롤). 카드에 `OmProgress`(소진율) + "N개 남음" — `sold_quantity`가 §4.3 특가 엔진으로 실집계될 때만.
4. **베스트 랭킹** — 탭(전체 + 대분류 상위 6개), 1~10위 카드에 순위 리본. 데이터: `GET /api/v1/products?sort=popular&per_page=10&category=`.
5. **기획전** — 관리자 기획전(§4.2 `exhibitions`) 활성 건마다 배너 + 상품 4~8개.
6. **맞춤 추천** — 로그인 시 `GET /api/v1/recommendations/for-you`(기존), 비로그인은 숨김.
7. **전체 상품(무한 스크롤)** — `GET /api/v1/products?sort=popular&page=N&per_page=40`, IntersectionObserver로 다음 페이지. 클라이언트 전량 정렬 코드 삭제(H-10).
- 완료 기준: 첫 화면 요청 수 ≤ 6, 상품 목록 전량 로드 없음(네트워크 응답 크기 테스트), 캐러셀 일시정지 동작 테스트.

#### S-02 검색 결과 & 카테고리 PLP — `src/views/SearchView.vue`, `src/views/CategoryView.vue` [수정], 공통 [신규 `src/components/plp/PlpLayout.vue`]

- 레이아웃(데스크톱 ≥1024): 브레드크럼 → 제목·결과 수 → [좌 240px `OmFilterPanel`] + [우: 상단 정렬 바 + `OmFilterChips` + 상품 그리드/리스트 + 페이지 하단 무한 스크롤].
- 모바일: 상단 고정 바(필터 버튼(적용 수 배지) / 정렬 셀렉트 / 뷰 전환) → 필터는 `OmBottomSheet(full)`, 하단 "N개 상품 보기" 버튼.
- 필터 그룹(서버 facet `GET /api/v1/products/facets`, §4.3):
  1. 카테고리 트리(현재 카테고리의 하위, 개수 포함)
  2. 가격 범위(슬라이더 + 최소/최대 입력, 서버 min/max)
  3. 브랜드(체크박스, 상위 20 + "더보기" 검색)
  4. 혜택: 무료배송 / 쿠폰 적용 가능 / 할인 상품
  5. 배송: 오늘출발(셀러 출고 마감 시간 기준, §4.2) / 해외직구 제외
  6. 판매자 유형: 올모아 직영 / 입점 판매자
  7. 평점 4점 이상
- 정렬: 추천순(=판매량 가중, 서버 `popular`) / 판매량순 / 최신순 / 낮은가격 / 높은가격 / 리뷰 많은순 / 평점순. 모두 서버 정렬.
- URL 동기화: 모든 필터·정렬·뷰모드를 query string으로(`?q=&category=&brand=a,b&min_price=&max_price=&free_ship=1&sort=&view=list`). 뒤로가기 시 스크롤 위치 복원.
- **상품 카드(`OmProductCard`) 규격**:
  1. 썸네일 1:1, 호버 시 1.05 확대(300ms), 품절이면 `bg-soldout-overlay/60` + "품절" 중앙 표시.
  2. 좌상단 리본: 랭킹 화면은 순위 숫자, 타임딜 상품은 `deal` 배지(진행 중 캠페인 소속일 때만), 직영은 `direct` 배지.
  3. 우하단 원형 버튼 2개: 찜 하트(토글 시 scale 1→1.25→1 200ms, `aria-pressed`), 장바구니 담기(클릭 시 옵션 1개 SKU면 즉시 담기 + 토스트, 옵션이 있으면 `QuickOptionSheet`(데스크톱 모달/모바일 바텀시트) [신규 `src/components/QuickOptionSheet.vue`]에서 옵션 선택 후 담기).
  4. 텍스트: 스토어명(12px muted) → 상품명 2줄 말줄임(14px) → `OmPrice(size=md)` → 배지 줄 → 소셜 프루프 줄.
  5. 배지 표시 조건: `free-ship` = 셀러 배송정책상 1개 구매 시 무료(현행 로직 유지), `fast-ship` = 상품 배송정책 `same_day_cutoff` 존재 + 현재 시각이 마감 전(§4.2), `coupon` = 해당 상품에 적용 가능한 다운로드 쿠폰 존재(§4.2 coupon_targets), `benefit` = 구매확정 적립률(서버 설정값) — 설정값이 없으면 배지 없음.
  6. 소셜 프루프: `OmRating` + "최근 30일 N개 구매"(`order_items` 30일 집계, §4.3 `sold_30d`; 10 미만이면 숨김, 1천 이상은 `1천+` 단위 표기).
- 리스트 뷰: 썸네일 160px 좌측, 우측에 상품명·가격·배지·판매자·배송 안내 1줄.
- 완료 기준: 201번째 상품 노출(페이지 이동 테스트), 필터 조합 URL 왕복 테스트, 모바일 시트 포커스 트랩.

#### S-03 상품 상세 PDP — `src/views/ProductDetailView.vue` [수정], [신규 `src/components/product/BuyPanel.vue`, `SelectedOptionList.vue`, `CouponDownloadModal.vue`, `ReviewHighlights.vue`, `MobileBuySheet.vue`]

- 데스크톱 레이아웃: `grid-cols-[minmax(0,7fr)_minmax(360px,5fr)]` 비대칭.
  - **좌측 열(스크롤)**: `OmImageGallery`(product_images, §4.2) → 포토·동영상 리뷰 하이라이트 바(`ReviewHighlights`: 사진 있는 리뷰 썸네일 가로 8개 + "전체보기", 없으면 숨김) → `OmStickyTabs`(`상품정보` | `리뷰 (N)` | `문의 (N)` | `배송/교환/반품`) → 상품정보 섹션(상품정보제공고시 표 + `OmFoldable(collapsedHeight=1200px)` 상세 HTML) → 리뷰 섹션 → 문의 섹션 → 배송/교환/반품 섹션 → 연관 상품.
  - **우측 열(sticky top: 헤더+16px, 높이 초과 시 내부 스크롤)** `BuyPanel`: 스토어명 링크 + 상품명 + `OmRating`(클릭 시 리뷰 탭) → `OmPrice(size=xl)` → 쿠폰 다운로드 버튼("최대 N원 쿠폰 받기", 적용 가능한 쿠폰 있을 때만 → `CouponDownloadModal`) → 혜택 정보 표(배송비·무료배송 조건·도착 예정·수량 할인·적립 예정) → 옵션 선택기 → **선택 옵션 블록 목록** → 총 상품금액(고정폭, `price-lg`) → CTA 3개(찜 아이콘 / 장바구니 / 바로구매) → `OmSellerCard`(스토어 등급, 평점, 리뷰 수, 응답률, "스토어 홈", "판매자 문의").
- **옵션 선택 로직(다중 조합)**:
  - 속성이 N개면 단계형 드롭다운(1단계 선택 후 2단계 활성). 각 값 옆에 품절 표시, 옵션 추가금액 표시(`+2,000원` = SKU 가격 − 최저 SKU 가격).
  - 마지막 속성 선택 시 해당 SKU를 `SelectedOptionList`에 행으로 추가하고 선택기를 초기화. 이미 있는 SKU면 수량 +1.
  - 행 구성: 옵션명 / `OmQuantityStepper(max=재고)` / 행 금액 / 삭제(X).
  - 총액 = Σ 행 금액(수량 할인은 SKU별 `volumeUnitPrice` 서버 동일 규칙).
  - 장바구니 담기: 모든 행을 한 번에 `cart.addItems(selectedRows)`. 바로구매: 해당 행들만 선택해 `/checkout`.
  - 옵션 없는 상품(SKU 1개): 선택기 없이 행 1개가 기본 존재.
- 상세정보: 고시표는 카테고리 템플릿(§4.2 `notice_templates`) 항목 순서로, 셀러 미입력 항목은 "상세페이지 참조"로 표기(법정 허용 문구).
- 배송/교환/반품 섹션: 상품 배송정책(§4.2) 값으로 표 구성 — 배송방법, 배송비, 무료 조건, 도서산간 추가비, 출고 소요일, 반품/교환 배송비, 반품 주소(판매자 `return_shipping_address`), 청약철회 제한 사유.
- **모바일**: 하단 고정 바(찜 + "구매하기") → 탭 시 `MobileBuySheet`(`OmBottomSheet`, half → 옵션 많으면 full)에 옵션 선택기 + 선택 옵션 목록 + 총액 + [장바구니][바로구매]. 갤러리는 전폭 스와이프, 탭 바는 헤더 아래 sticky.
- 완료 기준: 2개 SKU를 한 번에 담기 E2E, 모바일 시트 열림/닫힘/포커스 복귀, 쿠폰 다운로드 후 버튼 상태 "받음", 이미지 7장 상품 썸네일 전환, 구매 패널 sticky(1440px 스크롤 2000px 후 CTA 뷰포트 내).

#### S-04 장바구니 — `src/views/CartView.vue` [수정], [신규 `src/components/cart/SellerCartGroup.vue`, `FreeShipGauge.vue`]

- 상단: 전체 선택 체크 + "선택 삭제" + "품절 상품 삭제".
- 판매자 그룹 카드(`SellerCartGroup`): 헤더(그룹 선택 체크 · 스토어명 링크 · 직영 배지 · "쿠폰 받기"(스토어 쿠폰 있을 때)) → 품목 행(체크 · 썸네일 · 상품명 · 옵션 · 옵션 변경 버튼(`QuickOptionSheet` 재사용) · 수량 스테퍼 · 금액(할인 전 취소선) · 삭제) → 그룹 푸터: `상품금액 + 배송비 = 주문금액`(고정폭) + `FreeShipGauge`.
- `FreeShipGauge`: 무료배송 기준이 있는 판매자만. 진행률 바 + "4,500원 더 담으면 이 스토어 무료배송" + "이 스토어 상품 더 보기 >"(`/store/:id?free_ship_fill=4500` — 스토어 홈에서 해당 금액 이상 상품 우선 정렬). 이미 무료면 "무료배송 조건 달성" 체크.
- 우측 sticky 요약(현행 유지 + 확장): 총 상품금액 / 즉시할인(수량 할인) / 스토어 쿠폰 할인(예상, 최대) / 플랫폼 쿠폰 할인(예상, 최대) / 배송비 합계 / **결제 예정 금액**(`price-lg`) / 구매확정 시 적립 예정(서버 설정 적립률이 있을 때만). 비로그인은 "예상 금액" 라벨(현행 유지).
- 가격 변동 행: 현행 `repriced` 표시를 "가격이 변경되었습니다 (이전 12,000원 → 11,000원)" 인라인 알림으로.
- 완료 기준: 판매자 2곳 + 무료배송 경계값(threshold−1, threshold) 게이지 표시 테스트.

#### S-05 주문서(체크아웃) — `src/views/CheckoutView.vue` [수정]

- 단계 표시(`CheckoutSteps` 현행) → 좌측: 주문자/배송지(기본 배송지 카드 + "변경" → 배송지 목록 모달, 신규 입력 시 `OmAddressSearch`) → 배송 요청사항(프리셋 + 직접 입력) → 개인통관고유부호(해외 상품 포함 시, 현행) → 판매자별 주문 상품 카드(배송비·도서산간 추가비 표시, 현행) → **쿠폰 영역**: 판매자별 "스토어 쿠폰" 셀렉트 + 주문 전체 "플랫폼 쿠폰" 셀렉트 + "최대 할인 자동 적용" 버튼 → 적립금 사용(보유액, 최대 사용 가능액 = 서버 규칙 20%, 전액 사용 버튼) → 결제수단 → 약관 동의(현행).
- 우측 sticky: 상품금액 / 즉시할인 / 스토어쿠폰 / 플랫폼쿠폰 / 적립금 / 배송비 / 도서산간 / **최종 결제금액** / 적립 예정 / [N원 결제하기] 버튼.
- 서버 견적(`/api/v1/orders/quote`)에 `store_coupons: [{partner_id, user_coupon_id}]`, `platform_coupon_id` 전달(§4.3).
- 완료 기준: 스토어+플랫폼 쿠폰 동시 적용 금액이 서버 견적과 1원 단위 일치(E2E), 우편번호 검색 실패 시 수기 입력 폴백.

#### S-06 결제 결과 — `src/views/PaymentResultView.vue` [수정]
- 성공: 주문번호, 결제금액, 판매자별 배송 예정, [주문 상세] [쇼핑 계속]. 실패: 실패 사유(서버 `failure_code` 매핑), [다시 결제] [장바구니로]. 로컬 함수명 `confirm`을 `confirmPayment`로 변경(린트 오검출 방지).

#### S-07 주문 목록 / 주문 상세 / 클레임 — `src/views/OrdersView.vue`, `src/views/OrderDetailView.vue` [전면 재작성], [신규 `src/components/order/ClaimRequestSheet.vue`, `TrackingTimeline.vue`]

- 주문 목록: 상단 상태 요약(결제완료/상품준비/배송중/배송완료/구매확정 대기 건수, 클릭 필터) → 기간 필터(1/3/6개월, 연도) → 주문 카드(주문일·주문번호 → 판매자별 서브오더 블록 → 품목 행 → 상태별 액션 버튼: 배송조회 / 구매확정 / 취소·반품·교환 신청 / 리뷰 작성 / 판매자 문의). 썸네일 폴백은 `OmImage`(H-01 제거).
- 주문 상세: 결제 정보(수단·금액 분해: 상품/할인/쿠폰/적립금/배송비) → 배송지 → 서브오더별 `TrackingTimeline`(실제 `shipment_tracking_events`·`milestone_tracking_logs`만, 값 없으면 "송장 등록 전" 배지 — H-02/H-03 제거) → 품목별 클레임 상태.
- `ClaimRequestSheet`: 유형(취소/반품/교환) → 품목·수량 선택(부분) → 사유 코드(단순변심/상품불량/오배송/배송지연 등, 서버 `returns.reason_code` 목록) → 귀책에 따른 반품배송비 예상 표시(서버 계산) → 사진 첨부(불량 사유 시 필수) → 수거지 선택 → 제출. 모든 `confirm()`(OrderDetailView 3건) 대체.
- 레거시 팔레트 전량 토큰 이식(H-15).

#### S-08 마이페이지 — `src/views/ProfileView.vue` [전면 재작성], [신규 `src/views/my/MyHomeView.vue`, `MyReviewsView.vue`, `MyQnaView.vue`, `RecentlyViewedView.vue`, `CreditsView.vue`, `FollowedStoresView.vue`]

- `/my` 홈: 회원 요약(이름·등급 없음 — 회원 등급 정책은 PO결정) → 주문 상태 파이프라인 → 바로가기 그리드(쿠폰 N장 / 적립금 N원 / 찜 N / 최근 본 / 팔로우 스토어 / 리뷰 쓰기 N건 / 문의 내역 / 배송지 / 회원정보).
- 라우트 추가: `/my`, `/my/reviews`(작성 가능/작성한 리뷰), `/my/qna`, `/my/recent`, `/my/credits`(적립금 원장 — `GET /api/v1/credits` 기존), `/my/stores`. 기존 `/profile`은 `/my/settings`로 이동하고 리다이렉트 유지.
- 데스크톱: 좌측 마이 메뉴(200px) + 본문. 모바일: 마이 홈이 메뉴 역할.
- `ProfileView`의 `alert()` 5건, `AddressesView`의 `alert()/confirm()` 6건 대체.

#### S-09 스토어 미니샵 — `src/views/SellerStoreView.vue` [수정]
- 헤더: 스토어 배너(§4.2 `partner_store_profiles.banner_url`, 없으면 단색 `surface-2`) + 로고 + 스토어명 + 등급 배지(설정 시) + 평점·리뷰 수 + 팔로워 수 + [팔로우] 버튼 + [문의하기].
- 탭: 홈(대표 상품·공지) / 전체상품(PLP 레이아웃 재사용, `partner_id` 고정 필터) / 리뷰 / 스토어 정보(법정 판매자 고지, 반품지, 배송 정책).
- `free_ship_fill` 쿼리 시 해당 금액 이상 상품을 상단에 "이 상품을 담으면 무료배송" 섹션으로.

#### S-10 번개특가 / 베스트 — `src/views/LightningDealsView.vue`, `src/views/BestSellersView.vue` [수정]
- 번개특가: 상단 캠페인 히어로(제목·`OmCountdown`) → 다음 회차 예고(예정 캠페인 있을 때) → 카드 그리드(소진율 `OmProgress`, 남은 수량 — 실집계일 때만).
- 베스트: 카테고리 탭 + 기간(일간/주간/월간: `order_items` 집계 기간 파라미터, §4.3) + 순위 리본.

#### S-11 인증 — `LoginView`, `RegisterView`, `ForgotPasswordView`, `VerifyEmailView` [유지·점검]
- 이미 토큰 기반. 소셜 버튼 규격(카카오 노란 버튼은 브랜드 가이드 색 예외 허용 목록에 등록), 가입 단계 진행 표시, 14세 확인·약관 동의 이력(기존 d1_36) 유지.

#### S-12 고객센터·약관·정책 — `SupportView`, `LegalTermsView`, `LegalPrivacyView`, `LegalRefundView`, `PolicyView` [수정]
- 고객센터: FAQ 카테고리 탭 + 검색 + 1:1 문의 목록/작성(현행 API). 레거시 팔레트 이식.
- 약관 3종: 목차(앵커) + 시행일 + 이전 버전 보기(`terms_version`). 레거시 팔레트 이식.

#### S-13 쿠폰함 — `src/views/CouponsView.vue` [수정]
- 탭: 사용 가능 / 받을 수 있는 쿠폰 / 사용·만료. 쿠폰 카드에 발급처(올모아/스토어명), 적용 범위(전체/스토어/카테고리/상품), 최소 주문금액, 최대 할인, 만료일 D-day. "받기" 버튼은 `POST /api/v1/coupons/claim`(기존) 확장 사용.

### 3.B 입점 셀러 센터 (`apps/partner`)

#### P-00 셸 — `src/App.vue` [전면 재작성 → `OmConsoleShell`]
- LNB 메뉴 그룹:
  - 홈: 대시보드
  - 상품: 상품 목록 / 상품 등록 / 대량 등록(현 BulkUpload) / URL 수집(현 UrlImport) / 재고·가격 일괄 수정
  - 주문·배송: 발주 확인·발송 처리(현 Shipment 개편) / 배송 현황
  - 클레임: 취소 / 반품 / 교환 (현 ReturnsManage 분할)
  - 정산: 정산 내역 / 출금 신청 / 세금계산서
  - 프로모션: 스토어 쿠폰 / 타임딜 신청
  - 고객: 상품 문의 / 리뷰 관리
  - 스토어: 스토어 꾸미기 / 배송·반품 정책 / 판매자 정보(현 ProfileManage)
  - 확장: 멀티채널(현 MultiChannelListing) / 역경매(현 Bidding)
- 상단 상태 헤더: 스토어명 · 입점 상태 배지(APPROVED/SUSPENDED) · 정산계좌 검증 상태 · 미처리 페널티 수(있을 때 경고) · 판매자 등급(설정 시).
- 라우터 `src/router/index.ts` [수정]: 위 메뉴 경로 추가, 기존 경로는 리다이렉트 유지.

#### P-01 대시보드 — `src/views/DashboardView.vue` [재작성]
- KPI 파이프라인 1줄(각 `OmKpiCard`, 클릭 시 필터된 목록): 신규 주문(결제완료·발주 미확인) / 발송 대기(발주확인·송장 미등록) / 배송 중 / 취소 요청 / 반품 요청 / 교환 요청 / 미답변 문의 / 정산 예정금(다음 지급일). 데이터: `GET /api/v1/partner/dashboard/pipeline`(§4.3).
- 2행: 매출 추이(7/30일 선택, 전기 대비 증감 `OmNumber delta`) + 운영 지표(출고 준수율, 평균 배송일, 클레임률 — 기존 metrics) + 페널티/등급 카드.
- 3행: 처리 필요 목록(지연 출고 임박 주문 Top10, 24시간 넘은 미답변 문의).
- 실패 처리: 카드별 오류 표시(H-13 제거).

#### P-02 상품 목록 — `src/views/ProductManageView.vue` [목록 부분 분리 → 신규 `src/views/products/ProductListView.vue`]
- `OmStatusTabs`: 전체 / 판매중 / 품절 / 승인대기 / 반려 / 판매중지.
- `OmSearchFilterBar`: 상품명, 상품ID, SKU코드, 카테고리, 등록기간(`OmDateRangePicker`), 재고 범위.
- `OmDataTable`(server pagination): 체크 / 썸네일 / 상품명·ID / 카테고리 / 판매가(고정폭) / 재고 합계 / 상태 / 검수 상태 / 등록일 / 고정 액션(수정·복제·판매중지).
- 일괄 처리: 판매중지/재개, 가격 일괄 변경(정액·정률), 재고 일괄 변경, CSV 다운로드.

#### P-03 상품 등록/수정 — 신규 `src/views/products/ProductEditView.vue` (+ `components/product-form/*`)
섹션형 단일 페이지(우측 진행 체크리스트 sticky: 필수 항목 완료 여부):
1. 카테고리 선택(3단 컬럼 선택기 + 검색) → 선택 시 해당 카테고리의 고시 템플릿·수수료율(설정 시 표시) 로드.
2. 상품명(최대 100자, 금칙어 서버 검증), 브랜드, 제조사, 원산지.
3. **이미지**: 대표 1장 + 추가 최대 9장 드래그 정렬(`OmFileUploader` 다건, 기존 `/api/v1/storage/upload`), 최소 해상도 500x500 서버 검증.
4. **옵션 매트릭스**(`OptionMatrixEditor.vue`): 옵션명(최대 3개: 예 색상/사이즈/구성) + 값 입력(칩) → 조합 자동 생성 표(조합 / SKU코드(자동 제안, 수정 가능) / 옵션 추가금액 / 정가 / 판매가 / 재고 / 안전재고 / 사용 여부). 일괄 입력 행(선택 조합에 값 일괄 적용). 단일 상품은 "옵션 없음" 토글.
5. 상세 설명(HTML 에디터 + 이미지 업로드, `[판매자 작성]` 문구 남아 있으면 저장 차단 — H-06).
6. **상품정보제공고시**: 카테고리 템플릿 항목을 폼으로 렌더(필수 항목 표시), "상세페이지 참조" 체크 허용(템플릿이 허용한 항목만).
7. **배송**: 배송비 템플릿 선택(P-10에서 만든 템플릿 셀렉트) + 묶음배송 그룹 + 출고 소요일 + 오늘출발 마감시간(선택).
8. 인증: KC 인증 여부·번호(현행), 해외구매대행 여부(PCCC 필요, 현행 `requires_pccc`).
9. 저장: 임시저장(DRAFT) / 검수 요청(`review_status=PENDING`).
- API: `POST/PUT /api/v1/partner/products`(SKU 배열·이미지 배열 수용으로 확장, §4.3).

#### P-04 발주확인·발송 처리 — `src/views/ShipmentView.vue` [재작성]
- `OmStatusTabs`: 신규주문 / 발주확인 / 발송대기 / 배송중 / 배송완료 / 구매확정.
- 필터: 기간(결제일·발주확인일·발송일 기준 선택), 주문번호, 수취인, 상품명, 택배사.
- 표: 체크 / 주문번호·서브오더번호 / 결제일 / 상품·옵션·수량 / 수취인·연락처(마스킹, 클릭 시 열람 로그 — 기존 `pii_access_log`) / 출고기한(D-1 이하 `urgent`) / 택배사 / 송장번호(인라인 입력) / 상태 / 고정 액션.
- 일괄: 발주확인, 송장 일괄 입력(CSV 업로드: 서브오더번호,택배사코드,송장번호 — 기존 `/partner/orders/bulk-shipment`), 발송 지연 안내(사유+예정일 → 구매자 알림), 주문서 CSV 다운로드.
- 신규 상태 `ORDER_CONFIRMED`(발주확인)는 §4.2 상태 확장 참조.

#### P-05 클레임 관리 — `src/views/ReturnsManageView.vue` [분할 재작성 → `claims/CancelListView.vue`, `ReturnListView.vue`, `ExchangeListView.vue`]
- 공통 표: 요청일 / 주문·품목·수량 / 사유 코드 / 귀책(구매자/판매자) / 반품배송비 / 상태 / 처리기한.
- 취소: 출고 전 취소 요청 승인(즉시 환불 실행 — 기존 refund 서비스) / 거부(이미 출고 시 송장 입력 요구).
- 반품: 수거 요청 → 수거 완료(송장) → 검수(정상/불량, 사진) → 환불 승인 또는 반품 거부(사유) / 귀책 변경 시 반품배송비 재계산.
- 교환: 수거 → 검수 → 재발송 송장 입력(기존 `/partner/returns/:id/reship`).
- `alert()` 2건 대체(H-12).

#### P-06 정산 — `src/views/SettlementView.vue` [재작성] + 신규 `src/views/settlement/PayoutRequestView.vue`, `TaxInvoiceView.vue`
- 정산 요약 카드: 정산 예정(HOLD/PENDING) / 지급 가능(ELIGIBLE_FOR_PAYOUT) / 지급 완료 / 리저브 보류액.
- 정산 내역 표(서브오더 단위): 구매확정일 / 주문번호 / 판매금액 / 판매자 부담 쿠폰 / 수수료(율·액) / PG 수수료(설정 시) / 배송비 / 조정(환불 차감) / **정산액** / 상태. 기간 필터 + CSV.
- 출금 신청: 지급 가능 금액 표시 → 신청 금액(전액 기본) → 등록 계좌(검증 상태) 확인 → 신청(`POST /api/v1/partner/payout-requests`, §4.3) → 신청 내역(대기/승인/이체완료/반려).
- 세금계산서: 기존 `/api/v1/partner/tax-invoices` 목록 + 기간 필터.

#### P-07 프로모션 — 신규 `src/views/promotions/StoreCouponListView.vue`, `StoreCouponEditView.vue`, `DealApplyView.vue`
- 스토어 쿠폰: 유형(정액/정률), 할인값, 최대 할인, 최소 주문, 적용 범위(스토어 전체/선택 상품), 발급 방식(다운로드/자동), 발급 수량, 1인 제한, 유효기간. 부담 주체는 판매자 100%로 고정 표시(분담 쿠폰은 플랫폼이 만든다). 성과: 발급 수, 사용 수, 할인 총액.
- 타임딜 신청: 운영 중인 신청 가능 캠페인 목록 → 상품/SKU 선택 + 딜 가격 + 배정 수량 → 신청(관리자 승인 필요).

#### P-08 문의·리뷰 관리 — `src/views/QnaManageView.vue` [수정], 신규 `src/views/ReviewManageView.vue`
- 문의: 미답변/답변완료 탭, 비밀글 표시, 답변 템플릿(판매자 저장), 24시간 경과 `urgent` 표시.
- 리뷰: 평점 필터, 포토 여부, 판매자 답글 작성(§4.2 `review_replies`), 신고(부적절 리뷰 → 관리자 검토).

#### P-09 스토어 설정 — 신규 `src/views/store/StoreProfileView.vue`, `ShippingPolicyView.vue`; `ProfileManageView.vue` [수정]
- 스토어 꾸미기: 로고, 배너(1920x400), 소개, 공지, 대표 상품 8개 선택.
- **배송·반품 정책(템플릿 다건)**: 템플릿명 / 배송방법(택배·직접배송·해외) / 택배사 / 배송비 유형(무료·유료·조건부무료·수량별) / 기본 배송비 / 무료 기준금액 / 수량별 구간 / 제주·도서산간 추가비(플랫폼 우편번호 존 기본, 템플릿별 금액 덮어쓰기) / 반품배송비(편도) / 교환배송비(왕복) / 출고지·반품지 주소 / 출고 소요일 / 오늘출발 마감시각 / 기본 템플릿 지정.
- 판매자 정보(현 ProfileManage): 사업자 정보 조회, 정산계좌 변경 요청(기존 승인 플로우), CS 연락처.

#### P-10 입점 신청 — `ApplyView.vue`, `ApplicationView.vue` [토큰 이식]
- 단계형(사업자 정보 → 대표자·통신판매업 → 정산계좌 → 서류 업로드 → 약관 동의 → 제출) 진행 표시. 반려 시 사유와 수정 재제출.

#### P-11 확장 화면 — `BiddingView`, `BulkUploadView`, `UrlImportView`, `MultiChannelListingView`, `LoginView` [토큰 이식만]
- 기능 변경 없이 셸·컴포넌트·토큰 이식, `alert()` 대체, 샘플 데이터 격리(H-04, H-05).

### 3.C 플랫폼 통합 어드민 (`apps/admin`)

#### A-00 셸 — `src/App.vue` [전면 재작성 → `OmConsoleShell`]
- LNB 그룹(역할별 노출은 현행 `router/index.ts` `roles` 메타 유지, 서버 RBAC 유지):
  - 대시보드
  - 입점·셀러: 입점 심사 / 셀러 관리 / 페널티·등급
  - 상품: 상품 검수 / 전체 상품 / 카테고리·고시 템플릿·수수료
  - 주문·클레임: 통합 주문 / 클레임·분쟁 조정
  - 정산·재무: 정산 배치 / 지급 승인 / 대사(Reconciliation) / 원장 감사 / 세금계산서
  - 마케팅: 배너 / 기획전 / 타임딜 / 플랫폼 쿠폰 / 알림 발송
  - 고객: 회원 / 1:1 문의 / 리뷰 관리
  - 운영: 사업자 엔티티 / 공급사·발주 / 공급사 연동 / 도서산간 / 기능 플래그
  - 보안: 관리자 계정·2FA / 감사 로그
- 상단 헤더: 운영 사업자(현재 ACTIVE 엔티티명), 환경 배지(SANDBOX/LIVE 결제 모드), 알림, 사용자.

#### A-01 대시보드 — `src/views/DashboardView.vue` [재작성]
- KPI(오늘/어제 대비): 결제 금액(GMV) / 주문 수 / 신규 회원 / 신규 입점 신청 / 검수 대기 상품 / 미처리 클레임 / 분쟁 / 지급 승인 대기 금액 / FDS 검토 대기.
- 처리 대기 큐 표 3개(입점 심사 대기, 상품 검수 대기, 분쟁 접수) — 각 5건 + 바로가기.
- 차트: 30일 GMV·주문 수(라인), 카테고리별 매출 비중(막대). 개별 실패 시 카드 단위 오류(H-13).

#### A-02 입점 심사 — `PartnerApplicationsView.vue` + `PartnerVerifyView.vue` [통합 재작성 → `partners/ApplicationReviewView.vue`, `partners/SellerListView.vue`, `partners/SellerDetailView.vue`]
- 신청 목록: 상태 탭(제출/보완요청/승인/반려) + 기간 + 사업자번호 검색.
- 상세(좌: 신청 정보·서류 뷰어(PDF/이미지, 기존 storage), 우: 체크리스트(사업자등록 진위 — 기존 `/onboarding/validate-business`, 통신판매업, 계좌 실명 일치, 서류 일치) + 위험등급·롤링리저브 설정 + [승인] [보완요청] [반려(사유 필수)]).
- 셀러 상세: 기본 정보 / 정산 계좌(변경 요청 승인) / 수수료(판매자 기본율 + 카테고리 예외) / 페널티 이력 / 등급 / 상품·주문 통계 / 상태 변경(정지·해제, `useConfirm danger`).

#### A-03 상품 검수·전체 상품 — `ProductManageView.vue` [재작성 → `products/ReviewQueueView.vue`, `products/ProductListView.vue`]
- 검수 큐: 이미지·고시·금칙어 자동 점검 결과 표시 + [승인] [반려(사유 템플릿)]. 표시광고 위반 의심 문구(예: "최저가 보장", "100% 정품 보상") 자동 플래그(서버 금칙어 목록).
- 전체 상품: 판매자·카테고리·상태·가격범위·등록기간 필터, 판매중지(사유), CSV.

#### A-04 카테고리·고시·수수료 — `CategoriesView.vue` [재작성]
- 좌측 트리(드래그 정렬, 3단) + 우측 상세 탭: 기본(이름·slug·아이콘 키·노출) / 고시 템플릿(법정 고시 항목 선택·순서) / 수수료(카테고리 기본 수수료율 bps, 비우면 판매자 기본율 적용) / 금칙어.

#### A-05 통합 주문·클레임·분쟁 — `OrdersView.vue`, `LedgerAuditView.vue` 일부 [재작성 → `orders/OrderListView.vue`, `orders/OrderDetailView.vue`, `claims/DisputeListView.vue`]
- 주문 목록(server pagination — `admin.js:257` per_page 활용): 상태 탭, 기간, 주문번호·회원·판매자·상품 검색, CSV.
- 주문 상세: 마스터 → 서브오더 → 품목, 결제·환불 이력, 정산 상태, 원장 분개(기존 journal), 관리자 조치(부분 환불 — 기존 API, `useConfirm danger` + 금액 굵게).
- 분쟁 조정: 기존 `/api/v1/admin/disputes` + 판정(구매자 환불/판매자 손/분담) 화면.

#### A-06 정산 배치·지급·수수료 — `ReconciliationView.vue`, `LedgerAuditView.vue` [재작성 → `finance/SettlementBatchView.vue`, `finance/PayoutApprovalView.vue`]
- 정산 배치: 지급 주기별(현행 `settlement_cycle`) 대상 판매자 목록, 판매자별 정산액 분해(판매금액, 수수료, 판매자 부담 쿠폰, 플랫폼 부담 쿠폰(정보), PG 수수료, 조정, 리저브) → 배치 확정.
- 지급 승인: 셀러 출금 신청 목록 → 승인(기존 payout 생성 API 재사용) / 반려 → 이체 결과 입력(`bank_transfer_ref`).
- 수수료 정책 화면: 판매자 기본율·카테고리율·PG 수수료율(결제수단별) 입력. 값이 없으면 해당 차감 미적용(§0-4).

#### A-07 배너·기획전·타임딜 — `MarketingView.vue` [분할 재작성 → `marketing/BannerView.vue`, `ExhibitionView.vue`, `FlashSaleView.vue`, `NotificationSendView.vue`]
- 배너: 위치(홈 히어로/카테고리 상단), 기간, 순서 드래그, 미리보기(라이트·다크), `bg_gradient` 필드 제거(H-09).
- 기획전: 제목, 배너, 기간, 상품 선택(검색 추가), 노출 순서.
- **타임딜**: 캠페인 생성(제목, 시작·종료), 셀러 신청 승인, 직접 편성(상품·SKU·딜가·배정수량), 진행 현황(실시간 소진율 — §4.3 엔진).
- 알림 발송: 대상(전체/세그먼트), 미리보기, `useConfirm`.

#### A-08 플랫폼 쿠폰 — `CouponsView.vue` [재작성]
- 생성: 발급 주체(플랫폼) / 분담 비율(플랫폼 %, 참여 판매자 %, 기본 플랫폼 100%) / 적용 범위(전체·카테고리·판매자·상품) / 중복 그룹(스토어 쿠폰과 중복 허용 여부) / 발급 방식(다운로드·자동·코드) / 수량 / 1인 제한 / 기간.
- 셀러 쿠폰 감독 탭: 전체 셀러 쿠폰 목록, 정지 권한.
- 성과: 발급·사용·할인총액·분담액.

#### A-09 회원·문의·리뷰 — `UsersView.vue`, `InquiriesView.vue`, `ReviewsView.vue` [재작성]
- 회원: 다중 검색(이메일·이름·전화 블라인드 인덱스 — 기존 d1_49), 가입기간, 상태, 비밀번호 재설정(기존), 탈퇴 처리 이력. 개인정보 열람 시 사유 입력 + 로그(기존 `pii_access_log`).
- 문의: SLA 경과 표시, 담당자 지정, 답변 템플릿.
- 리뷰: 신고된 리뷰 큐, 블라인드(삭제 대신 숨김 + 사유), 판매자 답글 확인.

#### A-10 페널티·등급 — 신규 `src/views/partners/PenaltyGradeView.vue`
- 페널티 규칙(유형: 지연출고/품절취소/허위정보/응답지연, 부과 방식: 점수/금액) — 값은 운영자 입력(PO결정, §0-4).
- 페널티 부과·취소 이력, 판매자 이의 처리.
- 등급 기준(판매액·클레임률·출고준수율 구간) 설정 → 월 1회 배치 산정 결과 확인.

#### A-11 기타 운영 화면 — `BusinessEntitiesView`, `SuppliersView`, `SupplierIntegrationView`, `ShippingZonesView`, `SecurityView`, `AuditLogView`, `LoginView` [토큰 이식]
- 기능 유지, 셸·`OmDataTable`·`useConfirm`·토큰 이식, `SupplierIntegrationView.vue:778` 문구 수정(H-16), 감사 로그 기간 필터·CSV 추가.

---

## 4. 백엔드 API 및 DB 스키마 상세 구현 명세

### 4.1 공통 규칙

- 런타임: `apps/cloudflare-gateway`(Worker) + D1. Go 백엔드는 요청 경로에 없으므로 대상 아님.
- 마이그레이션: `migrations/d1_53_*.sql`부터 순번. 각 파일 끝에 `INSERT INTO schema_migrations` 기록(기존 관례). 마지막 파일명을 `services/orders.js`의 `REQUIRED_SCHEMA_VERSION`에 반영하고 `tests/p2_wave_k_test.mjs` K-1.4(핀↔최신 파일 동기 가드)를 통과시킨다.
- D1 제약: `ALTER TABLE <테이블> ADD COLUMN`만 무중단. CHECK 열거형 변경은 테이블 재생성이 필요하므로 **상태 열거형은 늘리지 않고 타임스탬프 컬럼으로 단계를 표현**한다(예: 발주확인 = `sub_orders.order_confirmed_at`).
- 금액: 모든 금액은 원 단위 정수, `lib/money.js`의 `assertWon`·`applyBps`·`allocate`만 사용. 주문 견적 불변식 `goods − volume − store_coupon − platform_coupon − credit + shipping = pg_total`을 `MONEY_INVARIANT`로 검증(현행 확장).
- 응답 형식: 성공 `{ success: true, data, pagination? }`, 실패 `{ success: false, error: "<한국어 메시지>", code: "<UPPER_SNAKE>" }`. HTTP: 400 검증, 401 미인증, 403 권한, 404 없음/타인 소유(존재 노출 금지), 409 상태 충돌·재고, 422 정책 위반, 429 레이트리밋, 503 `OPERATOR_NOT_CONFIGURED`/`SCHEMA_MISMATCH`.
- 소유권: 파트너 API는 `principal.partnerId`만 신뢰(요청 본문의 `partner_id` 무시). 관리자 API는 `lib/admin-policy.js` 역할 검사 + `admin_audit_log` 기록.
- 멱등성: 금전 이동(출금 신청, 쿠폰 발급, 체크아웃, 환불, 지급)은 `Idempotency-Key` 헤더 필수, `idempotency_keys` 재사용.
- 목록 공통 쿼리 계약(콘솔 API 전부): `page`(1~), `per_page`(1~200, 기본 50), `sort`, `order`(asc|desc), `from`, `to`(KST `YYYY-MM-DD`), `q`, 상태 필터. 응답 `pagination: { page, per_page, total, total_pages }`(카탈로그의 기존 형식과 동일, `routes/catalog.js:210`).
- CSV 내보내기: 같은 목록 엔드포인트에 `format=csv`. 개인정보 열은 마스킹, 비마스킹은 `PRIVACY_OFFICER`/`SUPER_ADMIN`만 + `pii_access_log` 기록. 최대 10,000행.
- OpenAPI: 신규·변경 엔드포인트는 `docs/openapi/paths/*.yaml`에 추가하고 `tests/openapi_reconciliation_test.mjs`를 통과시킨다.

### 4.2 DB 스키마 추가·변경 (DDL)

#### d1_53_catalog_media_notice.sql — 상품 이미지, 카테고리 아이콘/수수료, 고시 템플릿

```sql
CREATE TABLE IF NOT EXISTS product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  url TEXT NOT NULL,                       -- /api/v1/storage/file/<object_key> 형식(자사 스토리지만 허용)
  alt TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 9),
  width INTEGER, height INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (product_id, sort_order)
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id, sort_order);
-- 기존 대표 이미지 이관: 각 상품의 thumbnail_url을 sort_order 0으로
INSERT OR IGNORE INTO product_images (id, product_id, url, sort_order)
  SELECT 'img_' || id || '_0', id, thumbnail_url, 0 FROM products WHERE thumbnail_url IS NOT NULL AND thumbnail_url <> '';

ALTER TABLE categories ADD COLUMN icon_key TEXT;                 -- lucide 아이콘 키, NULL이면 아이콘 없음
ALTER TABLE categories ADD COLUMN commission_rate_bps INTEGER;   -- NULL이면 판매자 기본율(partners.commission_rate_bps)
ALTER TABLE categories ADD COLUMN notice_template_id TEXT;       -- NULL이면 상위 카테고리 상속

CREATE TABLE IF NOT EXISTS notice_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                      -- 예: '의류', '식품(농수산물)', '가전'
  items_json TEXT NOT NULL,                -- [{"key":"material","label":"제품 소재","required":1,"allow_refer":1}]
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE products ADD COLUMN notice_template_id TEXT;
ALTER TABLE products ADD COLUMN notice_template_version INTEGER;
```
- 고시 템플릿 항목 내용(법정 고시 품목별 항목)은 「상품정보제공 고시」 원문 기준으로 운영자가 관리 화면에서 입력한다. 시드는 넣지 않는다(법령 문구를 개발자가 임의 작성하지 않음 — PO결정 항목 PO-08).
- `products.notice_info_json`은 유지하고 키를 템플릿 `key`로 맞춘다. 템플릿 미지정 상품은 현행 자유형 표 그대로 렌더.

#### d1_54_shipping_policies.sql — 배송비 템플릿, 묶음배송, 출고 기한

```sql
CREATE TABLE IF NOT EXISTS shipping_policies (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES partners(id),
  name TEXT NOT NULL,
  ship_method TEXT NOT NULL DEFAULT 'PARCEL' CHECK (ship_method IN ('PARCEL','DIRECT','OVERSEAS')),
  carrier_code TEXT,
  fee_type TEXT NOT NULL CHECK (fee_type IN ('FREE','PAID','CONDITIONAL_FREE','PER_QUANTITY')),
  base_fee INTEGER NOT NULL DEFAULT 0 CHECK (base_fee >= 0),
  free_threshold INTEGER CHECK (free_threshold IS NULL OR free_threshold > 0),   -- CONDITIONAL_FREE 전용
  quantity_step INTEGER CHECK (quantity_step IS NULL OR quantity_step > 0),       -- PER_QUANTITY: N개마다 base_fee 1회
  remote_fee_jeju INTEGER CHECK (remote_fee_jeju IS NULL OR remote_fee_jeju >= 0),     -- NULL이면 플랫폼 shipping_remote_zones 금액
  remote_fee_island INTEGER CHECK (remote_fee_island IS NULL OR remote_fee_island >= 0),
  return_fee_one_way INTEGER NOT NULL DEFAULT 0 CHECK (return_fee_one_way >= 0),
  exchange_fee_round_trip INTEGER NOT NULL DEFAULT 0 CHECK (exchange_fee_round_trip >= 0),
  dispatch_days INTEGER NOT NULL DEFAULT 2 CHECK (dispatch_days BETWEEN 0 AND 14),
  same_day_cutoff TEXT CHECK (same_day_cutoff IS NULL OR same_day_cutoff GLOB '[0-2][0-9]:[0-5][0-9]'), -- KST
  origin_address TEXT, return_address TEXT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (fee_type <> 'CONDITIONAL_FREE' OR free_threshold IS NOT NULL),
  CHECK (fee_type <> 'PER_QUANTITY' OR quantity_step IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipping_policy_default ON shipping_policies(partner_id) WHERE is_default = 1 AND status = 'ACTIVE';
ALTER TABLE products ADD COLUMN shipping_policy_id TEXT;   -- NULL이면 판매자 기본(partners.base_shipping_fee/free_shipping_threshold) = 현행과 동일
ALTER TABLE products ADD COLUMN bundle_group_key TEXT;     -- 같은 키끼리 묶음배송, NULL이면 shipping_policy_id 단위로 묶음
ALTER TABLE sub_orders ADD COLUMN order_confirmed_at TEXT; -- 발주확인
ALTER TABLE sub_orders ADD COLUMN dispatch_due_at TEXT;    -- 결제확인 + dispatch_days(영업일) 
ALTER TABLE sub_orders ADD COLUMN shipping_breakdown_json TEXT; -- [{group_key, policy_id, fee, remote_fee}]
ALTER TABLE order_items ADD COLUMN shipping_group_key TEXT;
```

배송비 계산 규칙(`services/orders.js` 견적 단계, 판매자 그룹 내부를 배송 그룹으로 세분):
1. 배송 그룹 키 = `bundle_group_key ?? shipping_policy_id ?? 'PARTNER_DEFAULT'`.
2. 그룹 정책: `FREE`→0 / `PAID`→`base_fee` / `CONDITIONAL_FREE`→그룹 상품금액(수량할인 후) ≥ `free_threshold`이면 0, 아니면 `base_fee` / `PER_QUANTITY`→`base_fee × ceil(그룹 수량 / quantity_step)`.
3. `PARTNER_DEFAULT`는 현행 규칙 그대로(`threshold > 0 && goods >= threshold ? 0 : base`).
4. 도서산간 추가비는 그룹당 1회: 정책의 `remote_fee_*`가 있으면 그 값, 없으면 현행 `shipping_remote_zones`.
5. 서브오더 `shipping_fee` = Σ 그룹 배송비 + 추가비, 내역은 `shipping_breakdown_json`.
6. 회귀 보장: 정책이 하나도 없는 상품만 담긴 주문은 기존과 1원도 다르지 않아야 한다(골든 테스트: 기존 `tests/full_platform_e2e.mjs` 주문 금액 스냅샷 비교).

#### d1_55_coupon_engine.sql — 셀러/플랫폼 쿠폰, 적용 범위, 분담

```sql
ALTER TABLE coupons ADD COLUMN issuer_type TEXT NOT NULL DEFAULT 'PLATFORM' CHECK (issuer_type IN ('PLATFORM','SELLER'));
ALTER TABLE coupons ADD COLUMN partner_id TEXT REFERENCES partners(id);          -- SELLER 쿠폰의 발급 판매자
ALTER TABLE coupons ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'ALL' CHECK (scope_type IN ('ALL','PARTNER','CATEGORY','PRODUCT'));
ALTER TABLE coupons ADD COLUMN platform_share_bps INTEGER NOT NULL DEFAULT 10000 CHECK (platform_share_bps BETWEEN 0 AND 10000); -- 플랫폼 부담 비율, 나머지는 해당 판매자 부담
ALTER TABLE coupons ADD COLUMN stack_group TEXT NOT NULL DEFAULT 'PLATFORM' CHECK (stack_group IN ('PLATFORM','STORE'));
ALTER TABLE coupons ADD COLUMN issue_type TEXT NOT NULL DEFAULT 'CODE' CHECK (issue_type IN ('DOWNLOAD','AUTO','CODE'));
ALTER TABLE coupons ADD COLUMN total_quantity INTEGER CHECK (total_quantity IS NULL OR total_quantity > 0);
ALTER TABLE coupons ADD COLUMN issued_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coupons ADD COLUMN per_user_limit INTEGER NOT NULL DEFAULT 1 CHECK (per_user_limit >= 1);
ALTER TABLE coupons ADD COLUMN starts_at TEXT;
CREATE TABLE IF NOT EXISTS coupon_targets (
  coupon_id TEXT NOT NULL REFERENCES coupons(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('PARTNER','CATEGORY','PRODUCT')),
  target_id TEXT NOT NULL,
  PRIMARY KEY (coupon_id, target_type, target_id)
);
CREATE TRIGGER IF NOT EXISTS trg_coupon_issue_cap BEFORE UPDATE OF issued_count ON coupons
WHEN NEW.total_quantity IS NOT NULL AND NEW.issued_count > NEW.total_quantity
BEGIN SELECT RAISE(ABORT, 'COUPON_SOLD_OUT'); END;
CREATE TRIGGER IF NOT EXISTS trg_seller_coupon_owner BEFORE INSERT ON coupons
WHEN NEW.issuer_type = 'SELLER' AND (NEW.partner_id IS NULL OR NEW.stack_group <> 'STORE' OR NEW.platform_share_bps <> 0)
BEGIN SELECT RAISE(ABORT, 'SELLER_COUPON_SHAPE'); END;

ALTER TABLE order_items ADD COLUMN store_coupon_alloc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN platform_coupon_alloc INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN seller_coupon_burden INTEGER NOT NULL DEFAULT 0;   -- 이 품목 쿠폰할인 중 판매자 부담분
ALTER TABLE sub_orders ADD COLUMN applied_store_user_coupon_id TEXT;
ALTER TABLE settlements ADD COLUMN seller_coupon_burden INTEGER NOT NULL DEFAULT 0;
```
- 기존 `order_items.coupon_alloc`은 `store_coupon_alloc + platform_coupon_alloc`과 같아야 한다(트리거 또는 테스트 불변식). 기존 행은 `platform_coupon_alloc = coupon_alloc`으로 백필.

쿠폰 적용 규칙(견적·체크아웃 공통, 서버 단일 함수 `services/coupons.js` 신규):
1. 주문당 플랫폼 쿠폰(`stack_group='PLATFORM'`) 최대 1장 + 판매자(서브오더)당 스토어 쿠폰(`stack_group='STORE'`) 최대 1장.
2. 적용 순서: 수량할인 → 스토어 쿠폰(해당 판매자의 적용 대상 품목 합계 기준) → 플랫폼 쿠폰(적용 대상 품목의 스토어 쿠폰 차감 후 합계 기준). 각 쿠폰 금액은 `min(계산액, max_discount_amount, 대상 합계)`.
3. 적용 대상: `scope_type`과 `coupon_targets`로 품목 필터. 대상 합계 < `min_order_amount`이면 422 `COUPON_MIN_ORDER`.
4. 품목 배분: `allocate(쿠폰액, 대상 품목 lineTotal[])`(현행 함수).
5. 판매자 부담: 스토어 쿠폰은 100% 판매자. 플랫폼 쿠폰은 `round(alloc × (10000 − platform_share_bps) / 10000)`만 해당 품목 판매자 부담(`allocate`로 잔차 보정).
6. 회계 분개(`services/orders.js` 결제 확정 분개 확장): 플랫폼 부담분 → `PROMOTION_EXPENSE` 차변(현행), 판매자 부담분 → 판매자 미지급금(seller payable) 감소. 기존 분개 함수의 대차 일치 테스트 유지.
7. 환불: 기존 `proportionalPortion`으로 품목별 쿠폰 환원액을 계산할 때 스토어/플랫폼 몫을 각각 비례 환원하고 `settlement_adjustments`에 판매자 부담분 환원을 반영.
8. 하위 호환: 요청 본문 `user_coupon_id`/`coupon_code`는 플랫폼 쿠폰으로 해석(현 앱 호환).

#### d1_56_settlement_payout_policy.sql — 정책 값, PG 수수료, 출금 신청

```sql
CREATE TABLE IF NOT EXISTS platform_policies (
  key TEXT PRIMARY KEY,           -- 'pg_fee_bps.CARD', 'pg_fee_bps.TRANSFER', 'commission_base', 'purchase_confirm_credit_bps'
  value_json TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS platform_policy_history (
  id TEXT PRIMARY KEY, key TEXT NOT NULL, old_value_json TEXT, new_value_json TEXT NOT NULL,
  changed_by TEXT NOT NULL, changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE settlements ADD COLUMN pg_fee_bps INTEGER;            -- NULL = 정책 미설정, 차감 없음
ALTER TABLE settlements ADD COLUMN pg_fee_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settlements ADD COLUMN commission_source TEXT;        -- 'PARTNER' | 'CATEGORY'
CREATE TABLE IF NOT EXISTS payout_requests (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES partners(id),
  operator_entity_id TEXT REFERENCES business_entities(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED','TRANSFERRED','CANCELLED')),
  bank_snapshot_hash TEXT NOT NULL,     -- 신청 시점 계좌 정보 해시(평문 저장 금지)
  idempotency_key TEXT NOT NULL UNIQUE,
  payout_id TEXT REFERENCES payouts(id),
  reject_reason TEXT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by TEXT, decided_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_request_open ON payout_requests(partner_id) WHERE status = 'REQUESTED';
```
정산액 계산(설정이 있는 항목만 차감, 없으면 현행과 동일):
`net = gross − commission − seller_coupon_burden − pg_fee_amount + shipping_fee + Σ adjustments`
- `commission` = `applyBps(commission_base 금액, rate_bps)`. `rate_bps` = `categories.commission_rate_bps`(상품 카테고리, 없으면 상위) ?? `partners.commission_rate_bps`. 품목 단위 계산 후 합산(카테고리가 섞인 서브오더 대응), `commission_source` 기록.
- `commission_base`: 정책 `'GROSS'`(현행: 판매금액) 또는 `'NET_OF_SELLER_DISCOUNT'`. 정책 미설정이면 `'GROSS'`(현행 유지).
- `pg_fee_amount` = `applyBps(서브오더 pg_alloc 합계, pg_fee_bps[결제수단])`. 정책 미설정이면 0. PG 수수료를 판매자에게 전가할지는 PO결정(PO-03).
- 출금 신청 가능액 = `ELIGIBLE_FOR_PAYOUT` 정산 합 − 리저브 보류 − 진행 중 신청액. 관리자 승인 시 기존 지급(`/api/v1/admin/finance/payouts`, 멱등 키) 로직을 호출해 `payouts` 생성 후 `payout_id` 연결.

#### d1_57_reviews_social.sql — 리뷰 도움돼요·답글·신고, 스토어 팔로우·프로필

```sql
CREATE TABLE IF NOT EXISTS review_helpful_votes (
  review_id TEXT NOT NULL REFERENCES product_reviews(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (review_id, user_id)
);
CREATE TABLE IF NOT EXISTS review_replies (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL UNIQUE REFERENCES product_reviews(id),
  partner_id TEXT NOT NULL REFERENCES partners(id),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS review_reports (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES product_reviews(id),
  reporter_type TEXT NOT NULL CHECK (reporter_type IN ('USER','PARTNER')),
  reporter_id TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK (reason_code IN ('ABUSE','PRIVACY','SPAM','UNRELATED','OTHER')),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','UPHELD','DISMISSED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (review_id, reporter_type, reporter_id)
);
ALTER TABLE product_reviews ADD COLUMN visibility TEXT NOT NULL DEFAULT 'VISIBLE' CHECK (visibility IN ('VISIBLE','BLINDED'));
ALTER TABLE product_reviews ADD COLUMN blind_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_reviews_product_visible ON product_reviews(product_id, visibility, created_at);
CREATE TABLE IF NOT EXISTS store_follows (
  user_id TEXT NOT NULL REFERENCES users(id),
  partner_id TEXT NOT NULL REFERENCES partners(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, partner_id)
);
CREATE TABLE IF NOT EXISTS partner_store_profiles (
  partner_id TEXT PRIMARY KEY REFERENCES partners(id),
  logo_url TEXT, banner_url TEXT,
  intro TEXT CHECK (intro IS NULL OR length(intro) <= 1000),
  notice TEXT CHECK (notice IS NULL OR length(notice) <= 2000),
  featured_product_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS restock_subscriptions (
  user_id TEXT NOT NULL REFERENCES users(id),
  sku_id TEXT NOT NULL REFERENCES product_skus(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notified_at TEXT,
  PRIMARY KEY (user_id, sku_id)
);
```
- `product_reviews.helpful_count`는 `review_helpful_votes` 삽입/삭제와 같은 batch에서 증감(투표 테이블이 원천, 카운트는 캐시).
- 별점 평균: 현재 상품 목록 쿼리마다 상관 서브쿼리로 계산(`routes/catalog.js:159-160`) → `products`에 `rating_avg_x10 INTEGER`, `review_count INTEGER` 캐시 컬럼 추가 후 리뷰 쓰기/블라인드 시 갱신(목록 성능, 정렬 `rating`·`reviews`에 사용).

#### d1_58_promotions.sql — 타임딜 엔진, 기획전

```sql
-- flash_sale_items.deal_price(NOT NULL)는 d1 초기 스키마에 이미 있으나 현재 체크아웃이 사용하지 않음(routes/features.js:96 주석)
ALTER TABLE flash_sale_items ADD COLUMN status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('APPLIED','APPROVED','REJECTED'));
ALTER TABLE flash_sale_items ADD COLUMN applied_by_partner_id TEXT;
ALTER TABLE order_items ADD COLUMN flash_sale_item_id TEXT;
CREATE TRIGGER IF NOT EXISTS trg_flash_sold_cap BEFORE UPDATE OF sold_stock ON flash_sale_items
WHEN NEW.sold_stock < 0 OR NEW.sold_stock > NEW.allocated_stock
BEGIN SELECT RAISE(ABORT, 'FLASH_SALE_SOLD_OUT'); END;
CREATE TABLE IF NOT EXISTS exhibitions (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT, banner_url TEXT,
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','ENDED')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS exhibition_products (
  exhibition_id TEXT NOT NULL REFERENCES exhibitions(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (exhibition_id, product_id)
);
```
타임딜 가격 엔진(`services/orders.js` 견적):
1. 진행 중 캠페인(`status='ACTIVE' AND starts_at <= now < ends_at`)의 `APPROVED` 항목이 견적 SKU와 일치하면 단가 = `deal_price`(수량할인은 딜 상품에 적용하지 않음 — PO결정 PO-06, 기본 미적용).
2. 체크아웃 batch에 `UPDATE flash_sale_items SET sold_stock = sold_stock + ?`를 포함(트리거로 초과 방지 → 409 `FLASH_SALE_SOLD_OUT`).
3. 취소·만료·환불 재입고 경로(현 `services/orders.js:537` 재고 복원 부분)에서 `order_items.flash_sale_item_id`가 있으면 `sold_stock` 차감.
4. 그 결과 `GET /api/v1/campaigns/lightning`의 `sold_quantity`/`sold_percent`/`remaining_stock`이 실집계가 된다(H-08 해소). 캠페인 기간 외에는 딜가 적용 금지.
5. 표시광고 준수: 딜가의 할인율 기준가는 SKU `original_price`. 가격 이력(§5 K-13)으로 기준가 부풀리기 검출.

#### d1_59_seller_grade_penalty.sql — 페널티 규칙·등급

```sql
CREATE TABLE IF NOT EXISTS penalty_rules (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,                -- LATE_DISPATCH, SELLER_CANCEL, FALSE_INFO, QNA_DELAY
  label TEXT NOT NULL,
  points INTEGER CHECK (points IS NULL OR points >= 0),
  amount INTEGER CHECK (amount IS NULL OR amount >= 0),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),  -- 운영자가 값 입력 후 활성화
  updated_by TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE partner_penalties ADD COLUMN rule_code TEXT;
ALTER TABLE partner_penalties ADD COLUMN points INTEGER NOT NULL DEFAULT 0;
ALTER TABLE partner_penalties ADD COLUMN appeal_note TEXT;
ALTER TABLE partner_penalties ADD COLUMN decided_by TEXT;
CREATE TABLE IF NOT EXISTS grade_policies (
  code TEXT PRIMARY KEY, label TEXT NOT NULL, sort_order INTEGER NOT NULL,
  min_sales_amount INTEGER, max_claim_rate_bps INTEGER, min_ontime_rate_bps INTEGER, max_penalty_points INTEGER,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1))
);
CREATE TABLE IF NOT EXISTS partner_grades (
  partner_id TEXT NOT NULL REFERENCES partners(id),
  period TEXT NOT NULL,                     -- 'YYYY-MM'
  grade_code TEXT,                          -- 정책이 없으면 NULL(배지 미표시)
  metrics_json TEXT NOT NULL,               -- {"sales":12500000,"claim_rate_bps":180,"ontime_rate_bps":9650,"penalty_points":2}
  computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (partner_id, period)
);
```
- `partner_penalties.status` 기존 기본값 `'DEDUCTED'`는 유지. 새 레코드는 `'ACTIVE'`/`'CANCELLED'`/`'APPEALED'` 문자열을 사용(기존 CHECK 없음 확인 후).
- 등급 산정: 월 1회 크론(`scheduled` 핸들러, 기존 `index.js`의 `expireStaleOrders`와 같은 위치)에서 전월 지표 계산. 정책 비활성 시 `grade_code=NULL`.

#### d1_60_search_trending_recent.sql — 급상승 검색어, 최근 본 상품

```sql
CREATE TABLE IF NOT EXISTS search_keyword_hourly (
  keyword TEXT NOT NULL,
  hour_bucket TEXT NOT NULL,                -- 'YYYY-MM-DDTHH' (KST)
  search_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (keyword, hour_bucket)
);
CREATE INDEX IF NOT EXISTS idx_search_hourly_bucket ON search_keyword_hourly(hour_bucket);
CREATE INDEX IF NOT EXISTS idx_product_views_user_recent ON product_views(user_id, viewed_at); -- product_views는 d1_51 정의(user_id, product_id, day, viewed_at)
```
- `POST /api/v1/search/log`(기존)에서 시간 버킷 upsert 추가. 7일 지난 버킷은 일일 크론에서 삭제.
- 급상승 = 최근 24시간 합계 순위 Top10, 변동 = 직전 24시간 순위와 비교(`NEW`/`▲n`/`▼n`/`-`). 최소 검색 수(정책 `trending_min_count`, 기본 미설정 시 5) 미만 키워드 제외 — 소수 검색으로 순위 조작 방지. 금칙어 필터 적용.

#### 상품 가격 이력 (d1_60에 포함)
```sql
CREATE TABLE IF NOT EXISTS sku_price_history (
  id TEXT PRIMARY KEY,
  sku_id TEXT NOT NULL REFERENCES product_skus(id),
  original_price INTEGER NOT NULL, sale_price INTEGER NOT NULL,
  changed_by TEXT NOT NULL,                 -- partner user id / admin id / 'system'
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sku_price_history ON sku_price_history(sku_id, changed_at);
```
- 파트너 가격 변경 경로(`routes/partner.js:289,297,325,329`)와 역경매 낙찰 가격 반영(`routes/bidding-m2c.js:259`)에서 같은 batch로 이력 삽입.

#### 클레임 단계 컬럼 (d1_54에 포함, `returns`에 없는 것만 추가 — 작성 시 `PRAGMA table_info(returns)`로 확인)
`pickup_requested_at`, `pickup_carrier`, `pickup_tracking_number`, `picked_up_at`, `inspected_at`, `inspection_result`(`'OK'|'DEFECT'|'MISMATCH'`), `inspection_note`, `inspection_photo_urls_json`.

### 4.3 REST API 명세 (신규·확장)

인증 표기: `Public` / `Buyer`(구매자 JWT) / `Partner`(승인된 파트너) / `Admin[역할]`.

#### 4.3.1 카탈로그·탐색

| 메서드 경로 | 인증 | 요청 | 응답 `data` | 오류 |
|---|---|---|---|---|
| `GET /api/v1/products` (확장) | Public | 기존 `q, category, sort, min_price, max_price, page, per_page, partner_id` + **`brand`(csv, 최대 10), `free_ship=1`, `coupon=1`, `seller_type=DIRECT\|MARKETPLACE`, `rating_gte=4`, `fast_ship=1`, `exhibition_id`**. `sort`에 `reviews`, `rating` 추가 | 기존 배열 + 각 상품에 `sold_30d`(10 미만이면 null), `badges: { free_ship, fast_ship, coupon, direct, deal }`(서버 계산 boolean), `rating_avg`, `review_count`(캐시 컬럼) | 400 `INVALID_FILTER`(범위 밖 값) |
| `GET /api/v1/products/facets` | Public | `q, category`(+ 현재 적용 필터) | `{ categories:[{slug,name,count}], brands:[{name,count}](상위 20), price:{min,max}, flags:{free_ship,coupon,direct,fast_ship} }` | 400 |
| `GET /api/v1/products/:id` (확장) | Public | — | 기존 + `images:[{url,alt}]`, `shipping_policy:{fee_type,base_fee,free_threshold,quantity_step,dispatch_days,same_day_cutoff,return_fee_one_way,exchange_fee_round_trip}`, `notice:{template:{id,version,items}, values}`, `seller:{id,name,grade_code,rating_avg,review_count,follower_count,qna_response_rate_bps}`, `coupon_summary:{max_discount, count}` | 404 |
| `GET /api/v1/products/:id/coupons` | Public(로그인 시 `claimed` 포함) | — | `[{coupon_id,title,issuer_type,partner_name,discount_type,discount_value,max_discount_amount,min_order_amount,expires_at,remaining,claimed}]` | 404 |
| `GET /api/v1/products/:id/reviews` (확장) | Public | `page, per_page(≤50), sort=recent\|helpful\|rating_desc\|rating_asc, photo_only=1, rating=1..5, option=` | `{ items:[{ 기존 리뷰 필드 전체, helpful_count, voted_by_me, reply:{content,created_at}|null }], summary:{avg,count,dist:{1..5},photo_count,fit:{SMALL,TRUE,LARGE}} }` + `pagination`. `BLINDED` 제외 | 404 |
| `GET /api/v1/search/trending` | Public | — | `[{rank,keyword,delta:'NEW'\|number\|0}]` 최대 10 | — |
| `GET /api/v1/categories` (확장) | Public | — | 각 카테고리에 `icon_key` | — |
| `GET /api/v1/exhibitions`, `GET /api/v1/exhibitions/:id` | Public | `page` | 활성 기획전 / 기획전 + 상품 목록 | 404 |
| `GET /api/v1/partners/:id/store` (확장) | Public | — | 기존 + `profile:{logo_url,banner_url,intro,notice,featured_products}`, `follower_count`, `grade_code`, `shipping_policies`(요약), 법정 판매자 정보 | 404 |

#### 4.3.2 구매자

| 메서드 경로 | 인증 | 요청 | 응답/규칙 | 오류 |
|---|---|---|---|---|
| `POST /api/v1/stores/:partnerId/follow` / `DELETE` | Buyer | — | `{ following: boolean, follower_count }` | 404 |
| `GET /api/v1/me/followed-stores` | Buyer | `page` | 스토어 카드 목록 | — |
| `GET /api/v1/me/recently-viewed` / `DELETE /api/v1/me/recently-viewed/:productId` | Buyer | `limit≤50` | 최근 조회 상품(판매 중인 것만) | — |
| `POST /api/v1/me/recently-viewed/merge` | Buyer | `{ product_ids: string[] ≤50 }` | 로그인 직후 로컬 기록 병합 | 400 |
| `POST /api/v1/reviews/:id/helpful` | Buyer | — | 토글, `{ voted, helpful_count }`. 본인 리뷰는 403 `SELF_VOTE` | 403, 404 |
| `POST /api/v1/reviews/:id/report` | Buyer | `{ reason_code, note? ≤500 }` | 중복 신고 409 | 409 |
| `POST /api/v1/coupons/claim` (확장) | Buyer | `{ coupon_id }` 또는 기존 `{ code }`, 헤더 `Idempotency-Key` | `issue_type='DOWNLOAD'`만 다운로드 가능, `per_user_limit`·`total_quantity`(트리거) 검사 | 409 `COUPON_SOLD_OUT`, 409 `COUPON_LIMIT`, 422 `COUPON_NOT_STARTED`/`COUPON_EXPIRED` |
| `GET /api/v1/coupons` (확장) | Buyer | `status=usable\|claimable\|used` | 각 쿠폰 `issuer_type, partner_name, scope_type, targets_summary` | — |
| `POST /api/v1/orders/quote`, `POST /api/v1/orders/checkout` (확장) | Buyer | 기존 + `platform_user_coupon_id?`, `store_coupons?: [{partner_id, user_coupon_id}]`. 기존 `user_coupon_id`는 플랫폼 쿠폰으로 해석 | 견적 응답에 `sub_orders[].store_coupon_discount`, `sub_orders[].shipping_breakdown`, `platform_coupon_discount`, `expected_credit`(정책 설정 시), 품목별 `flash_sale_item_id` | 422 `COUPON_NOT_APPLICABLE`/`COUPON_MIN_ORDER`/`COUPON_STACK`, 409 `FLASH_SALE_SOLD_OUT`, 409 `STOCK_INSUFFICIENT`(기존) |
| `GET /api/v1/coupons/best` | Buyer | `{ items }`와 같은 장바구니 본문(POST로 구현) | 쿠폰 조합 중 최대 할인 조합(스토어별 1장 + 플랫폼 1장) 계산 결과 | — |
| `POST /api/v1/orders/:id/claims` (확장, 기존 `routes/orders.js:166`) | Buyer | 기존 + `pickup_address_id?`, `photo_urls?` | 귀책 `faultOf(reason_code)`(기존 `services/claims.js`) 기준 반품배송비 미리 계산해 응답 | 기존 |
| `POST /api/v1/restock-subscriptions` / `DELETE` | Buyer | `{ sku_id }` | 품절 SKU만 구독 가능, 재입고 시 인앱 알림 1회 | 409 `NOT_SOLD_OUT` |

#### 4.3.3 파트너(셀러센터)

| 메서드 경로 | 요청 | 응답/규칙 | 오류 |
|---|---|---|---|
| `GET /api/v1/partner/dashboard/pipeline` | — | `{ new_orders, to_dispatch, dispatch_due_today, in_transit, cancel_requests, return_requests, exchange_requests, unanswered_qna, unanswered_qna_over_24h, settlement:{pending, eligible, next_payout_date}, penalties_active, grade_code }` — 각 값은 해당 목록 API와 같은 WHERE 조건의 COUNT(카드 클릭 시 동일 결과 보장) | 403 |
| `GET /api/v1/partner/orders` (확장) | `status, date_field=paid\|confirmed\|shipped, from, to, q(주문번호/수취인/상품명), carrier, page, per_page, format=csv` | 공통 목록 계약. 수취인 연락처는 마스킹, `?reveal=1`은 사유 필수 + `pii_access_log` | 400 |
| `PUT /api/v1/partner/orders/confirm` | `{ sub_order_ids: string[] ≤200 }` | `order_confirmed_at` 기록, `dispatch_due_at` 계산. 본인 소유 + `PAYMENT_CONFIRMED`만, 아니면 해당 ID를 `failed[]`로 반환(부분 성공) | 403 |
| `PUT /api/v1/partner/orders/:subOrderId/delay-notice` | `{ reason_code, new_due_date }` | 구매자 알림 발송, 지연 이력 기록. 새 예정일은 기존보다 늦고 14일 이내 | 422 |
| `GET/POST/PUT/DELETE /api/v1/partner/shipping-policies[/:id]` | §4.2 컬럼 | DELETE는 사용 중 상품이 있으면 409 `POLICY_IN_USE`(보관 처리 유도) | 409 |
| `POST /api/v1/partner/products`, `PUT /api/v1/partner/products/:id` (확장) | 기존 + `images: [{url, alt}] ≤10`, `options: [{name, values[]}] ≤3`, `skus: [{option_combination, sku_code?, original_price, sale_price, stock_quantity, safety_stock, is_active}] ≤200`, `notice_template_id`, `notice_values`, `shipping_policy_id`, `bundle_group_key` | 서버 검증: 조합 수 = Π(값 수) 이하·중복 금지, `sale_price ≤ original_price`, 이미지 URL은 `/api/v1/storage/file/` 자사 경로만, 설명 HTML `sanitizeHtml`(현행) + `[판매자 작성]` 포함 시 422 `TEMPLATE_TEXT_LEFT`, 템플릿 필수 항목 누락 시 422 `NOTICE_REQUIRED`, 가격 변경 시 `sku_price_history` 기록. 한 batch로 원자 저장 | 400, 422 |
| `PUT /api/v1/partner/products/bulk-update` (신규 — 기존 `POST /api/v1/partner/products/bulk`는 CSV 대량 등록이므로 분리) | `{ product_ids ≤500, action: 'status'\|'price'\|'stock', status?, price_mode?: 'set'\|'rate'\|'delta', value? }` | 부분 성공 `{ updated, failed:[{id, code}] }` | 400 |
| `GET/POST/PUT /api/v1/partner/coupons[/:id]` | 쿠폰 필드(§4.2), `issuer_type`·`partner_id`·`stack_group`·`platform_share_bps`는 서버가 강제(SELLER/본인/STORE/0) | 발급 시작 후에는 할인값·범위 수정 불가(409), 중지만 가능 | 409 |
| `GET /api/v1/partner/flash-sales` · `POST /api/v1/partner/flash-sales/:campaignId/apply` | `{ items:[{sku_id, deal_price, allocated_stock}] }` | `deal_price < sale_price`, `allocated_stock ≤ 현재 재고`, 신청 상태 `APPLIED` | 422 |
| `GET /api/v1/partner/payout-requests` · `POST` | POST `{ amount }` + `Idempotency-Key` | 가능액 초과 422 `PAYOUT_EXCEEDS_AVAILABLE`, 계좌 미검증 422 `PAYOUT_ACCOUNT_UNVERIFIED`, 진행 중 신청 존재 409 `PAYOUT_REQUEST_OPEN` | 409, 422 |
| `POST /api/v1/partner/payout-requests/:id/cancel` | — | `REQUESTED`만 | 409 |
| `GET/PUT /api/v1/partner/store-profile` | §4.2 `partner_store_profiles` | 대표 상품은 본인 ACTIVE 상품만 | 422 |
| `PUT /api/v1/partner/reviews/:id/reply` · `DELETE` | `{ content ≤2000 }` | 본인 상품 리뷰만 | 404 |
| `POST /api/v1/partner/reviews/:id/report` | `{ reason_code, note }` | — | 409 |
| `GET /api/v1/partner/penalties` · `POST /api/v1/partner/penalties/:id/appeal` | `{ note ≤1000 }` | `ACTIVE`만 이의 가능 → `APPEALED` | 409 |
| `GET /api/v1/partner/returns` (확장) | `type=CANCEL\|RETURN\|EXCHANGE, status, from, to, page` | — | — |
| `PUT /api/v1/partner/returns/:id/pickup` · `/inspect` | pickup `{ carrier_code, tracking_number }`, inspect `{ result, note, photo_urls ≤5 }` | 단계 순서 강제(요청→수거→검수→환불/거부). 검수 `DEFECT`·`MISMATCH`면 귀책 판매자로 반품배송비 재계산 | 409 `CLAIM_STEP` |

#### 4.3.4 관리자

| 메서드 경로 | 역할 | 요청 | 규칙 |
|---|---|---|---|
| `GET /api/v1/admin/dashboard` (확장) | 대시보드 접근 역할 | `date` | KPI + 대기 큐 count(입점 심사, 상품 검수, 분쟁, 지급 신청, FDS 검토) |
| `GET/POST/PUT /api/v1/admin/notice-templates[/:id]` | SUPER_ADMIN, OPERATIONS | `{ name, items }` | 수정 시 `version+1`, 기존 상품은 이전 버전 유지 |
| `PUT /api/v1/admin/categories/:id` (확장) | SUPER_ADMIN, OPERATIONS | `icon_key, commission_rate_bps(0~3000), notice_template_id` | 수수료 변경은 신규 주문부터 적용, `admin_audit_log` |
| `GET/PUT /api/v1/admin/platform-policies[/:key]` | SUPER_ADMIN, FINANCE | `{ value_json, effective_from }` | 이력 테이블 기록, 미래 시점만 허용(소급 금지) |
| `GET/POST/PUT /api/v1/admin/flash-sales[/:id]`, `PUT /api/v1/admin/flash-sales/:id/items/:itemId` | SUPER_ADMIN, OPERATIONS | 캠페인 필드 / `{ status: APPROVED\|REJECTED, reason? }` | 진행 중 캠페인의 딜가 변경 금지(409) |
| `GET/POST/PUT /api/v1/admin/exhibitions[/:id]` | SUPER_ADMIN, OPERATIONS | — | — |
| `POST/PUT /api/v1/admin/coupons` (확장) | SUPER_ADMIN, OPERATIONS | §4.2 필드, `issuer_type='PLATFORM'` 강제 | `platform_share_bps < 10000`이면 대상 판매자 범위(`scope_type=PARTNER` 등) 필수 + 참여 동의 기록(PO-04) |
| `PUT /api/v1/admin/coupons/:id/suspend` | SUPER_ADMIN, OPERATIONS | — | 셀러 쿠폰 포함 정지 |
| `GET /api/v1/admin/payout-requests` · `PUT /api/v1/admin/payout-requests/:id` | SUPER_ADMIN, FINANCE | `{ action: APPROVE\|REJECT\|MARK_TRANSFERRED, reason?, bank_transfer_ref? }` + `Idempotency-Key` | APPROVE는 기존 지급 생성 로직 호출, 2인 승인 옵션(정책 `payout_dual_approval`) |
| `GET/PUT /api/v1/admin/penalty-rules`, `POST /api/v1/admin/partners/:id/penalties`, `PUT /api/v1/admin/penalties/:id` | SUPER_ADMIN, OPERATIONS | 부과 `{ rule_code, sub_order_id?, reason }`, 결정 `{ status, note }` | 규칙 비활성 시 부과 불가 422 |
| `GET/PUT /api/v1/admin/grade-policies`, `POST /api/v1/admin/grades/compute` | SUPER_ADMIN, OPERATIONS | `{ period }` | 재계산은 멱등(같은 period upsert) |
| `GET /api/v1/admin/review-reports` · `PUT /api/v1/admin/reviews/:id/visibility` | SUPER_ADMIN, OPERATIONS, CS | `{ visibility, reason }` | 삭제 대신 블라인드, 감사 로그 |
| 관리자 목록 전체(`/admin/orders`, `/admin/products`, `/admin/users`, `/admin/partners`, `/admin/reviews`, `/admin/inquiries`, `/admin/audit-log`) | 기존 | 공통 목록 계약(§4.1) + `format=csv` | 현재 `LIMIT 100/150/500` 고정 쿼리(`routes/admin.js:54,81,114,180`)를 페이지네이션으로 교체 |

### 4.4 보안·검증 체크리스트 (모든 신규 엔드포인트 공통 테스트)

1. 미인증 401, 타 역할 403, **타 판매자 리소스 접근은 404**(존재 은닉) — `tests/security_integrity.mjs`에 엔드포인트별 IDOR 케이스 추가.
2. 금액 필드 음수·소수·문자열·`Number.MAX_SAFE_INTEGER` 초과 → 400.
3. 배열 길이 상한 초과 → 400 (`tests/input_abuse_guards_test.mjs` 확장).
4. 쿠폰 경합: 같은 쿠폰 동시 발급 100회 → `issued_count ≤ total_quantity`(트리거) 검증.
5. 타임딜 경합: 배정 수량 1개에 동시 체크아웃 2건 → 1건 409.
6. 출금 신청 경합: 같은 `Idempotency-Key` 재요청 → 동일 응답, 다른 키 동시 2건 → 1건 409.
7. 정산 불변식 2종: (a) 모든 정산 행에서 `gross_amount − commission_amount − seller_coupon_burden − pg_fee_amount + shipping_fee + Σ settlement_adjustments.net_delta = 실효 정산액`이 성립, (b) 테스트 주문 집합을 결제·부분환불·구매확정까지 진행한 뒤 시산표(`/api/v1/admin/finance/trial-balance`) 차변 합계 = 대변 합계, 그리고 계정 `PROMOTION_EXPENSE` 잔액 = Σ(플랫폼 부담 쿠폰 할인액 − 환불로 환원된 플랫폼 부담분).
8. 레이트리밋 분류(`lib/ratelimit.js` `classify`)에 신규 경로 등록: 쿠폰 발급·리뷰 투표·신고·팔로우는 사용자당 분당 30회.
9. 감사 로그: 관리자 변경 API 전부 `admin_audit_log`에 before/after.

---

## 5. 아키텍트 & 리드 디자이너 직권 필수 추가 항목 (전환율·신뢰도)

모든 항목은 §0-3(실데이터만)을 지킨다. 데이터가 없으면 해당 UI는 표시하지 않는다.

| ID | 기능 | 근거 데이터 | 구현 위치 | 우선순위 |
|---|---|---|---|---|
| K-01 | 상품 카드 옵션 퀵담기(바텀시트) | SKU/재고 | S-02 `QuickOptionSheet` | P0 |
| K-02 | 무료배송 채우기 추천(장바구니 게이지 → 스토어 상품 필터) | 배송 정책 + 장바구니 금액 | S-04, S-09 | P0 |
| K-03 | 도착 예정일 표시 "N일(요일) 도착 예정" | `dispatch_days` + 해당 판매자 최근 30일 실측 평균 배송일(기존 partner metrics `avg_delivery_days`). 표기는 "예정"이며 "보장" 금지(보장은 계약·보상 정책 필요, PO-09) | S-03 혜택표, S-02 리스트 뷰 | P1 |
| K-04 | 오늘출발 배지 | 상품 정책 `same_day_cutoff` + 현재 KST 시각 + 판매자 최근 30일 당일 출고율 ≥ 정책값(PO-10). 정책값 미설정 시 배지 미표시 | S-02, S-03 | P1 |
| K-05 | 재입고 알림 | `restock_subscriptions` + 재고 0→양수 전환 이벤트(파트너 재고 API) | S-03 품절 옵션 "재입고 알림 받기" | P1 |
| K-06 | 찜 상품 가격 인하 알림 | `sku_price_history` 인하 이벤트 → 찜한 회원 인앱 알림(하루 1회 묶음) | 알림 + S-08 | P2 |
| K-07 | 리뷰 요약(사이즈 체감 분포, 평점 분포, 포토 비율) | `fit_type`, `rating`, `images_json` 집계. 문장 생성형 AI 요약은 하지 않음(허위 생성 위험) | S-03 리뷰 섹션 상단 | P1 |
| K-08 | 판매자 응답률·평균 답변 시간 | `product_qna.created_at/answered_at` 최근 90일 | `OmSellerCard`, 스토어 홈 | P1 |
| K-09 | 구매확정·리뷰 작성 리마인드 | 배송완료 후 N일(자동확정 크론 이전) 알림 | 알림 크론 | P2 |
| K-10 | 원클릭 재구매 | 주문 품목 SKU 현재 판매 상태 확인 후 장바구니 담기 | S-07 주문 카드 | P2 |
| K-11 | 출고 지연 자동 안내 + 지연 보상 노출 | `dispatch_due_at` 경과 + 기존 `LATE_COMPENSATION` 정책 | 구매자 주문 상세 배너, 파트너 대시보드 경고 | P1 |
| K-12 | 0건 검색 복구 | 동의어(`search_synonyms`) 교정 제안 + 상위 카테고리 추천 + 인기 상품 | S-02 빈 상태 | P1 |
| K-13 | 허위 할인 방지(표시광고 준수) | `sku_price_history`: 할인 시작 직전 20일 내 `original_price` 인상 이력이 있으면 관리자 검수 큐 플래그 + 해당 기간 할인율 미표시. 기준 기간 값은 PO-11 확인 | A-03 검수, `OmPrice` | P0 |
| K-14 | PDP 내 "이 스토어 묶음배송 상품" 가로 리스트 | 같은 `bundle_group_key`/정책 상품 | S-03 하단 | P2 |
| K-15 | 이미지 반응형 변환 | 업로드 시 400/800/1200px 변환본 저장(스토리지 비용 PO-12) 후 `srcset` | `OmImage`, `OmImageGallery` | P1 |
| K-16 | 판매자 신뢰 정보 일원화 | 사업자 정보·통신판매업·반품지·등급·응답률을 `OmSellerCard` 펼침으로 | S-03, S-09 | P0 |
| K-17 | 체크아웃 "최대 할인 자동 적용" | `/api/v1/coupons/best` | S-05 | P1 |
| K-18 | 성능 예산 | 홈·PLP·PDP LCP ≤ 2.5s(로컬 프로브 `tests/browser/lcp_probe.mjs`), JS 초기 번들 ≤ 200KB gzip(스토어) | CI | P1 |
| K-19 | 접근성 기준 | WCAG 2.1 AA: 대비, 키보드, 자동 회전 정지, 폼 오류 연결(`aria-describedby`), 바텀시트 포커스 트랩 | 전 화면 | P0 |

---

## 6. 우선순위 기반 단계별 실행 로드맵 (Phased Execution Plan)

각 Phase는 **fail-first 테스트 → 구현 → `npm test` 전체 녹색 → 6구간 브라우저 스모크 → 보고서(`reports/MASTER_SPEC_PHASE{N}_YYYY-MM-DD.md`)** 순서로 닫는다. 보고서의 판정은 PASS/FAIL/BLOCKED/NOT_RUN만 사용하고 증거(테스트 로그 경로, 스크린샷 경로)를 붙인다. 커밋·푸시·배포·원격 D1 적용은 각 Phase 종료 후 운영자 승인으로 진행한다.

### Phase 1 — 디자인 시스템 토큰 & 공통 레이아웃/네비게이션

| # | 작업 | 파일 | 완료 기준 |
|---|---|---|---|
| 1-0 | 문서 정정(D-01~D-10): 대체 배너 + 상태값 수정 | `docs/audit/feature-parity-matrix.md`, `docs/audit/route-gap-matrix.md`, `reports/COMMERCIALIZATION_100_FINAL.md` | 문서 내 "100% VERIFIED" 중 §1.2 불일치 항목 0 |
| 1-1 | 커머스 시맨틱 토큰 추가(라이트·다크 2블록) + 프리셋 유틸 | `packages/ui/src/styles/tokens.css`, `packages/ui/tailwind.preset.cjs` | `tests/ui/theme.test.mjs` 대비 4.5:1 검사 확장 PASS |
| 1-2 | 신규 컴포넌트 22종(§2.5 표의 신규) + `OmDataTable` 확장 + `OmProductCard` 이동 | `packages/ui/src/components/*`, `packages/ui/src/composables/useConfirm.ts`, `packages/ui/src/index.ts` | 컴포넌트 단위 테스트(`tests/ui/components_commerce.test.mjs` 신규: OmPrice 순서/할인율 조건, OmCountdown 만료, OmCarousel 일시정지, OmQuantityStepper 상한, OmDataTable 선택·페이지 이벤트), `vue-tsc` 0 |
| 1-3 | 디자인 린트 + 래칫(현재 위반 건수를 상한으로 고정) | `tests/ui/design_lint.test.mjs`, `package.json` `test:ui` 체인 | 상한 초과 시 FAIL, Phase 4 종료 시 상한 0 |
| 1-4 | Font Awesome 제거, lucide 단일화 | `apps/*/index.html`, `fa-*` 사용 파일 전부 | `fa-` 0건(린트) |
| 1-5 | `OmConsoleShell` 적용 + LNB 메뉴 구조(§3 P-00, A-00) + 라우터 경로·리다이렉트 | `apps/partner/src/App.vue`, `apps/partner/src/router/index.ts`, `apps/admin/src/App.vue`, `apps/admin/src/router/index.ts` | 기존 경로 전부 200(리다이렉트 포함), 역할별 메뉴 노출 테스트(`tests/ui/console_shell.test.mjs` 확장) |
| 1-6 | 스토어 셸: `MegaMenu`(3단 호버), 바텀 네비 5칸, 최근 본(로컬), 검색 패널 2열 | `apps/storefront/src/App.vue`, `src/components/MegaMenu.vue` | 키보드 탐색 테스트, 6구간 가로 스크롤 0 |
| 1-7 | `alert/confirm` 전량 교체(H-12) | §1.4 H-12 파일 전부 | 린트 0 |
| 1-8 | 빈 catch → 오류 상태(H-13) | §1.4 H-13 파일 전부 | `tests/ui/error_states.test.mjs` 확장 |
| 1-9 | 더미·폴백 제거(H-01~H-05, H-07, H-16) | §1.4 해당 파일 | `tests/ui/copy_honesty.test.mjs`·`image_policy.test.mjs` 확장(unsplash 0건, '지정 특송사' 0건) |
| 1-10 | 홈 캐러셀 일시정지·인디케이터(U-03) | `HomeView.vue` → `OmCarousel` | 접근성 테스트 |

Phase 1 종료 조건: `npm test` 녹색, 린트 래칫 통과, `tests/browser/route_smoke.mjs` 57+ 라우트 × 6구간 FAIL 0.

### Phase 2 — DB 스키마 & 멀티셀러 코어 API

| # | 작업 | 파일 | 완료 기준 |
|---|---|---|---|
| 2-1 | 상품 이미지·카테고리 확장·고시 템플릿 | `migrations/d1_53_catalog_media_notice.sql`, `routes/catalog.js`, `routes/partner.js`, `routes/admin.js` | 기존 상품 이미지 이관 행 수 = 썸네일 있는 상품 수, 상세 API `images` 반환 |
| 2-2 | 배송비 템플릿 엔진·묶음배송·발주확인/출고기한 | `migrations/d1_54_shipping_policies.sql`, `services/orders.js`, 신규 `routes/partner-shipping.js` | 골든 회귀(정책 없는 주문 금액 동일), 4개 `fee_type` × 도서산간 조합 단위 테스트, 신규 `tests/shipping_policy_test.mjs` |
| 2-3 | 쿠폰 엔진(셀러/플랫폼·범위·중복·분담·분개·환불) | `migrations/d1_55_coupon_engine.sql`, 신규 `services/coupons.js`, `services/orders.js`, `routes/features.js`, 신규 `routes/partner-coupons.js` | 신규 `tests/coupon_engine_test.mjs`: 스택 규칙, 최소주문, 범위, 분담 배분 잔차, 부분환불 비례 환원, 시산표 대차 일치, 발급 경합 |
| 2-4 | 정산 확장(카테고리 수수료·PG 수수료·판매자 부담 쿠폰)·정책 테이블·출금 신청 | `migrations/d1_56_settlement_payout_policy.sql`, `services/orders.js`, `routes/finance.js`, 신규 `routes/partner-payouts.js` | 신규 `tests/settlement_policy_test.mjs`: 정책 미설정 시 현행과 동일, 설정 시 공식 일치, 출금 경합·멱등 |
| 2-5 | 리뷰 도움돼요·답글·신고·블라인드, 스토어 팔로우·프로필, 재입고 구독, 평점 캐시 | `migrations/d1_57_reviews_social.sql`, `routes/features.js`, `routes/catalog.js` | 신규 `tests/reviews_social_test.mjs`, 목록 정렬 `rating/reviews` |
| 2-6 | 타임딜 엔진(딜가 적용·소진 집계·복원)·기획전 | `migrations/d1_58_promotions.sql`, `services/orders.js`, `routes/features.js`, `routes/admin.js` | 신규 `tests/flash_sale_engine_test.mjs`: 기간 외 미적용, 초과 409, 취소 시 복원, `sold_percent` 실값 |
| 2-7 | 페널티 규칙·등급 산정 크론 | `migrations/d1_59_seller_grade_penalty.sql`, `index.js` scheduled, 신규 `services/grades.js` | 정책 비활성 시 NULL 등급, 재계산 멱등 |
| 2-8 | 급상승 검색어·최근 본·가격 이력 | `migrations/d1_60_search_trending_recent.sql`, `routes/features.js`, `routes/partner.js`, `routes/bidding-m2c.js` | 순위 변동 계산 테스트, 최소 검색 수 미만 제외 |
| 2-9 | 클레임 수거·검수 단계 | `migrations/d1_54_*`(returns 컬럼), `routes/partner.js`, `services/claims.js` | 단계 순서 위반 409, 검수 불량 시 귀책 재계산 |
| 2-10 | 목록 공통 계약(페이지네이션·기간·CSV) — 파트너·관리자 목록 API 전부 | `routes/partner.js`, `routes/admin.js`, `lib/http.js`(공통 파서) | 고정 `LIMIT` 쿼리 0개(정적 검사 테스트) |
| 2-11 | 상품 목록 필터·facet·배지·`sold_30d` | `routes/catalog.js` | 신규 `tests/catalog_facets_test.mjs`, 쿼리 인덱스 추가(`d1_60`) |
| 2-12 | 스키마 핀·리허설·OpenAPI | `services/orders.js` `REQUIRED_SCHEMA_VERSION`, `tests/migration_fk_rehearsal.mjs` `DANGLING_PAIRS`(신규 FK 쌍), `docs/openapi/paths/*` | K-1.4 핀 테스트, `test:openapi` PASS |
| 2-13 | 보안 체크리스트(§4.4) 케이스 | `tests/security_integrity.mjs`, `tests/input_abuse_guards_test.mjs` | 신규 엔드포인트 전부 401/403/404(IDOR) 케이스 보유 |

Phase 2 종료 조건: `npm test` 녹색(신규 스위트 포함), 로컬 리허설에서 `d1_53`~`d1_60` 적용 + 롤백 SQL 검증. 원격 D1 적용은 운영자 승인 후.

### Phase 3 — 구매자 스토어프론트 전 화면 UX/UI & 구매/결제 파이프라인

| # | 작업 | 화면/파일 | 완료 기준 |
|---|---|---|---|
| 3-1 | 홈 섹션형 재구성 + 무한 스크롤(H-10) | S-01 `HomeView.vue` | 전 상품 로드 없음, 섹션별 빈 데이터 숨김 |
| 3-2 | PLP 공통 레이아웃·필터·칩·뷰전환·URL 동기화·무한 스크롤(H-11) | S-02 `SearchView.vue`, `CategoryView.vue`, `components/plp/*` | 201번째 상품 노출 E2E, 필터 URL 왕복 |
| 3-3 | 상품 카드 규격 + 찜·퀵담기 | `OmProductCard`, `QuickOptionSheet.vue` | 옵션 상품 퀵담기 E2E |
| 3-4 | PDP 전면 개편(갤러리·sticky 구매패널·다중 옵션 블록·쿠폰 모달·sticky 탭·폴딩·판매자 카드·모바일 바텀시트) | S-03 | 2개 SKU 동시 담기 E2E, 1440px sticky 확인, 모바일 시트 포커스 |
| 3-5 | 장바구니 판매자 그룹 카드·무료배송 게이지·옵션 변경·스토어 쿠폰 | S-04 | 게이지 경계값 테스트 |
| 3-6 | 주문서 쿠폰 2단(스토어·플랫폼)·최대할인 자동·우편번호 검색·적립 예정 | S-05 | 서버 견적과 1원 일치 E2E |
| 3-7 | 결제 결과 | S-06 | 실패 코드 매핑 표 |
| 3-8 | 주문 목록·상세·클레임 시트·배송 타임라인(레거시 토큰 이식) | S-07 | 부분 반품 E2E, 다크모드 스크린샷 |
| 3-9 | 마이페이지 허브·리뷰·문의·최근 본·적립금·팔로우 스토어 | S-08 + 라우터 | `/profile` 리다이렉트 유지 |
| 3-10 | 스토어 미니샵(프로필·팔로우·탭·무료배송 채우기) | S-09 | 팔로우 토글 E2E |
| 3-11 | 번개특가·베스트(기간)·쿠폰함·고객센터·약관(레거시 토큰 이식) | S-10, S-12, S-13 | 린트 상한 스토어 0 |
| 3-12 | 직권 항목 P0/P1(K-01~K-05, K-07, K-08, K-11~K-13, K-15~K-19) | 해당 화면 | 항목별 테스트 |
| 3-M | Flutter 고객 앱 토큰 동기화(`mobile/customer_app/lib` 테마) + PDP 바텀시트·쿠폰 2단 반영 | `mobile/customer_app` | `flutter analyze` 0, 골든 갱신 |

Phase 3 종료 조건: 스토어 디자인 린트 0, 구매 전 여정 브라우저 E2E(`tests/browser/e2e_browser.mjs` 확장: 검색→필터→PDP 다중옵션→장바구니 2판매자→쿠폰 2종→결제(샌드박스)→부분 반품) PASS, LCP 예산 충족, 6구간 스모크 FAIL 0.

### Phase 4 — 셀러센터 & 통합어드민 UX/UI + 정산/클레임 완성

| # | 작업 | 화면/파일 | 완료 기준 |
|---|---|---|---|
| 4-1 | 셀러 대시보드 파이프라인 | P-01 | 카드 수 = 클릭 목록 total(테스트) |
| 4-2 | 상품 목록·등록(옵션 매트릭스·이미지 10장·고시 템플릿·배송 템플릿) | P-02, P-03 | 3속성 × 값 조합 생성·저장 E2E, 고시 필수 누락 422 표시 |
| 4-3 | 발주확인·송장 일괄·지연 안내 | P-04 | CSV 송장 업로드 E2E |
| 4-4 | 클레임 3분할(수거·검수·환불/거부) | P-05 | 반품 전 단계 E2E |
| 4-5 | 정산 내역·출금 신청·세금계산서 | P-06 | 출금 신청→관리자 승인→이체완료 E2E |
| 4-6 | 스토어 쿠폰·타임딜 신청 | P-07 | 셀러 쿠폰 발급→구매자 사용→정산 부담 반영 E2E |
| 4-7 | 문의·리뷰 관리(답글·신고) | P-08 | — |
| 4-8 | 스토어 꾸미기·배송/반품 정책 | P-09 | — |
| 4-9 | 입점 신청·확장 화면 토큰 이식 | P-10, P-11 | 파트너 린트 0 |
| 4-10 | 관리자 대시보드·입점 심사 통합·셀러 상세 | A-01, A-02 | 승인/보완요청/반려 E2E |
| 4-11 | 상품 검수 큐(금칙어·허위할인 플래그 K-13)·전체 상품 | A-03 | — |
| 4-12 | 카테고리 트리·고시 템플릿·카테고리 수수료 | A-04 | 수수료 변경이 신규 주문에만 적용 테스트 |
| 4-13 | 통합 주문·분쟁 조정(페이지네이션·CSV) | A-05 | 10,000건 이상 시드에서 페이지 이동 |
| 4-14 | 정산 배치·지급 승인·정책(PG 수수료·수수료 기준) | A-06 | 정책 변경 이력, 소급 금지 테스트 |
| 4-15 | 배너·기획전·타임딜·알림 | A-07 | 타임딜 캠페인 생성→셀러 신청→승인→홈 노출 E2E |
| 4-16 | 플랫폼 쿠폰(분담·범위)·셀러 쿠폰 감독 | A-08 | — |
| 4-17 | 회원·문의·리뷰(블라인드) | A-09 | — |
| 4-18 | 페널티·등급 | A-10 | 규칙 비활성 시 부과 불가 |
| 4-19 | 기타 운영 화면 토큰 이식 | A-11 | 관리자 린트 0 |
| 4-20 | Flutter 파트너 앱 대시보드 파이프라인·출고 동기화 | `mobile/partner_app` | `flutter analyze` 0 |

Phase 4 종료 조건: 3개 앱 디자인 린트 0, 화면 디자인 시스템 이식률 63/63, 정산 대사 테스트(§4.4-7) PASS, 콘솔 E2E PASS, §1.3 채점표 재채점 결과를 최종 보고서에 첨부.

### 6.5 PO/운영자 결정 필요 항목 (코드로 값을 정하지 않음)

| ID | 결정 사항 | 미결정 시 동작 |
|---|---|---|
| PO-01 | 카테고리별 수수료율 | 판매자 기본율 적용(현행) |
| PO-02 | 수수료 계산 기준(판매가 vs 판매자 할인 차감 후) | `GROSS`(현행) |
| PO-03 | PG 수수료 판매자 전가 여부·결제수단별 요율 | 차감 0(현행) |
| PO-04 | 플랫폼 쿠폰 판매자 분담 비율·참여 동의 절차 | 플랫폼 100% 부담(현행) |
| PO-05 | 구매확정 적립률(현재 서버 상수 1%, `services/orders.js:823`)의 정책 테이블 이관 여부 | 1% 유지 |
| PO-06 | 타임딜 상품 수량할인 중복 적용 여부, 타임딜 수수료 | 수량할인 미적용, 수수료는 일반과 동일 |
| PO-07 | 셀러 등급 기준·혜택, 페널티 규칙·점수·금액 | 등급 미표시, 페널티 규칙 비활성 |
| PO-08 | 상품정보제공고시 템플릿 항목(법령 원문 기준 입력 주체) | 자유형 고시(현행) |
| PO-09 | "도착보장" 제공 여부·보상 | "도착 예정"만 표시 |
| PO-10 | 오늘출발 배지 최소 당일출고율 | 배지 미표시 |
| PO-11 | 허위 할인 판단 기준 기간(종전가격 산정 기간) | 플래그만 생성, 할인율 표시는 유지하고 검수 큐 적재 |
| PO-12 | 이미지 변환본 저장 비용 승인 | 원본만 사용 |
| PO-13 | 우편번호 검색 외부 스크립트(Daum) 사용 승인 | 수기 입력 |
| PO-14 | 회원 등급제 도입 여부 | 미도입 |

### 6.6 진행 추적

- 이 문서의 ID(D-, H-, U-, S-, P-, A-, K-, PO-, Phase 번호)를 커밋 메시지·보고서·테스트 이름에 그대로 사용한다.
- Phase 종료마다 §1.3 채점표를 재채점해 `reports/MASTER_SPEC_PHASE{N}_*.md`에 이전 값과 함께 기록한다(점수 상승은 테스트 증거가 있는 항목만).
