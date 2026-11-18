# 출고 뱃지(오늘출발·내일출발) 관리자 설정 + 전여정 QA — 2026-11-18

- 기준: `dfa64b6` (브랜치 `work-order/full`)
- 요구: 사용자 직접 지시 (2026-11-18). "오늘출발·내일출발 관리자 설정 + 파트너 등록→고객 구매→관리자 확인·정산→판매자 발송·송장→고객 확인 전여정의 깊은 QA"
- 상태: 미커밋 (현 세션에 커밋·푸시 명시 지시 없음)

## 1. 사용자 결정 (2026-11-18, 3문항)

| # | 결정 |
|---|---|
| 내일출발 정의 | 오늘출발 마감 이후 주문에 붙는 뱃지 |
| 관리자 범위 | 출고 뱃지 정책 전용 화면 (출고율 기준·마감시각·내일출발 규칙 + 셀러별 현황) |
| QA 방식 | 전여정 자동 E2E 확대, 수백 케이스 (조합 폭발·수동 체크리스트 아님) |

## 2. 구현

### 2-1. 내일출발 뱃지 (신규 개념, 기존 코드에 0건이었음)

- 판정식: 오늘출발 조건(정책 `badge.today_ship_min_rate_bps` + ACTIVE 마감 템플릿 + 30일 당일출고율 충족) + `현재KST >= 마감시각` + `badge.tomorrow_ship_enabled=1`. 오늘출발과 상호배타. 정책 없으면 전체 꺼짐(fail-closed).
- `apps/cloudflare-gateway/src/routes/catalog.js`: `TOMORROW_SHIP_POLICY_KEY`, `isTomorrowShipEnabled`, `tomorrow_shipment` 필터(오늘출발 블록과 동일 SQL, 비교자만 `<=`), `available_filters` + 행 `has_tomorrow` 게이트.
- `packages/ui`: `OmCommerceBadge`에 `tomorrow`(내일출발) kind, `OmProductCard`에 `tomorrowDispatch`(has_tomorrow + 마감 경과, today와 v-else-if 배타).
- `apps/storefront/.../PlpLayout.vue`: `tomorrow_shipment` 플래그·URL·칩을 today와 동일 패턴으로 (서버 스위치 따름).

### 2-2. 어드민 출고 뱃지 정책 화면 (신규)

- `apps/admin/src/views/shipping/ShipBadgePolicyView.vue` + 라우터 `/shipping/badges`(SUPER_ADMIN·FINANCE·OPERATIONS) + 입점·셀러 메뉴.
- 정책 카드는 기존 `platform-policies` GET/PUT 재사용 (신규 정책 API 없음). 셀러 마감시각은 셀러 본인 템플릿의 값을 수정 (전역 기본 마감시각은 만들지 않음 — 약속하지 않은 뱃지는 허위).
- 신규 API 2종 (`apps/cloudflare-gateway/src/routes/admin.js`, 권한 `lib/admin-policy.js`에 `ship-badges → partners.read/manage` 매핑, 마감 수정은 기존 partners 규칙 적용):
  - `GET /api/v1/admin/ship-badges/sellers` (q 검색·페이지네이션, 행: 마감·30일 출고율·badge_now·badge_reason, badge_now는 카탈로그 필터와 동일 판정)
  - `PUT /api/v1/admin/partners/:id/shipping-cutoff` (HH:MM 검증·null 해소·404 2종·감사 `SHIP_CUTOFF_UPSERT`)
- `docs/openapi/paths/admin.yaml` 2경로 문서화, `storefront.yaml`에 `tomorrow_shipment` 파라미터 + `today_shipment` 설명 현행화(5-4 게이트 반영).

## 3. 테스트 (신규 66T · 363어설션 + 기존 확장)

