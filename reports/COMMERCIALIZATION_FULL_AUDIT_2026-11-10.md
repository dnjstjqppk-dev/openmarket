# 상용화 전수 감사 — 2026-11-10 (14:13 KST 스냅샷)

## 0. 방법과 한계 (먼저 읽을 것)

**한 일**
1. 전체 자동 테스트 재실행(40개 실행 단위): 39 통과 / 1 실패. 실패한 것은 `tests/ui/p1_store.test.mjs` 8/15.
   그 외 typecheck·build·`go test`(apps/api, backend)는 exit 0.
2. 이전 보고서 `COMMERCIALIZATION_REMAINING_2026-11-10.md`(169건)의 각 행을 현재 코드와 대조했다.
   이 보고서의 행 대부분은 † 표시(단일 출처, 교차검증 없음)였다.
   대조 결과, 이미 고쳐졌는데 "OPEN"으로 남은 행(거짓 양성)이 확인됐다(S01~S05, S10).
3. 이전 보고서가 다루지 않은 "기능 자체의 부재"를 영역별로 전수 검색했다(결제·세무·법정 표시·CS·모바일·연동·운영).
4. 신규 P0 2건은 로컬 하네스(node:sqlite + D1 shim)에서 **실제로 재현**했다.
   재현 스크립트: `C:\Users\dnjst\AppData\Local\Temp\claude\9e37e864c5c68e89\38668faa-2e5d-4602-a17a-cb5aa64fd0eb\scratchpad\repro_price_adjust.mjs`, `...\scratchpad\repro_welcome.mjs`

**한계**
- **이 감사 도중 다른 프로세스가 저장소를 수정하고 있었다.** 감사 시작 이후 `migrations/d1_41_store_cross_border_pccc.sql`, `tests/ui/p1_store.test.mjs`가 새로 생겼고, storefront 뷰 8개가 바뀌었다. 그래서 이 문서는 14:13 시점 스냅샷이다.
- 운영 환경(원격 D1, 시크릿, `/health`)은 조회하지 않았다. 승인 없이 원격에 접근하지 않는다는 규칙 때문이다. 운영 상태는 전부 "미확인"이다.
- P2 행은 시그니처 grep으로 일부만 재검증했다. 재검증하지 않은 행은 `CARRIED`로 표시했다.
- 법률 항목(전자상거래법·전자금융거래법·표시광고법 등)은 코드 관찰 사실과 "법률 검토 필요"까지만 적었다. 법적 결론은 내리지 않았다.
- 코드 감사는 미탐지(false negative)를 0으로 만들 수 없다. "이것이 전부"라고 증명할 수는 없고, 위 방법으로 찾은 것이 전부다.

**상태 표기**
- `OPEN`: 현재 코드에서 결함을 직접 확인함
- `FIXED-WT`: 커밋 안 된 작업트리에서 수정 확인 (+ 해당 테스트 통과). **커밋·배포 전**
- `IN-PROGRESS`: 다른 세션이 수정 중이며 테스트 실패 상태
- `CARRIED`: 이전 보고서 내용을 가져왔고 이번에 재검증하지 않음
- `EXTERNAL`: 코드로 해결 불가(계약·등록·사람 작업)

---

## 1. 신규 발견 — P0 (실제 재현 완료)

