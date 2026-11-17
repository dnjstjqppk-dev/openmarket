# OLMOA 작업지시서 — 5단계(상용화 마감)

- 발행일: 2026-11-17 / 받는 사람: Muse Spark
- 기준 커밋: `f69cb22` (브랜치 `work-order/full`)
- 참고 문서: `OPENMARKET_WORK_ORDER.md`(1~4단계), `OPENMARKET_FULL_MASTER_SPEC.md`, `reports/AUDIT_2026-11-17_REMAINING.md`(4단계 검수 결과)
- 목표: 4단계 검수 결함 수정, 운영자 결정 반영, 남은 기능 구현, 운영 반영 리허설까지 끝낸다.
- 순서: 5-0 → 5-1 → … → 5-10 → 5단계 관문. 앞 작업의 완료 기준을 통과한 뒤 다음 작업으로 넘어간다.

---

## 0. 공통 규칙

`OPENMARKET_WORK_ORDER.md` §0의 규칙 1~8을 그대로 지킨다. 아래 규칙을 추가한다.

9. 검사기가 놓친 위반을 찾으면 검사기와 코드를 함께 고친다. 예외 목록이나 상한(CAPS)을 늘려서 통과시키지 않는다.
10. 끝까지 동작하는 기능만 화면에 둔다. 신청만 받고 처리하지 않는 버튼은 만들지 않는다.
11. `reports/WORK_ORDER_QUESTIONS.md`에 "미충족·사각·보류"라고 적은 항목은 완료 보고에서 "통과"로 쓰지 않는다.
12. 운영 서버는 건드리지 않는다. `wrangler d1 execute --remote`, `wrangler deploy`, 운영 시크릿 변경, 실결제는 하지 않는다.
13. 각 작업은 실패하는 테스트를 먼저 커밋하거나, 고치기 전 실패 로그를 보고서에 남긴다.

---

## 1. 운영자 결정 (2026-11-17 확정)

| 번호 | 결정 | 이 지시서에서 반영하는 곳 |
|---|---|---|
| 결정-15 | 최저가 보장제는 운영하지 않는다 | 작업 5-5 (기능 삭제) |
| 결정-16 | 출금은 전액 출금만 허용한다 | 작업 5-2 |
| Q-1-2 | 대비 미달 토큰 4쌍은 4.5:1 이상 값으로 교체한다 (안 a) | 작업 5-1 |

결정-01~14(`OPENMARKET_WORK_ORDER.md` §5)는 아직 미정이다. 결정 전 동작을 그대로 유지한다.

---

## 작업 5-0. 저장소 정리와 기록 바로잡기

- 지시:
  1. 커밋되지 않은 `OPENMARKET_WORK_ORDER.md`, `OPENMARKET_FULL_MASTER_SPEC.md`, `OPENMARKET_WORK_ORDER_PHASE5.md`, `reports/AUDIT_2026-11-17_REMAINING.md`를 커밋한다.
  2. 작업 트리에 남은 `reports/v3/screenshots/*`(이름 변경·삭제)와 `reports/v4/phase2/smoke/results.json` 변경을 확인한다. 현재 코드로 다시 만든 증거면 커밋하고, 아니면 되돌린다. 어느 쪽인지 커밋 메시지에 적는다.
  3. `reports/WORK_ORDER_PROGRESS.md`의 1-9 행을 다시 판정한다. 지금 3개 앱의 `alert(`·`confirm(`·`prompt(` 사용은 0건이다. 고정 테스트 5개를 바꾼 커밋 해시를 적고 "통과"로 고친다.
  4. 빠진 3단계 완료 보고서 `reports/WORK_ORDER_PHASE3_2026-11-15.md`를 `OPENMARKET_WORK_ORDER.md` §6 양식으로 작성한다. PROGRESS의 3-1~3-12·G3 행과 커밋 기록만 근거로 쓴다.
  5. PROGRESS의 3-8 행을 "실패(5-1에서 재작업)"로 고친다. 사유: 주문 화면 색상 미전환, 다크모드 캡처 없음.