| 스위트 | 결과 | 내용 |
|---|---|---|
| `tests/ship_badge_test.mjs` (신규) | 13/13 | T1~T7 카탈로그(무시·단독·결합·배타·꺼짐·행게이트·쓰레기값), B1~B6 어드민(인증·행·검색·수정·감사·꺼짐) |
| `tests/journey_partner_test.mjs` (신규) | 12/12 | PJ1 템플릿 생애주기, PJ2 옵션행렬 등록, PJ3 단일SKU, PJ4 목록·검색·탭, PJ5 심사 승인·반려, PJ6 일괄수정, PJ7~PJ10 검증 행렬 20종, PJ11 SKU 중복, PJ12 고시 |
| `tests/journey_customer_test.mjs` (신규) | 17/17 | CJ1 2셀러 정확금액, CJ2 무료배송 경계(29999/30000), CJ3 수량할인 4단, CJ4 스토어쿠폰, CJ5 플랫폼쿠폰, CJ6 중복합산, CJ7 적립금(검증·하한·잔액·20% 고정), CJ8 재고경계, CJ9 주소검증, CJ10 PCCC, CJ11 결제전 취소, CJ12 결제후 취소·복원, CJ13 부분·품목·멱등, CJ14 반품, CJ15 교환, CJ16 리뷰, CJ17 목록·불변식 |
| `tests/journey_admin_test.mjs` (신규) | 12/12 | AJ1 구매확정 1%·정산해제, AJ2 자동확정 크론, AJ3 지급소비, AJ4 이체기록, AJ5 수동환불, AJ6 수동배송완료, AJ7 대사 녹색, AJ8 권한매핑, AJ9 매출리포트, AJ10 뱃지정책 반영, AJ11 감사추적, AJ12 주문조회 |
| `tests/journey_shipment_test.mjs` (신규) | 8/8 | SJ1 전구간(준비→발송→추적→배송→확정→리뷰가능), SJ2 송장 정규식 9종, SJ3 상태 8종, SJ4 소유권·필수값, SJ5 일괄 혼합, SJ6 지연안내, SJ7 연락처 마스킹, SJ8 발주확인 |
| `tests/ui/ship_badge_sections.test.mjs` (신규) | 4/4 | 라우트·메뉴·API·검증·다이얼로그·토큰 |
| 기존 확장 | — | plp 6→7(P37), card C35 내일조건, commerce 뱃지 목록 |

- 전 스위트는 실제 게이트웨이(HTTP)→실제 SQL(in-memory D1 의미) 경로로 실행. 브라우저 클릭 수준은 아님.
- `package.json`에 `test:ship-badge`, `test:journey-*` 4종 추가하고 `npm test` 체인에 연결.

## 4. 발견 (QA 중, 심각도순)

| 번호 | 내용 | 심각도 | 조치 |
|---|---|---|---|
| F-J1-01 | 공개 상품 상세(`GET /products/:id`)가 미승인(DRAFT/REJECTED) 상품도 직접 id로 반환. 목록은 숨기고 결제는 `PRODUCT_NOT_ON_SALE`로 막힘 (테스트로 확인) | 낮음(표시) | 수정 안 함. 차단 조건(미리보기 허용 여부)이 PO 결정 필요 → 후속 결정 요청 |
| F-J2-01 | 서브주문 전체취소 응답의 `partial`이 항상 false (품목경로만 설정). UI는 `payment_status`를 쓰므로 무영향 확인 | 낮음(표시) | 테스트에 현행 고정 + 주석. 서버 수정은 후속 결정 |
| F-J2-02 | `CLAIM_ALREADY_OPEN`이 구매자 경로로 도달 불가 (상태 게이트가 먼저 발동). 방어 코드로 유지 | 없음 | 현행 유지, 테스트 주석 |
| F-J3-01 | 정책 변경이력이 첫 등록(INSERT)에는 행 없음 | 없음 | **해소**: `admin.yaml`에 "updates only, 첫 insert는 baseline"으로 문서화된 의도. 감사 로그에 생성 기록됨 (테스트 확인) |

## 5. 레드드릴

- 대상 `catalog.js` 내일출발 비교자(`<=` → `>` 변이). 결과: T3·T4 실패(11/13)로 의도 노출 확인.
- 복원 중 주의: today/tomorrow 두 블록의 SQL이 1자 빼고 동일해 단순 치환이 반대 블록을 건드림. 주석 포함 문맥 지정으로 복원 후 `git hash-object`가 변이 전과 동일(`2ad8aba9…`)함을 확인, `ship_badge` 13/13 + `plp` 11/11 녹색.

## 6. 검증 (같은 날)

- `npm test` exit 0 (신규 5종 + UI 1종 포함 전 체인, 마지막 E2E 26/26)
- `npm run typecheck` exit 0 (4워크스페이스), `npm run lint` exit 0
- `npm run test:openapi` 3/3 (신규 2경로 문서 프로브 포함)
- `npm run build` 3앱 성공 후 dist 원복 (추적 복원 + 미추적 산출물 삭제, 작업 트리에 산출물 없음)
- 미실행: `test:browser`(5단계 관문 16/16이 최신), Flutter(모바일 미변경), 원격·배포(승인 대상)

## 7. 남은 것

- 커밋·푸시 (지시 대기)
- F-J1-01/F-J2-01 후속 결정, 운영 반영(d1_51~d1_70·배포 승인), 인간 항목·Wave I (기존과 동일)
