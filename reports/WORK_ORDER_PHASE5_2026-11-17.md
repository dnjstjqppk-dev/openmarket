# 5단계 완료 보고 — 2026-11-17 (상용화 마감)

- 기준: `f69cb22` (브랜치 `work-order/full`), `OPENMARKET_WORK_ORDER_PHASE5.md`
- 관문 실행일: 2026-11-17 (아래 1~7항 같은 날 한 번에 실행)
- 커밋 상태: 5-0만 커밋됨(`3f69206`, `fa3871c`, `579dbd1`).
  5-1~5-10·관문 수정분은 미커밋(작업자 커밋 권한 없음, §7 파일 목록 참조).

## 1. 완료한 작업 번호

5-0, 5-1, 5-2, 5-3, 5-4, 5-5, 5-6, 5-7, 5-8, 5-9, 5-10 + 5단계 관문.

## 2. 작업별 판정과 증거

| 번호 | 판정 | 증거 |
|---|---|---|
| 5-0 | 통과 | 커밋 3f69206(지시서·감사보고 커밋), fa3871c(증거 재생성: 브라우저 E2E 16/16, 스모크 93주소 88 PASS/의도5/넘침0/실패0), 579dbd1(1-9 통과·3-8 실패 재판정 + 3단계 보고서). `git status` 깨끗함 확인 후 후속 작업 진행 |
| 5-1 | 통과 | `design_lint` 4/4(D04 자체 테스트 포함), `theme` 4/4(T04 삭제·T03 9토큰+urgent-soft), `order_sections` 8/8, `components_commerce` 10/10(C10은 5-9), `p2_wavef` 33/33. 캡처 8장 `reports/WORK_ORDER_PHASE5/dark/orders-{list,detail}-{light,dark}-{1440,390}.png` 육안 확인(글자·배경 구분됨) |
| 5-2 | 통과 | `settlement_policy` 19/19(신규 11-15), `api_partner_2_9` 23/23(P10 전액 계약), `api_admin_2_9` 27/27(A8), `payout_idempotency` 2/2, `security_integrity` 88/88(W10.2 경합 녹색) |
| 5-3 | 통과 | `restock_notify` 13/13, `migration_fk_rehearsal` PASS(d1_20..d1_70, FK ON, 0 dangling). 회귀: security 88/88, buyer 25/25, e2e 26/26 등 녹색 |
| 5-4 | 통과 | `api_plp_filters` 11/11(F8-F11 신규), `plp_sections` 6/6, buyer 25/25, security 88/88, storefront `vue-tsc` 녹색 |
| 5-5 | 통과 | `p1_funds_abuse` 9/9, `security_integrity` 88/88(I17), `p1_phase3` 23/23, `copy_honesty` 13/13(C06 구매자 화면 문구 0건·C07 조항 연속), `p2_wavef` 33/33, `flutter analyze` 0건 2앱, customer 76/76·partner 42/42 |
| 5-6 | 통과 | `legal_documents` 10/10, `consents` 3/3, `openapi` 3/3, copy_honesty 13/13, rehearsal d1_20..d1_68 FK-ON. 관문에서 발견된 어드민 빌드 오류 1건 수정(§7 관문 행) 후 3앱 `vite build` 성공 |
| 5-7 | 통과 | `customs_invoice` 6/6, 게이트웨이 사업자번호 형식 고정 문자열 0건. 회귀: p2_wave_d 10/10, p1_api_data 14/14, honesty 16/16, fx 4/4, e2e 26/26, security 88/88 |
| 5-8 | 통과 | `settlement_policy` 19/19(신규 16-19), rehearsal d1_20..d1_69 FK-ON, admin29 27/27, buyer 25/25, plp 11/11, trending 8/8, wave-k 7/7, openapi 3/3, security 88/88, legal 10/10, customs 6/6, restock 13/13, e2e 26/26, admin `vue-tsc` 녹색 |
| 5-9 | 통과 | `remind_notify` 18/18, `components_commerce` 10/10(C10 신규), `migration_fk_rehearsal` PASS(d1_20..d1_70), 3앱 `vue-tsc` 녹색. 회귀: security 88/88, admin29 27/27(A17 K-13 유지), restock 13/13, settlement 19/19, 전체 `test:ui` exit 0 |
| 5-10 | 통과 | `npm run rehearse:phase5` → apply PASS 20/20(d1_51..d1_70, 매 단계 fk_check=0, 최종 MAX=pin=d1_70) + rollback PASS(스키마·행수·ledger MAX 기준선 일치, non-vacuous), `remote_calls: 0`. `DEPLOY_RUNBOOK.md` 작성. 로그 PII 0건 |
| 관문 | 통과 | 아래 관문 상세 표 참조(7항 전부 통과) |