| ID | 내용 | 근거 | 재현 결과 | 수정 방향 |
|----|------|------|-----------|-----------|
| NEW-P0-01 | **최저가 보상(PRICE_ADJUSTMENT) 자금 유출.** 판매자가 가격을 잠깐 100원으로 내렸다가 되돌리면, 최근 30일 구매자 전원이 즉시 운영사 부담 적립금을 받는다. 상한·승인·가격 유지기간 조건이 없다. | `apps/cloudflare-gateway/src/routes/orders.js:175-196`, `PRICE_ADJUST_WINDOW_DAYS=30` (:14), 판매가 하한 100원 `routes/partner.js:23` | 196,365원 결제 → 판매자가 100원으로 인하 → 클레임 201, **적립금 +196,080원**. 가격 복구 200. 판매자 정산 `net_payout_amount 176,728`은 그대로. 공모 시 주문 1건당 약 17.6만원 순유출 | 정책 결정 필요(PO). 최소한 ① 인하 가격의 최소 유지기간 ② 보상 상한 ③ 판매자 부담 차감 또는 운영자 승인 ④ 판매자별 가격 이력 기반 판정 |
| NEW-P0-02 | **가입 즉시 1만원 적립금, 본인확인 없이 결제 100% 사용 가능.** 이메일 미인증 계정도 바로 결제할 수 있다. | `routes/auth.js:16,113` (WELCOME_CREDIT 10000), `services/orders.js:211-217` (적립금 사용 상한 = 결제액 전액), 체크아웃에 `email_verified` 검사 없음 | 신규 가입(email_verified=0) → 6,900원 상품 + 배송비 = 9,900원, **적립금 9,900 사용, 결제 0원으로 주문 생성(201)** | 웰컴 적립금은 이메일/휴대폰 인증 후 지급, 사용 조건(최소 주문액·사용 비율·기간) 정책화, 다계정 탐지 |

## 2. 신규 발견 — P1 (이전 보고서에 없음, 코드 직접 확인)