- 완료 기준: `git status` 깨끗함. PROGRESS 1-9·3-8 갱신. 3단계 보고서 있음.

---

## 작업 5-1. 디자인 검사기 수정, 주문 화면 전환, 대비 토큰 교체

- 대상 파일: `tests/ui/design_lint.test.mjs`, `apps/storefront/src/views/OrderDetailView.vue`, `apps/storefront/src/views/OrdersView.vue`, `packages/ui/src/styles/tokens.css`, `tests/ui/theme.test.mjs`
- 현재 문제:
  - `paletteRe`의 `(?![a-zA-Z0-9-])` 때문에 `bg-gray-100`, `text-green-600`, `border-gray-200/80` 같은 번호 셰이드를 잡지 못한다. 그래서 "스토어 0건"으로 보고됐지만 주문 상세 131건, 주문 목록 51건이 남아 있다.
  - 커머스 토큰 4쌍이 대비 4.5:1에 못 미친다.
- 지시:
  1. 검사기가 번호 셰이드(`-50`~`-950`), 투명도 접미사(`/80`), 변형 접두사(`hover:`, `dark:`, `sm:` 등)를 모두 잡도록 정규식을 고친다.
  2. 검사기 자체 테스트를 추가한다. `bg-gray-100`, `hover:text-green-800`, `border-gray-200/80`, `sm:bg-slate-100`은 각각 1건, `bg-surface`, `text-ink-muted`는 0건이어야 한다.
  3. 고친 검사기로 3개 앱과 `packages/ui`를 다시 센다. 새로 드러난 위반은 디자인 토큰으로 바꾼다. 상한은 늘리지 않는다.
  4. 주문 상세·주문 목록의 색상 클래스를 전부 토큰으로 바꾼다(작업 3-8 지시 4번). 상태 배지는 `OmBadge` 상태 변형을 쓴다.
  5. `tokens.css`의 아래 값을 교체한다. 다크 블록 2곳(`:root[data-theme='dark']`, `@media (prefers-color-scheme: dark)`)을 모두 바꾼다.

     | 토큰 | 테마 | 현재 값 | 새 값 | 새 대비 |
     |---|---|---|---|---|
     | `--om-urgent` | 라이트 | `232 93 4` | `183 73 3` | 흰 배경 5.29, `urgent-soft` 배경 4.64 |
     | `--om-rating` | 라이트 | `242 169 0` | `155 108 0` | 흰 배경 4.63 |
     | `--om-soldout` | 라이트 | `154 154 146` | `117 117 108` | 흰 배경 4.65 |
     | `--om-soldout` | 다크 | `105 108 105` | `128 131 128` | 다크 배경(22 25 26) 4.61 |

  6. `theme.test.mjs`의 T04(미달값 고정 테스트)를 지우고, T03에 `urgent`·`rating`·`soldout`을 라이트·다크 모두 4.5 이상으로 검사하도록 추가한다. 라이트 `urgent`는 `urgent-soft` 배경 위에서도 4.5 이상인지 검사한다.
  7. 라이트·다크 각각 주문 목록·주문 상세를 1440px과 390px에서 캡처한다(8장). 경로: `reports/WORK_ORDER_PHASE5/dark/`.
- 완료 기준: 고친 검사기 기준 3개 앱 0건, 검사기 자체 테스트 통과, `theme.test.mjs` 통과, 캡처 8장에서 글자와 배경이 구분된다. PROGRESS 1-2·3-8을 "통과"로 다시 판정한다.

---

## 작업 5-2. 출금은 전액만 (결정-16)