### 관문 상세(같은 날 실행)

| # | 항목 | 결과 |
|---|---|---|
| 1 | `npm test` exit 0, 전부 0 failed | 통과 (exit 0, 89개 요약행 0 failed, `[FAIL` 0건) |
| 2 | `npm run typecheck` exit 0 | 통과 (4워크스페이스) |
| 3 | 고친 검사기 3앱 0건 | 통과 (스토어 0·셀러 0·어드민 0, CAPS 불변) |
| 4 | `test:browser` + 93주소 스모크 | 통과 (`test:browser` 16/16 + 스모크 93주소 88 PASS + 의도된 WARN 5 + 넘침 0 + 실패 0) |
| 5 | 다크모드 캡처 8장 | 통과 (`reports/WORK_ORDER_PHASE5/dark/`, 2장 육안 확인) |
| 6 | Flutter analyze 0 + 테스트 | 통과 (customer analyze 0 + 76/76, partner analyze 0 + 42/42) |
| 7 | 리허설 로그 | 통과 (apply 20/20 + rollback PASS, remote_calls 0, 당일 재생성) |

- 스모크 WARN 5건은 전부 의도된 에러 프로브(존재하지 않는 ID 404 4건·빈 결제확인 400 1건).
  로그인 3앱 성공 후 실행(LOGIN=1, 로컬 인메모리 API + `dist-local` 프리뷰).
- `test:browser` 16/16 전부 통과(B01~B11, 콘솔 3·HTTP≥400 11은 샌드박스 외부 이미지 차단 등 기록용이며 단계 판정은 PASS).
  증거 `reports/v3/evidence/05_browser_e2e.json` + 스크린샷 31장 당일 재생성.
  스토어·셀러·어드민은 `dist-local` 프리뷰(localhost:5173/5175/5174) + 로컬 인메모리 API로 실행.

## 3. npm test 실행 결과

- 종료 코드 0. 요약행 89개 전부 `0 failed`(`[FAIL` 행 0건).
- 주요 스위트: buyer 25/25, partner29 23/23, admin29 27/27, security 88/88,
  settlement 19/19, restock 13/13, remind 18/18, legal 10/10, customs 6/6,
  plp 11/11, copy_honesty 13/13, design_lint 4/4, theme 4/4, wavef 33/33,
  openapi 3/3, e2e 26/26.
- `npm run typecheck` 종료 코드 0(packages/ui·storefront·admin·partner 4워크스페이스).

## 4. 디자인 검사 남은 건수(앱별)

- `design_lint` 4/4 통과(D01·D04·D03·D02).
- 고친 검사기(D04 번호 셰이드·투명도·변형접두사 포함) 기준:
  스토어 0건, 셀러 0건, 어드민 0건.
- `packages/ui` 7파일 21건은 기존 상한 그대로(OmAlert 1·OmBadge 5·OmButton 2·
  OmFileUploader 3·OmFooter 7·OmSidebar 2·OmSwitch 1). 상한(CAPS) 증가 없음.
- 단어 경계 grep으로 3개 앱 `alert(`/`confirm(`/`prompt(` 0건 재확인.
- `fa-` 사용 0건(D02).

## 5. 남은 문제와 다음 단계로 넘기는 항목

- PROGRESS 4-12~4-15행이 파손된 채로 남아 있음(열 누락, `|A13 ...` 시작).
  5-0 범위 밖이라 손대지 않음. 후속 작업에서 4개 행 복원 필요.
- 5-1~5-10·관문 수정분이 미커밋(작업자 커밋 권한 없음). §7 파일 목록대로
  작업별 커밋 권장. PROGRESS 1-2·3-8행의 해시는 미커밋이라 커밋 시 기입 필요.