| ID | 영역 | 내용 | 근거 |
|----|------|------|------|
| NEW-01 | 모바일/출시 | **두 Flutter 앱 모두 `android/`, `ios/` 플랫폼 폴더가 없다.** APK/IPA 빌드와 스토어 제출이 불가능하다(`flutter test`만 가능). 앱 출시가 런칭 범위라면 P0 | `mobile/customer_app/`, `mobile/partner_app/` (lib, test, pubspec만 존재) |
| NEW-02 | 표시광고 | "AI 가공"이 실제 AI를 호출하지 않는다(파일에 `fetch` 없음). 상품명 키워드에 따라 "주변 소음 완벽 차단", "BLDC 고성능 모터 탑재", "검증된 글로벌 공식 공급업체 출고 정품", "엄격한 품질 검사(QC) 완료" 같은 **검증 안 된 문구를 상세설명에 삽입**한다. API 키가 하나라도 있으면 실제 호출 없이 `provider: VERTEX_AI`, `COMPLETED`, "GenAI 모델을 통한 실시간 심층 가공 완료"로 **거짓 보고**한다. 플래그 `ai_translation` 기본값 OFF | `services/crawler/ai-translator.js:60-111`, `routes/product-imports.js:102-140` |
| NEW-03 | 표시광고 | URL 수집 시 설명이 비어 있으면 `'<p>공식 공급업체 직출고 검증 정품 상품입니다.</p>'`를 넣는다(플래그와 무관) | `services/crawler/crawler-service.js:163` |
| NEW-04 | 연동 | 네이버 커넥터 페이로드의 하드코딩 값: A/S 전화 `02-1588-0000`, 가격 누락 시 `19900`, 재고 누락 시 `100`, 배송비 `FREE`, 설명 누락 시 "정품 보장". 현재는 `isLive=false`라 운영에서 501로 차단되지만, 실연동 시 그대로 나간다 | `services/connectors/naver-connector.js:43-70` |
| NEW-05 | 알림 | SMS 발신번호 기본값 `'15880000'`. 키만 넣고 발신번호를 안 넣으면 등록되지 않은 번호로 발송을 시도한다 | `routes/features.js:455` |
| NEW-06 | 저장소 | R2 바인딩이 없다(`wrangler.jsonc`에 `r2_buckets` 없음). 그래서 모든 업로드(상품 이미지, **사업자등록증·통장사본 같은 입점 서류** 포함)가 **base64로 D1 행에 저장**된다. 업로드 한도는 10MB로 표기돼 있지만 D1 행 크기 제한(약 2MB)을 넘으면 실패할 것으로 보인다(**실측 안 함**). 입점 서류는 평문으로 DB에 저장된다 | `routes/storage.js:93,102-131`, `apps/cloudflare-gateway/wrangler.jsonc` |
| NEW-07 | 결제 | 웹은 **카드 결제만** 된다(`requestPayment('카드')` 3곳). 계좌이체·가상계좌·간편결제(토스페이/카카오페이/네이버페이)는 없다. 반면 현금영수증 로직은 가상계좌/계좌이체 전용이라, 지금은 실제로 쓰일 일이 없다 | `apps/storefront/src/views/CheckoutView.vue:229`, `OrderDetailView.vue:276`, `PaymentResultView.vue:74`, `routes/finance.js:11,230` |
| NEW-08 | 결제 | 웹은 Toss **v1 SDK(API 개별 연동)**, 모바일은 **결제위젯 SDK**를 쓰는데, 서버는 하나의 `TOSS_CLIENT_KEY`만 내려준다. Toss는 두 방식에 서로 다른 키를 발급하므로 한쪽이 실패할 가능성이 높다(**실키로 미검증**) | `routes/payments.js` (payments/config), `apps/storefront/src/views/CheckoutView.vue:199`, `mobile/customer_app/lib/views/payment_view.dart` |
| NEW-09 | CS | 고객 1:1 문의는 접수(POST)와 본인 조회(GET)만 있다. **관리자 답변 API도, 관리자 화면도 없어서** 접수된 문의가 처리될 경로가 없다 | `routes/features.js:304-325`, admin 라우트에 inquiry 관련 없음 |
| NEW-10 | 법정 표시 | 판매자 스토어에 표시되는 판매자 신원 정보는 사업자등록번호뿐이다. 대표자명·사업장 주소·전화·이메일·통신판매업 신고번호가 없다. 통신판매중개자의 판매자 정보 제공 의무(전자상거래법 §20)에 해당하는지 **법률 확인 필요** | `apps/storefront/src/views/SellerStoreView.vue:68-90` |
| NEW-11 | 법정 표시 | **상품정보제공고시**(품목별 필수 고시 항목) 데이터 모델·입력 UI·상세 표시가 전혀 없다 | 전 저장소 `notice_info/정보제공고시` 0건 |
| NEW-12 | 법정 표시 | **KC 인증번호**(전기용품·생활용품·어린이제품) 필드와 표시가 없다. 중개자 확인 의무 관련 **법률 확인 필요** | 전 저장소 0건 |
| NEW-13 | 보안 | 관리자 2FA 최초 등록 시 SUPER_ADMIN 승인은 env `ADMIN_MFA_APPROVAL_REQUIRED='true'`일 때만 동작한다(opt-in). 운영에 설정하지 않으면 P1-C06이 그대로 열려 있다 | `tests/p1_sec_test.mjs:176-185`, `routes/admin-security.js` |
| NEW-14 | 정산 | 판매자 지급은 관리자가 "송금 완료(transferred)"를 손으로 표시하는 방식이다. 이체(펌뱅킹/지급대행) 연동이 없다. 구매대금을 받아 판매자에게 지급하는 구조가 **전자금융거래법상 PG(전자지급결제대행) 등록 대상인지, 또는 PG사 지급대행으로 풀어야 하는지 법률 검토 필요** | `routes/finance.js` (`payouts/:id/transferred`) |
| NEW-15 | 세무 | 현금영수증은 운영자가 수동으로 "발행" 처리하고 승인번호를 직접 입력한다(국세청/PG API 없음, 코드 주석도 인정). 판매자 **수수료 세금계산서** 발행 기능은 없다 | `routes/finance.js:212,276-290` |
| NEW-16 | DB/배포 | `d1_40`, `d1_41` 마이그레이션이 미커밋이고 운영 적용 여부는 미확인이다. 운영 D1의 스키마 수준을 알 방법(버전 테이블)이 없다(P2-R1과 연결) | `migrations/d1_40_*.sql`, `d1_41_*.sql` (untracked) |
| NEW-17 | 형상관리 | 작업트리에 커밋 안 된 수정이 80개 이상 쌓여 있다(P0·P1 수정 대부분 포함). 유실 위험이 있고 배포 근거가 남지 않는다 | `git status` |