- 대상 파일: `apps/cloudflare-gateway/src/services/payouts.js`, `apps/cloudflare-gateway/src/routes/partner.js`(출금 신청), `apps/partner/src/components/settlement/PayoutRequestModal.vue`, `tests/settlement_policy_test.mjs`, `docs/openapi/paths/partner.yaml`
- 현재 문제: 화면과 신청 API는 부분 금액을 받는데, 관리자 승인은 전액일 때만 된다(`payouts.js:208-209`). 부분 신청은 늘 거절되고, 셀러당 처리 중 신청 1건 제한 때문에 셀러가 다시 신청하지도 못한다.
- 지시:
  1. 신청 API에서 금액 입력을 없앤다. 서버가 그 시점 출금 가능 전액으로 신청을 만든다. 요청에 `amount`가 있고 전액과 다르면 `WITHDRAWAL_FULL_AMOUNT_ONLY`(400)를 낸다. 출금 가능액이 0 이하이면 `NOTHING_TO_WITHDRAW`(409)를 낸다.
  2. 출금 모달은 금액 입력칸을 없애고 "출금 가능액 N원 전액을 신청합니다" 확인 방식으로 바꾼다.
  3. 승인 시점에 출금 가능액이 신청액과 다르면 신청을 `REJECTED`로 자동 종료하고 사유 `WITHDRAWAL_AMOUNT_CHANGED`를 기록한 뒤 409를 낸다. 셀러는 바로 다시 신청할 수 있어야 한다.
  4. `decidePayoutRequest`의 상태 변경을 `WHERE id = ? AND status = 'REQUESTED'`로 바꾸고, 변경 0건이면 409를 낸다(두 관리자가 동시에 처리하는 경우).
  5. OpenAPI 문서를 맞춘다.
- 완료 기준: 테스트 추가 — 다른 금액 신청 400, 전액 신청 후 승인 성공, 승인 전 출금 가능액이 바뀌면 자동 반려 후 재신청 성공, 같은 신청 동시 승인 2건 중 1건만 성공, 출금 가능액 0이면 409.

---

## 작업 5-3. 재입고 알림 발송 (마스터 스펙 K-05)

- 대상 파일: `apps/cloudflare-gateway/src/routes/partner.js`(재고·상품 수정, 반품 재입고), `apps/cloudflare-gateway/src/services/orders.js`(`restockStatements`), `apps/cloudflare-gateway/src/services/push.js`, 신규 `apps/cloudflare-gateway/src/services/restock.js`, 신규 `tests/restock_notify_test.mjs`
- 현재 문제: "재입고 알림 받기"는 `restock_subscriptions`에 저장만 하고(`routes/features.js:999-1018`), 그 테이블을 읽어 알림을 보내는 코드가 없다.
- 지시:
  1. SKU 재고가 0에서 양수로 바뀌는 모든 경로(셀러 재고 수정·상품 수정, 반품 재입고, 주문 취소·결제 만료 복원)에서 구독자를 찾아 인앱 알림(`notifications`)을 만들고 `notifyUser`로 푸시를 보낸다.
  2. 보낸 구독에는 `notified_at`을 기록하고 다시 보내지 않는다. 컬럼이 없으면 `migrations/d1_68_restock_notified.sql`로 추가한다. 판매 중지·삭제 상품에는 보내지 않는다.
  3. 알림 실패 때문에 재고 수정이 실패하면 안 된다.
- 완료 기준: 테스트 — 구독 2명, 재고 0→5 수정 시 각 1건. 이어서 5→7이면 추가 0건. 다른 셀러는 남의 SKU로 발송을 일으킬 수 없음. 판매 중지 상품은 0건. 마이그레이션 리허설 테스트 통과.

---

## 작업 5-4. "오늘출발" 필터를 결정-10 전 동작으로

- 대상 파일: `apps/cloudflare-gateway/src/routes/catalog.js:169-172`, `apps/storefront/src/components/plp/PlpLayout.vue`, `tests/api_plp_filters_test.mjs`
- 현재 문제: 판매자가 배송 템플릿에 마감 시각만 적으면 그 판매자 상품 전부가 "오늘출발"에 걸린다. 현재 시각 비교도, 출고율 기준(결정-10, 미정)도 없다.
- 지시:
  1. 정책 키 `badge.today_ship_min_rate_bps`가 없으면 `today_shipment` 파라미터를 무시하고, 목록 응답의 사용 가능 필터 목록에서 뺀다. 화면은 응답에 따라 "오늘출발" 칩을 숨긴다.
  2. 정책 값이 있을 때만 걸러낸다. 조건: 현재 KST 시각이 판매자 템플릿 `today_cutoff` 이전이고, 그 판매자의 최근 30일 당일 출고율(`sub_orders`의 실제 결제·출고 시각 기준)이 정책 값 이상이다.