- 5-4 후속 제안: `badge.today_ship_min_rate_bps` 같은 정책 키를 현재 어드민
  PolicyView에서 새로 등록할 수 없음(PUT API로만 설정 가능). 운영에 필요하면
  어드민에 키 추가 UI 후속 작업. 새 Q-5-N은 발행하지 않음(결정 필요 사항 없음,
  정책 없음 → 기능 꺼짐 유지).
- `dist-local/` 빌드 산출물은 git 무시됨(관문용, 커밋 대상 아님).
- 구 보고서의 "d1_53부터" 범위는 틀림(d1_51·d1_52도 미적용). 런북 정정 범위를 따름.

## 6. 운영자 승인이 필요한 작업

- 원격 D1 마이그레이션 d1_51..d1_70 적용(`migrate-d1-remote.yml` APPLY).
  열기 전 런북 절차대로 운영 백업 사본으로 리허설 재실행 필요.
- 게이트웨이 + 3개 앱 배포(순서: 마이그레이션 → 게이트웨이 → 3개 앱 →
  `/health` 확인 → 스모크). 상세는 `reports/WORK_ORDER_PHASE5/DEPLOY_RUNBOOK.md`.
- 실결제·운영 시크릿 변경 없음(5단계에서 건드리지 않음).

## 7. 작업별 고친 커밋·테스트·고치기 전 실패 기록

5-0은 아래 커밋에 반영됨. 5-1~5-10과 관문 수정분은 미커밋이므로 파일 목록으로
대신한다(작업자 커밋 권한 없음 — 커밋 시 PROGRESS 1-2·3-8행 해시도 함께 기입).