## 3. 신규 발견 — P2

| ID | 내용 | 근거 |
|----|------|------|
| NEW-18 | 서버 오류 외부 알림(Sentry/APM/알림 채널)이 없다. 클라이언트 오류는 D1 테이블에만 쌓인다 | `routes/client-errors.js`, 저장소 내 sentry 등 0건 |
| NEW-19 | 상품 검색이 `title/description_html LIKE '%q%'` 풀스캔이다. 형태소 분석·랭킹이 없고, 규모가 커질수록 느려진다(**부하 미측정**) | `routes/catalog.js:155-156`, `routes/features.js:37-48` |
| NEW-20 | 도서산간/제주 추가 배송비 모델이 없다 | 저장소 0건 |
| NEW-21 | 모바일 푸시(FCM/APNs)가 없다 | pubspec·코드 0건 |
| NEW-22 | 모바일 토큰을 `shared_preferences`(평문)에 저장한다. `flutter_secure_storage`가 아니다 | `mobile/*/pubspec.yaml` |
| NEW-23 | 휴대폰 본인인증(PASS 등)이 없다. 웰컴 적립금 어뷰징 방지, 성인상품, 판매자 대표자 확인에 필요한지 **PO 결정 필요** | 저장소 0건 |
| NEW-24 | Go 백엔드(`backend/`, `apps/api`)는 운영 요청 경로에 없는데 CI와 `npm test`에 포함돼 있다. 유지할지 삭제할지 결정 필요 | `package.json` `test:go` |
| NEW-25 | 모든 외부 마켓/공급사/3PL 커넥터(쿠팡·네이버·11번가·Amazon·국내 B2B·3PL)가 스텁이다(`isLive=false`, 운영 501). 멀티채널이 상용 범위라면 기능 전체가 미구현이다 | `services/connectors/simulation.js:1-20`, `base-connector.js:9` |

---

## 4. 이전 보고서 169건 재검증 결과

### 4.1 P0 (이전 5건)
| ID | 상태 | 비고 |
|----|------|------|
| P1-A07 | FIXED-WT | `LedgerAuditView.vue:47-51` 승인 confirm에 금액 표시 |
| OPS-01 운영 시크릿 | EXTERNAL / 미확인 | |
| OPS-02 Toss 실가맹 | EXTERNAL | |
| OPS-04 운영 사업자 등록 | EXTERNAL | |
| OPS-N01 | FIXED-WT | `GO_LIVE_CHECKLIST.md`가 NO-GO로 정정됨 |

### 4.2 storefront P1
| ID | 상태 | 비고 |
|----|------|------|
| P1-S01 | FIXED-WT | coupons fetch에 authHeader |
| P1-S02 | FIXED-WT | else/catch 처리 |
| P1-S03 | FIXED-WT | "+100P" 문구 없음 |
| P1-S04 | FIXED-WT | 'CJ대한통운' 폴백 없음 |
| P1-S05 | FIXED-WT | 가짜 폴백 제거(placeholder만 남음) |
| P1-S06 | OPEN | `ProfileView.vue:114` `length < 6` vs :430 "10자 이상" |
| P1-S07 | OPEN / IN-PROGRESS | 알림 동의 체크박스가 서버로 전송·로딩되지 않음, 테스트 실패 |
| P1-S08 | OPEN / IN-PROGRESS | `AddressesView.vue:103` `'00000'` 대체, 테스트 실패 |
| P1-S09 | OPEN / IN-PROGRESS | 약관에 "(주)올모아" 하드코딩 + 에스크로를 사실처럼 단정, 테스트 실패 |
| P1-S10 | FIXED-WT | `say(..., 'warn')` 처리 |
| S-N01 PCCC 강제 | IN-PROGRESS | d1_41 추가됨, 테스트 2건 실패 |
| S-N02 결제 재개 | IN-PROGRESS | 테스트 실패 |