- 완료 기준: 테스트 — 정책 없음이면 필터 무시·칩 없음. 정책 있음이면 마감 전·출고율 충족 상품만 포함, 마감 후 제외, 출고율 미달 제외.

---

## 작업 5-5. 최저가 보장(가격 차액 보상) 기능 삭제 (결정-15)

- 대상 파일:
  - 서버: `apps/cloudflare-gateway/src/routes/orders.js`(`PRICE_ADJUSTMENT`, `PRICE_ADJUST_WINDOW_DAYS`), `routes/features.js:615`(문의 분류 `PRICE_MATCH`), `routes/partner.js`, `routes/admin.js`, `services/push.js`
  - 스토어: `config/policy.ts`, `views/OrderDetailView.vue`(가격 보상 신청), `views/SupportView.vue`, `views/my/MyQnaView.vue`, `views/LegalTermsView.vue`(제5조)
  - 어드민·셀러: `apps/admin/src/views/claims/ClaimListView.vue`, `apps/partner/src/lib/claims.ts`
  - 모바일: `mobile/customer_app/lib/views/order_detail_view.dart`, `mobile/partner_app/lib/models/return_claim.dart`
  - 문서·테스트: `docs/openapi/paths/{orders,features,partner,admin}.yaml`, `tests/commercial_expansion_test.mjs`, `tests/p1_funds_abuse_test.mjs`, `tests/security_integrity.mjs`, `tests/security/exploit_proof_baseline.mjs`, `tests/api_admin_2_9_test.mjs`, `tests/ui/copy_honesty.test.mjs`, `tests/ui/p2_wavef.test.mjs`, `tests/audit/phase1_inventory.mjs`
- 지시:
  1. 구매자 클레임 생성에서 `PRICE_ADJUSTMENT`·`PRICE_MATCH`를 받지 않는다. 들어오면 `INVALID_CLAIM_TYPE`(400). 보상 계산 코드와 `PRICE_ADJUST_WINDOW_DAYS` 상수를 지운다.
  2. 스토어·고객 앱에서 가격 보상 신청 버튼, 고객센터 문의 분류 "가격 보상"을 지운다. 새 문의에서 `PRICE_MATCH` 분류는 받지 않는다(`OTHER`로 바꾸지 말고 400).
  3. 약관 제5조(최저가 보장제 및 적립)를 지우고 이후 조항 번호와 목차 앵커를 당긴다. 시행일·버전 표기를 새 버전으로 올린다. 다른 조항 문구는 바꾸지 않는다.
  4. **과거 데이터는 그대로 둔다.** 이미 저장된 `PRICE_ADJUSTMENT` 클레임과 `PRICE_MATCH` 문의는 어드민·셀러 목록과 상세에서 계속 "가격 보상(종료된 제도)"으로 읽을 수 있어야 한다. 테이블 제약·enum에서 값을 지우지 않는다.
  5. 이 제도를 전제로 한 테스트는 "신청 400" 테스트로 바꾼다. 다른 보안 검사는 줄이지 않는다.
  6. 구매자 화면 전체에서 "최저가 보장", "가격 보상", "차액 보상" 문구 검사를 `copy_honesty` 테스트에 추가한다(어드민 검수 안내 문구 `ReviewQueueView.vue`의 "최저가·보증 등 검증되지 않은 표현"과 가격 필터 placeholder "최저가"는 제외).
- 완료 기준: 테스트 — 신규 가격 보상 클레임 400, `PRICE_MATCH` 문의 400, 기존 가격 보상 클레임 행은 어드민 목록·상세 조회 200. 구매자 화면 문구 검사 0건. 약관 조항 번호 연속. Flutter `analyze` 0건.