| 작업 | 커밋 / 파일 | 테스트 | 고치기 전 실패 |
|---|---|---|---|
| 5-0 | `3f69206`, `fa3871c`, `579dbd1` | confirm_dialogs 5/5, design_lint, browser 16/16, 스모크 93주소 | 해당 없음(정리·재판정·보고서 작업) |
| 5-1 | 미커밋: `tests/ui/{design_lint,theme}.test.mjs`, `OrdersView.vue`·`OrderDetailView.vue`·`orderStatus.ts`, `packages/ui/{tokens.css,tailwind.preset.cjs,OmBadge.vue}`, PROGRESS·QUESTIONS, `5-1-prefail.md`, `dark/` 8장 | design_lint 4/4, theme 4/4, order 8/8, wavef 33/33, commerce 10/10 | `5-1-prefail.md`: 구 검사기 0건 vs 신 검사기 OrderDetail 207·Orders 78 (사각 확인) |
| 5-2 | 미커밋: `services/payouts.js`, `routes/partner.js`, `PayoutRequestModal.vue`, `settlement_policy_test.mjs`, `api_{partner,admin}_2_9_test.mjs`, `partner.yaml`, `5-2-prefail.md` | settlement 19/19, partner29 23/23, admin29 27/27, payouts 2/2, security 88/88 | `5-2-prefail.md`: settlement 10/15, P10 409-not-400, 드리프트 재신청 INFLIGHT·동시승인 혼란 코드 probe |
| 5-3 | 미커밋: `services/restock.js`(신규), `restock_notify_test.mjs`(신규), `routes/partner.js`·`services/{orders,push}.js`, `package.json`(test:restock), `5-3-prefail.md` | restock 13/13, rehearsal PASS | `5-3-prefail.md`: 5/12(발송 경로 7 실패). reship 빨간훈련 12/13 후 13/13 |
| 5-4 | 미커밋: `routes/catalog.js`, `PlpLayout.vue`, `api_plp_filters_test.mjs`, `5-4-prefail.md` | plp 11/11, plp_sections 6/6, buyer 25/25, security 88/88 | `5-4-prefail.md`: 7/11(F8 무정책 필터 동작·F9 마감 후 포함·F10 무정책 뱃지·F11) |
| 5-5 | 미커밋: gateway `routes/{orders,features,partner,admin}.js`·`push.js`, storefront `policy.ts`·`OrderDetailView`·`SupportView`·`MyQnaView`·`LegalTermsView`·`App.vue`·locales·`PolicyView`, `packages/i18n`, admin `ClaimListView`, partner `claims.ts`, mobile 2앱+테스트, openapi 4종, 인벤토리 재생성, 관련 테스트 8종, `5-5-prefail.md` | funds_abuse 9/9, security 88/88, p1_phase3 23/23, copy_honesty 13/13, wavef 33/33, flutter 76/76+42/42 | `5-5-prefail.md`: funds 6/9, copy 11/13, wavef 32/33, integrity 87/88, phase3 22/23 |
| 5-6 | 미커밋: `d1_68_legal_documents.sql`, `routes/legal.js`(신규), `routes/{auth,admin}.js`, `lib/legal.ts`(신규), 약관 3화면·`RegisterView`, admin `views/legal/`(신규)·router·App, `legal.yaml`(신규)·`admin.yaml`·`openapi.yaml`, `legal_documents_test.mjs`(신규), 핀 9종, `5-6-prefail.md` | legal 10/10, consents 3/3, openapi 3/3, copy_honesty 13/13 | `5-6-prefail.md`: 0/10(ROUTE_NOT_FOUND·no such table·terms_version null) |
| 5-7 | 미커밋: `routes/global-customs-fx.js`, `customs_invoice_test.mjs`(신규), `package.json`(test:customs), `5-7-prefail.md` | customs 6/6, wave_d 10/10, p1_api_data 14/14, honesty 16/16, fx 4/4 | `5-7-prefail.md`: 0/6(사업자번호 리터럴·지어낸 기본값·미설정 200·구 사업자 표시·중량 0.5) |
| 5-8 | 미커밋: `d1_69_policy_kst_effective.sql`, `lib/ledger.js`, `routes/{admin,catalog}.js`, admin `PolicyView.vue`, `admin.yaml`, `settlement_policy_test.mjs`(16-19), UTC→KST 핀(buyer/plp/trending/settlement/admin)·A4 재작성, `5-8-prefail.md` | settlement 19/19, rehearsal, admin29 27/27, buyer 25/25, plp 11/11 등 | `5-8-prefail.md`: 17/19(16 KST 비교 없음·17 단일 PK 덮어쓰기, 18·19는 실행 시각상 사전 통과) |
| 5-9 | 미커밋: `services/reminders.js`(신규), `lib/fake-discount.js`(신규), `d1_70_remind_notifs.sql`, `remind_notify_test.mjs`(신규), `index.js`·`routes/admin.js`·`services/orders.js`, `OmImage.vue`, `package.json`(test:remind), 핀 10종, `components_commerce`(C10), `5-9-prefail.md` | remind 18/18, commerce 10/10, rehearsal, test:ui 전체 | `5-9-prefail.md`: gateway 0/18(모듈 없음) + C10 9/10. 일괄 게이트 빨간훈련 17/18 후 18/18 |
| 5-10 | 미커밋: `scripts/ops/rehearse_phase5.py`(신규), `DEPLOY_RUNBOOK.md`(신규), `5-10-prefail.md`, rehearsal 로그 3종, `package.json`(rehearse:phase5) | rehearse apply+rollback PASS, rehearsal, wave-k 7/7, design_lint 4/4 | `5-10-prefail.md`: 스크립트 없음·런북 없음·20파일 미 리허설·d1_00 부재 기록 |
| 관문 | 미커밋: `LegalDocumentsView.vue:255` 빌드 수정, QUESTIONS Q-1-9 해소 기록, `5-1-prefail.md` UTF-16→UTF-8, 스모크·E2E 증거 재생성 | 3앱 `vite build` 성공, 관문 1~7항 | `gate-admin-build-prefail.log`: admin 빌드 실패(보간 `{{ '{{OPERATOR}}' }}` 파싱 오류) |

## 8. 다시 판정한 이전 작업(1-2, 1-9, 3-8)과 변경 이유

- 1-2 (실패 → 통과, 5-1): 운영자 결정 Q-1-2 (a)에 따라 대비 미달 4값을
  4.5:1 충족 값으로 교체(urgent 183 73 3·rating 155 108 0·
  soldout 117 117 108/다크 128 131 128). `theme.test.mjs` T04(미달값 고정)를
  지우고 T03이 9개 토큰 전부 + urgent-soft 위 urgent를 4.5 이상으로 검사.
  QUESTIONS Q-1-2에 해소 기록.