### 4.3 admin P1 (모두 현재 코드에서 확인)
| ID | 상태 | 확인 내용 |
|----|------|-----------|
| P1-A01 | OPEN | `main.ts:12` 토큰 존재만 검사, 역할별 라우트 가드 없음 |
| P1-A02 | OPEN | 모바일 메뉴(:107~)에 orders/users/reviews/coupons/categories 없음 |
| P1-A03 | OPEN | "정상 가동"/"동기화 완료" 고정 문구(:145,148) |
| P1-A04 | OPEN | `.catch(()=>({}))` 다수, `catch(_){}` |
| P1-A05 | OPEN | `loading`을 템플릿에서 쓰지 않음 |
| P1-A06 | 부분 | errorMsg는 표시됨, isLoading은 템플릿에서 안 씀 |
| P1-A08 | OPEN | confirm 없음, catch 무시 |
| P1-A09 | OPEN | 동일 |
| P1-A10 | OPEN | `movePo` CANCELLED confirm 없음 |
| P1-A11 | OPEN | "Approve Payout" 버튼이 라우팅만 함 |
| P1-A12 | OPEN | "즉시 블라인드 (Takedown)" 라벨인데 API 없음 |
| P1-A13 | OPEN | 감사로그 조회 API·화면 없음 |
| P1-A14 | OPEN | `adminApi` 네트워크 예외 미처리 |
| A-N01 | OPEN | `PartnerApplicationsView.vue:74` 계좌 전체 노출 |
| A-N02 | OPEN | 최대할인액 입력 UI 없음 |

### 4.4 partner P1
| ID | 상태 | 확인 내용 |
|----|------|-----------|
| P1-T02 | OPEN | `ShipmentView.vue:150` 송장번호 자동 생성 |
| P1-T03 | OPEN | `if (res.ok)`만 처리, catch 무시 |
| P1-T04 | OPEN | :351 DELIVERED가 "출고 대기"로 표시됨 |
| P1-T06 | OPEN | 가격 PUT이 `WHERE product_id = ?`로 전 SKU를 덮어씀(`partner.js` 가격 갱신) |
| P1-T10 | OPEN | 클라이언트 `BI_WEEKLY` vs 서버 `BIWEEKLY`, 서버는 조용히 무시 |
| P1-T11 | CARRIED | |
| P1-T12 | OPEN | 실패 시 console만 |
| P1-T13 | OPEN | 동일, BiddingView `.catch(()=>null)` |
| P1-T14 | OPEN | 프런트에 `listings/publish` 호출 없음(서버 라우트는 있으나 커넥터가 501) |
| P1-T15 | OPEN | 게시는 단건 결과에서만 가능 |
| T-N01 | OPEN | SettlementView에 payouts/adjustments 없음 |
| T-N05 | CARRIED | |

### 4.5 API·데이터·보안 P1 — 전부 FIXED-WT (미커밋·미배포)
P1-P01~P06, P1-D01·D02·D03·D05, P-N01, P1-C01~C10, C-N01.
- 근거: `tests/p1_api_data_test.mjs` 14/14, `tests/p1_sec_test.mjs` 14/14 통과.
- 코드 직접 확인: C01(IPv6/리다이렉트), C02(allowlist sanitizer), C03(고객 403), C04(`maskPhone`), C05(`PAYMENT_WEBHOOK_SECRET`).
- 운영 반영 조건: d1_40 적용 + 배포 + `ADMIN_MFA_APPROVAL_REQUIRED=true`(NEW-13), `PAYMENT_WEBHOOK_SECRET` 설정.