---

## 작업 5-6. 약관 본문을 운영자 관리·버전 이력으로

- 대상: 신규 마이그레이션(`legal_documents`), 신규 어드민 화면, `apps/storefront/src/views/LegalTermsView.vue` 및 개인정보처리방침·환불 정책 화면, 회원가입 동의 기록
- 지시:
  1. `legal_documents` 테이블(종류 TERMS·PRIVACY·REFUND, 버전, 시행일, 본문, 작성자, 작성일)을 만든다. 시행일은 오늘(KST) 이전으로 등록할 수 없다.
  2. 5-5에서 정리한 현재 문구를 초기 데이터로 이관한다.
  3. 어드민에 등록·미리보기·시행 예정 목록 화면을 만든다(권한: SUPER_ADMIN만 등록).
  4. 스토어는 현행 버전과 이전 버전 목록을 API로 읽는다. 시행 7일 전부터 "개정 예정" 안내를 보여준다.
  5. 회원 동의 기록(`consent` 관련 테이블)에 동의한 약관 버전이 남는지 확인하고, 없으면 추가한다.
- 완료 기준: 테스트 — 새 버전 등록 시 시행일 전에는 이전 버전, 이후에는 새 버전 노출. 소급 등록 400. SUPER_ADMIN 아닌 관리자 등록 403. 가입 시 동의 버전 저장.

---

## 작업 5-7. 해외 상업송장의 지어낸 수출자 정보 제거

- 대상 파일: `apps/cloudflare-gateway/src/routes/global-customs-fx.js:280-330`, 관련 테스트
- 현재 문제: 수출자 사업자번호 `120-88-01928`, 주소 "Incheon Free Trade Zone B1", 연락처, 품목 중량 기본값 0.5kg, 판매자명 "OLMOA Official Partner", 택배사 "CUSTOMS_EXPRESS"가 코드에 고정돼 있다(공통 규칙 4 위반).
- 지시:
  1. 수출자 정보는 주문 당시 운영 사업자(`business_entities`, 주문의 `operator_entity_id`)에서 읽는다. 없으면 송장 생성을 `EXPORTER_NOT_CONFIGURED`(409)로 거절한다.
  2. 중량·판매자명·택배사 기본값을 지운다. 값이 없으면 비워 두고, 송장 상단에 "중량 미입력 품목 N개"를 표시한다.
- 완료 기준: 게이트웨이 코드에 사업자번호 형식(`\d{3}-\d{2}-\d{5}`) 고정 문자열 0건. 테스트 — 운영 사업자 미설정 409, 설정 시 그 값이 송장에 나옴, 사업자 변경 뒤에도 과거 주문 송장은 당시 사업자로 나옴.

---

## 작업 5-8. 정책 적용일을 KST 기준으로

- 대상 파일: `apps/cloudflare-gateway/src/lib/ledger.js:87-92`(`getPolicy`), 정책 등록 API의 소급 금지 검사, `tests/settlement_policy_test.mjs`
- 지시: `effective_from` 비교와 "과거 날짜 금지" 검사를 KST 날짜(`date('now', '+9 hours')`)로 바꾼다. 같은 키에 시행일이 여러 개면 이미 시행된 것 중 가장 최근 값을 고르도록 `ORDER BY effective_from DESC LIMIT 1`을 붙인다.
- 완료 기준: 테스트 — KST 00:30(UTC 전날 15:30)에 오늘 시행 정책이 적용됨. 같은 키 2개 중 최근 시행분이 선택됨. 내일 시행분은 아직 적용 안 됨.

---

## 작업 5-9. 남은 알림 기능 (마스터 스펙 §5)