- 1-9 (실패 → 통과, 5-0): 기존 테스트가 고정한 5곳을 새 다이얼로그 방식으로
  전환(04af54a 5→4·a26d238 4→2·b6f45bb 2→0). 단어 경계 grep으로 3개 앱
  `alert(`/`confirm(`/`prompt(` 0건을 5-0에서 확인하고 5단계 관문에서 재검증.
  `confirm_dialogs` 5/5·`design_lint` 4/4 녹색. QUESTIONS Q-1-9에 해소 기록.
- 3-8 (통과 → 실패 → 통과): 5-0에서 주문 화면 색상 미전환·다크 캡처 없음을
  이유로 "실패(5-1에서 재작업)"로 변경. 5-1에서 검사기 사각(Q-3-11(c))을
  고치고 주문 2화면 285건을 토큰·`OmBadge`로 전환(CAPS 유지), 다크 캡처 8장으로
  "통과" 재판정. QUESTIONS Q-3-11(c)에 해소 기록.

## 9. "통과" 항목의 보류 메모 없음 확인

- `WORK_ORDER_QUESTIONS.md`에서 `미충족|사각|보류` 전수 검색 → 3건 적중,
  모두 해소 기록이 있거나 보류 항목이 아님:
  - Q-1-9 "미충족" 문구: 결정 전 실패 기록 + 5-0 해소 기록(위 §8). 보류 없음.
  - Q-3-11(c) "사각": 검사기 사각 기록 + 5-1 해소 기록(위 §8). 보류 없음.
  - Q-4-6 "반품 보류액": 롤링 리저브 표시 용어(결정 대기 항목 아님).
- "통과" 판정 중 미충족·사각·보류 메모가 남은 항목 없음(규칙 11 준수).
- 5단계에서 새로 결정이 필요한 상황은 발생하지 않아 `Q-5-N`을 발행하지 않음.
  정책 값 없음 → 기능 꺼짐 원칙 유지(5-4 오늘출발 필터·5-9 리마인드 모두
  정책 없을 때 0건으로 테스트됨). 5-4 어드민 키 추가 UI는 §5 후속 제안으로만 기록.

## 10. 부모 검증 추기 (2026-11-17, 관문 이후)

- 발견: 관문 종료 후 부모가 직접 `design_lint`를 돌리니 D01 실패 —
  `LegalDocumentsView.vue:255` 4건(cap 0). 관문 수정이 넣은 HTML 엔티티
  `&#123;`·`&#125;` 속 `#123`·`#125`를 16진 색상 검사(`/#[0-9a-fA-F]{3,8}\b/`)가
  잡았다. 즉 관문 당시 §2 관문표 3번 "4/4"은 수정분 적용 후 트리에서 성립하지
  않았다(관문은 수정 전·후 순서를 어긋나게 보고). 빌드 실패 진단 자체는
  정확했다: `{{ '{{OPERATOR}}' }}`는 첫 `}}`가 보간 종료로 파싱돼
  "Unterminated string constant"로 깨진다(`gate-admin-build-prefail.log`).
- 수정(미커밋): 플레이스홀더를 스크립트 상수
  `OPERATOR_TOKEN = '{{OPERATOR}}'`로 옮기고 템플릿은
  `{{ OPERATOR_TOKEN }}`으로 참조. 렌더 결과 동일, 빌드·검사 모두 녹색.
- 부모 직접 재검증(동일 트리): `design_lint` 4/4, `theme` 4/4,
  `npm run test:ui` 전체 exit 0(37개 스위트 전부 0 failed),
  `npm run build --workspace=apps/admin` 성공,
  `npm run typecheck --workspace=apps/admin` 깨끗함.
  `npm test` 전체·`test:browser`·스모크·Flutter·리허설은 관문 당일 실행
  결과를 그대로 인용(부모 미재실행).
- 커밋 대기: 5-1~5-10·관문·본 추기 수정분 미커밋.
  PROGRESS 1-2·3-8 해시란은 커밋 시 채울 것(현재 "미커밋").