### 4.6 mobile P1
| ID | 상태 | 확인 내용 |
|----|------|-----------|
| P1-M01 | OPEN | `recommended_categories` 미사용 |
| P1-M02 | OPEN | 택배사 6개, 주석의 "web과 동일"은 거짓 |
| P1-M03 | OPEN | 실패 시 `return []` |
| P1-M04 | OPEN | 쿠폰·적립금·PCCC·quote 없음 |
| P1-M05 | OPEN | 장바구니 수량·삭제·저장 없음 |
| P1-M07 | CARRIED | |
| N-01 | CARRIED | |
| N-02 | CARRIED | |
| N-03 | OPEN | `home_view.dart:112,122` "최대 90% 할인", "최저가 보장제" |

### 4.7 ops P1 — 전부 EXTERNAL 또는 문서 작업
OPS-03 택배 API, OPS-05 관리자 2FA 등록, OPS-07 QA 서명, OPS-08 실기기 캡처, OPS-09 약관 법률검토, OPS-11 외부 계약 7종, OPS-12 DNS/HSTS, OPS-N02 `UNIPASS_API_KEY` 문서화, OPS-N03 롤백 런북.

### 4.8 P2 (85건) — 이번에 재검증한 것
- **OPEN 확인**: S-N03, P2-S04, S05, S06, S13, S16, A-N04, P2-A01, A02, A03, A04, A05, A06, A07, A10, T-N02, T-N04, P1-T08, P1-T16, P2-T01, T03, T05, P2-MOB-04, P2-SEC-03, SEC-07, SEC-08, SEC-12, P2-R1
- **FIXED 추정**: P2-S03(VerifyEmailView에서 `send-verification` 호출 확인)
- **나머지는 CARRIED**: 이전 보고서 §P2 표 참조

---

## 5. 코드로 해결 불가 — 사람·계약·법률 (런칭 전 필수)
1. 사업자등록(개인→법인 전환 계획 포함)과 관리자 화면에서 운영 사업자 등록·활성화(OPS-04)
2. 통신판매업 신고, 구매안전서비스(에스크로) 등록과 참조번호 입력
3. Toss Payments 실가맹 심사, live 키, 결제수단 추가 계약(NEW-07)과 위젯/API 키 정리(NEW-08)
4. **전자금융거래법 해당 여부 법률 검토**(정산대금 보관·지급 구조, NEW-14)
5. 약관·개인정보처리방침·환불정책 법률 검토와 확정(OPS-09). 개인정보 국외이전(Cloudflare) 고지 포함
6. 택배사 계약과 추적 API(OPS-03), UNI-PASS 키(OPS-N02)
7. Resend 도메인 인증, SOLAPI 발신번호 사전등록(NEW-05), 카카오 로그인 검수
8. 도메인·DNS·HSTS(OPS-12)와 컷오버 재빌드(OPS-N05)
9. Cloudflare 유료 플랜, R2 버킷 생성(NEW-06)
10. 앱스토어·플레이 개발자 계정(NEW-01과 함께)
11. 운영 시크릿 설정과 `/health` 확인(OPS-01), `ADMIN_MFA_APPROVAL_REQUIRED=true`
12. 관리자 2FA 등록(OPS-05), 사람 QA 서명(OPS-07), 실기기 캡처(OPS-08)
13. 정책 결정(PO): 최저가 보상(NEW-P0-01), 웰컴 적립금(NEW-P0-02), 본인인증 여부(NEW-23), 멀티채널 범위(NEW-25), 앱 출시 범위(NEW-01)

## 6. 집계 (14:13 스냅샷)
- 신규: P0 2 · P1 17 · P2 8 = **27건**
- 이전 169건 중 재검증
  - FIXED-WT: P0 2 + store 6 + api/data/sec 22 = **30건**. 커밋·배포 전이며 거짓 양성이었던 S01~S05, S10을 포함한다
  - FIXED 추정: 1건(P2-S03)
  - OPEN 확인: store 1 + admin 14 + partner 10 + mobile 6 + P2 28 = **59건** (+ A06 부분 수정)
  - IN-PROGRESS: 5건
  - EXTERNAL: 12건
  - 나머지 **CARRIED**(재검증 안 함, 주로 P2)
- 자동 테스트: 40 실행 중 39 통과, `p1_store` 8/15 실패(다른 세션 작업 중)