- K-06 찜 상품 가격 인하 알림: `sku_price_history`에 판매가 인하가 기록되면 그 상품을 찜한(`wishlists`) 회원에게 하루 1회 묶음 인앱 알림을 보낸다. 크론(`apps/cloudflare-gateway/src/index.js`의 `scheduled`)에서 처리한다. K-13 허위 할인 의심 플래그가 있는 인하는 보내지 않는다.
- K-09 구매확정·리뷰 리마인드: 정책 키 `remind.confirm_after_days`가 있을 때만 배송완료 후 자동 확정 전에 1회 알린다. 리뷰를 안 쓴 구매확정 건은 `remind.review_after_days`가 있을 때만 1회 알린다. 정책 값이 없으면 보내지 않는다.
- K-15 이미지 변환본: 결정-12 전이므로 변환은 구현하지 않는다. `OmImage`가 `srcset`을 받을 자리만 만들고, 없으면 지금처럼 원본을 쓴다.
- 완료 기준: K-06·K-09 각각 테스트 — 정책 없음이면 0건, 있음이면 1회만, 같은 날 중복 없음, 허위 할인 플래그 인하는 0건.

---

## 작업 5-10. 운영 반영 리허설 (원격 실행 금지)

- 대상: `migrations/d1_51_*.sql` ~ 5단계에서 추가한 마지막 마이그레이션, 신규 `scripts/ops/rehearse_phase5.py`, 신규 `reports/WORK_ORDER_PHASE5/DEPLOY_RUNBOOK.md`
- 현재 상태: 운영 `/health` 기준 `schemaVersion = d1_50`. d1_51·d1_52도 미적용이다(4단계 보고서의 "d1_53부터"는 틀림).
- 지시:
  1. 로컬에서 d1_00~d1_50만 적용하고 개발 시드를 넣은 DB를 기준선으로 만든다. 여기에 d1_51부터 순서대로 적용하는 리허설 스크립트를 Python으로 만든다. 각 단계 전후 테이블별 행 수와 `PRAGMA foreign_key_check` 결과를 기록한다.
  2. 되돌리기 절차를 만들고, 리허설 사본에서 실제로 되돌려 기준선과 스키마·행 수가 같아지는지 확인한다.
  3. 스크립트는 DB 파일 경로를 인자로 받게 해서, 오픈 직전에 운영 백업 사본으로 그대로 다시 돌릴 수 있게 한다.
  4. 런북에 순서를 적는다: 백업 → 마이그레이션 → 게이트웨이 배포 → 3개 앱 배포 → `/health` 확인 → 스모크. 단계별 실패 시 되돌리는 방법도 적는다.
  5. 로그에는 행 수·스키마만 남기고 개인정보는 남기지 않는다.
- 완료 기준: 리허설 로그(적용·되돌리기 모두 성공)와 런북. 원격 실행 0회.

---

## 5단계 관문

같은 날 한 번에 실행하고 결과를 보고서에 붙인다.

1. `npm test` 종료 코드 0, 요약행 전부 `0 failed`
2. `npm run typecheck` 종료 코드 0
3. 고친 디자인 검사기 기준 스토어·셀러·어드민 0건(앱별 숫자 기재)
4. `npm run test:browser` 전부 통과, 93개 주소 스모크(`tests/browser/route_smoke.mjs`) 실패 0·가로 넘침 0
5. 다크모드 캡처 8장(5-1)
6. Flutter 고객·셀러 앱 `flutter analyze` 0건, 기존 테스트 통과
7. 리허설 로그(5-10)

---

## 새로 결정이 필요할 때

결정이 필요한 상황을 만나면 `reports/WORK_ORDER_QUESTIONS.md`에 `Q-5-번호`로 적고, 결정 전에는 기능을 끈 상태로 구현한다. 정책 값(수수료율·기간·비율·금액)을 직접 정하지 않는다.

---

## 완료 보고

`reports/WORK_ORDER_PHASE5_{날짜}.md`에 `OPENMARKET_WORK_ORDER.md` §6 양식으로 쓰고, 아래를 덧붙인다.

7. 작업별 고친 커밋, 테스트 이름, 고치기 전 실패 기록
8. 다시 판정한 이전 작업(1-2, 1-9, 3-8)과 변경 이유
9. "통과"로 적은 항목 중 `WORK_ORDER_QUESTIONS.md`에 미충족·보류 메모가 남은 것이 없다는 확인
