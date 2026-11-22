# OLMOA 오픈마켓 상용화 준비 전수 점검 보고서 (2026-11-22)

- **점검 일시**: 2026-11-22 14:37~15:07 KST
- **점검 기준 브랜치 / 커밋**: `work-order/full` @ `c6270f2` (`origin/main` @ `50c0d4a` 대비 **101커밋 선행**, 1,355개 파일 변경)
- **운영 서버 실측 대상**: `https://olmoa-api.dnjstjqppk.workers.dev`, `https://openmarket.dnjstjqppk.workers.dev`, `https://olmoa-admin.dnjstjqppk.workers.dev`, `https://olmoa-partner.dnjstjqppk.workers.dev`, `https://olmoa.com`, `https://api.olmoa.com`
- **점검 방식**: 정적 코드 전수 스캔, 전체 Node 테스트 스위트·익스플로잇·타입체크·빌드·Flutter 분석/테스트 직접 실행, 원격 Cloudflare `/health`·시크릿·R2 버킷·DNS 라이브 조회

---

## 1. 최종 종합 판정

| 관점 | 판정 | 요약 |
| :--- | :---: | :--- |
| **소프트웨어(코드) 완성도** | **READY (약 97%)** | 커머스 코어·결제/회계 원장·정산·보안·관리자/파트너/스토어프론트·모바일 2앱·B2B 소싱/멀티채널/3PL/SEO 확장까지 구현 및 자동화 테스트 검증 완료 (미세 코드 정리 4건 잔존) |
| **실제 공개 상용화 (Public Go-Live)** | **NO-GO (출시 불가)** | **운영 반영 미실시(`d1_50` 정체, 101커밋 미병합) + 사업자/결제 비활성 + 운영 시크릿 4개 외 미주입 + 커스텀 도메인(`olmoa.com`) 미개통 + 외부 계약/법무/실기기 검수 미완료** |
| **내부 파일럿 / 스테이징 테스트** | **CONDITIONAL GO** | `*.workers.dev` 환경 또는 로컬 인메모리 D1에서 내부 시나리오 검증 가능 (단, 현재 원격 서버는 `d1_50` 구버전이며 체크아웃 차단 중) |

> **핵심 결론**: "코드 개발" 자체는 실제 오픈마켓 상용 서비스 수준에 거의 도달했으나, **지금 당장 일반 고객을 받아 판매를 시작할 수 있는 상태(상용화 완료)는 아닙니다.** 최신 코드가 아직 운영 서버에 배포조차 되지 않았고, 결제·사업자·도메인·외부 연동 키·법무 확정 등 필수 상용 블로커가 모두 열려 있습니다.

---

## 2. 코드베이스 규모 및 아키텍처 실측

| 영역 | 경로 | 실측 규모 | 상태 |
| :--- | :--- | :--- | :--- |
| **Edge API Gateway** | `apps/cloudflare-gateway/src/` | JS 모듈 **118개** (Workers ESM + D1 + R2 + RateLimit + Cron) | 구현 완료 (Fail-Closed 설계) |
| **DB 마이그레이션** | `migrations/d1_*.sql` | **75개** (`d1_00` ~ `d1_74_seo_crawl.sql`) | 로컬 리허설 통과 / 원격은 `d1_50`까지 적용 |
| **Storefront (구매자 웹)** | `apps/storefront/src/` | Vue SFC **53개** (Vue 3 + TS + PWA + SEO/JSON-LD) | 타입체크·빌드 통과 |
| **Admin Console (관리자)** | `apps/admin/src/` | Vue SFC **36개** (Vue 3 + TS + PWA + 2FA/RBAC) | 타입체크·빌드 통과 |
| **Partner Hub (판매자)** | `apps/partner/src/` | Vue SFC **31개** (Vue 3 + TS + PWA + 멀티채널/정산) | 타입체크·빌드 통과 |
| **공용 UI 패키지** | `packages/ui/` | `@olmoa/ui` 디자인 시스템 + 토큰 + Lucide 아이콘 | 타입체크·디자인 린트 통과 |
| **모바일 앱 (Flutter)** | `mobile/customer_app`, `mobile/partner_app` | 고객앱 + 파트너앱 2종 (Android APK/AAB 빌드 검증, iOS 미실시) | Analyze 0건 / 118 테스트 통과 |
| **자동화 테스트** | `tests/` | JS/MJS 테스트 파일 **117개** + Flutter 테스트 2앱 | 아래 §3 실측 결과 참조 |
| **CI/CD 워크플로우** | `.github/workflows/` | `ci.yml`, `deploy.yml`, `migrate-d1-remote.yml` | `main` 푸시 시 5워커 자동배포 |

---

## 3. 직접 실행 검증 결과 (2026-11-22 실측)

### 3.1 테스트·빌드·정적 분석 결과

| 검증 항목 | 실행 명령 | 결과 | 상세 근거 |
| :--- | :--- | :---: | :--- |
| **전체 Node 테스트 (체인)** | `npm run test` + 후속 5종 단독 실행 | **부분 실패 (101/102 스위트 통과)** | 총 **1,011 PASS / 1 FAIL**. 유일한 실패는 `test:openapi`의 Windows CRLF 파서 이슈(§5.1). 후속 5종(`sourcing` 5/5, `channels` 8/8, `fulfillment` 9/9, `seo` 11/11, `e2e` 26/26) 모두 100% 통과 |
| **보안·회계 정합성 스위트** | `npm run test:security` | **PASS (88/88)** | JWT/RBAC/2FA/IP허용목록/오버셀 경합/복식부기 시산표(R01~R21)/개인정보 파기 88/88 통과 |
| **익스플로잇 방어 검증** | `npm run test:exploits` | **PASS (0/18 취약)** | 위조 토큰, 헤더 스푸핑, 미인증 웹훅, 오버셀 등 18종 공격 전부 `BLOCKED` |
| **DB 마이그레이션 FK 리허설** | `npm run test:migrations` | **PASS** | `d1_20`..`d1_74` Foreign Keys ON 적용 무오류 (`orders:5, sub_orders:5, order_items:5, settlements:5`) |
| **기능 E2E (V3 계약)** | `npm run test:e2e` | **PASS (26/26)** | 회원가입~결제~배송~정산~통관~KYB~FDS~시산표 대조 26/26 통과 |
| **상용화 확장 트랙 4종** | `test:sourcing`, `channels`, `fulfillment`, `seo` | **PASS (33/33)** | B2B 소싱 5/5, 멀티채널 로테이션 8/8, 무인발주/송장 9/9, SEO/IndexNow 11/11 |
| **UI 계약·디자인 린트·문구 정직성** | `test:ui` 체인 포함 | **PASS** | `design_lint` 4/4, `confirm_dialogs` 5/5, `copy_honesty` 13/13, UI 전 스위트 0 failed |
| **TypeScript 타입 체크** | `npm run typecheck` | **PASS (0 error)** | `@olmoa/ui`, `storefront`, `admin`, `partner` 4개 워크스페이스 전부 exit 0 |
| **게이트웨이 구문 검사** | `npm run lint` | **PASS** | `node --check apps/cloudflare-gateway/src/index.js` exit 0 |
| **프론트엔드 프로덕션 빌드** | `npm run build` | **PASS** | `storefront`, `admin`, `partner` 3개 앱 Vite 프로덕션 빌드 모두 성공 |
| **Flutter 고객앱** | `flutter analyze` + `flutter test` | **PASS (0 / 76)** | 분석 이슈 0건, 76/76 테스트 통과 |
| **Flutter 파트너앱** | `flutter analyze` + `flutter test` | **PASS (0 / 42)** | 분석 이슈 0건, 42/42 테스트 통과 |
| **로컬 런타임 스모크** | `npm run test:runtime` | **미실행 (서버 미기동)** | `127.0.0.1:8787` 로컬 워커 사전 기동 필요 (`ECONNREFUSED`) |
| **CSpell 스펠체크** | `npx cspell ...` | **WARN (미등록 단어 존재)** | 신규 확장 코드(`admin.js`, `seo-head.js`, `pii-crypto.js` 등)에 사전에 없는 약어/용어 다수 검출 |

### 3.2 라이브 운영 인프라 실측 (2026-11-22 14:38~15:00 KST)

#### (1) `GET https://olmoa-api.dnjstjqppk.workers.dev/health` 응답 실측
```json
{
  "status": "UP",
  "brand": "OLMOA",
  "version": "2.0.0-v3-integrity",
  "environment": "production",
  "databaseStatus": "CONNECTED_D1",
  "activeProductsInD1": 64,
  "schemaVersion": "d1_50_wave_e_fds_purchase.sql",
  "migrationsApplied": 51,
  "readiness": {
    "auth_configured": true,
    "operator_entity_active": false,
    "payment": "DISABLED",
    "email_delivery": "NOT_INTEGRATED",
    "carrier_tracking_api": "NOT_INTEGRATED",
    "supplier_order_api": "NOT_INTEGRATED"
  }
}
```

#### (2) 엔드포인트 및 커스텀 도메인 실측
| URL | HTTP 상태 | HSTS 헤더 | 비고 |
| :--- | :---: | :---: | :--- |
| `https://olmoa.com` | **DNS 해석 실패** | - | 도메인 미등록 또는 DNS 미연결 |
| `https://api.olmoa.com/health` | **DNS 해석 실패** | - | 도메인 미등록 또는 DNS 미연결 |
| `https://olmoa-api.dnjstjqppk.workers.dev/health` | **200 OK** | - | 구버전(`d1_50`) 동작 중 |
| `https://openmarket.dnjstjqppk.workers.dev` | **200 OK** | 없음 | `*.workers.dev` 스테이징 주소 |
| `https://olmoa-admin.dnjstjqppk.workers.dev` | **200 OK** | 없음 | `*.workers.dev` 스테이징 주소 |
| `https://olmoa-partner.dnjstjqppk.workers.dev` | **200 OK** | 없음 | `*.workers.dev` 스테이징 주소 |

#### (3) Cloudflare 원격 리소스 실측
- **D1 Database (`openmarket-db`, `6935e21b-ffdc-47d1-8e7d-d97b1b8b317a`)**: 정상 연결, 단 마이그레이션은 **`d1_50`까지만 적용됨 (`d1_51`~`d1_74` 24개 미적용)**.
- **R2 Bucket (`olmoa-media`)**: `npx wrangler r2 bucket list` 실측 결과 **이미 생성되어 있음** (`creation_date: 2026-11-11T06:43:18.681Z`). `apps/cloudflare-gateway/wrangler.jsonc`의 `STORAGE_BUCKET` 바인딩 준비 완료.
- **Worker Secrets (`npx wrangler secret list`)**: 현재 **4개만 등록됨**
  - 등록 완료 (4개): `ALLOWED_ORIGINS`, `JWT_SECRET`, `PII_ENCRYPTION_KEY`, `TOTP_ENCRYPTION_KEY`
  - **미등록 (코드 참조 41개 중 잔여 필수/권장 항목)**:
    - 결제(P0): `PAYMENT_MODE=live`, `TOSS_SECRET_KEY`, `TOSS_CLIENT_KEY`, `TOSS_WIDGET_CLIENT_KEY`
    - 운영/보안(P0/P1): `PUBLIC_STOREFRONT_URL`, `ADMIN_2FA_REQUIRED`, `ADMIN_MFA_APPROVAL_REQUIRED`, `RATE_LIMIT_REQUIRED`, `SENTRY_DSN`, `ALERT_WEBHOOK_URL`
    - 메일/알림/소셜(P1): `RESEND_API_KEY`, `EMAIL_FROM`, `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_SENDER_NUMBER`, `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `KAKAO_REDIRECT_URI`, `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`
    - 통관/사업자/외부연동(P1/P2): `CARRIER_WEBHOOK_SECRET`, `UNIPASS_API_KEY`, `NTS_API_KEY`, `PRICESCANNER_API_KEY`, `INDEXNOW_KEY`, `SMARTSTORE_*`, `COUPANG_*`, `DOMEME_*`, `OWNERCLAN_*`, `ONCHANNEL_*`, `CJ_*`

---

## 4. 상용화 차단 블로커 (P0 / P1)

### 4.1 즉시 출시를 막는 P0 블로커 (5건)

| ID | 분류 | 현황 | 상용화를 위해 필요한 조치 |
| :---: | :--- | :--- | :--- |
| **BLK-01** | **배포·DB 불일치** | `work-order/full`(101커밋, `d1_74`)이 `main`에 미병합. 원격 운영 서버는 `d1_50`에 정체 (`d1_51`~`d1_74` 24개 마이그레이션 미적용) | 운영 D1 백업 → 사본 리허설 → `main` 병합 → `migrate-d1-remote.yml`(APPLY) → 5워커 순차 배포 (`DEPLOY_RUNBOOK.md` 준수) |
| **BLK-02** | **운영 사업자 미활성** | 라이브 `/health`에서 `operator_entity_active: false`. 체크아웃 시 `OPERATOR_NOT_CONFIGURED`로 주문 자체가 차단됨 | 사업자등록·통신판매업 신고·에스크로 가입 후 어드민 `/business`에 실정보 등록·활성화 |
| **BLK-03** | **실결제 PG 미연동** | 라이브 `/health`에서 `payment: "DISABLED"`. Toss Payments 실가맹 키(`TOSS_SECRET_KEY`, `TOSS_CLIENT_KEY`, `TOSS_WIDGET_CLIENT_KEY`) 미등록 | Toss Payments 실가맹 계약 완료 → 웹/모바일 키 분리 주입 + `PAYMENT_MODE=live` 설정 → 소액 실결제·취소 1건 검증 |
| **BLK-04** | **커스텀 도메인 미개통** | `olmoa.com`·`api.olmoa.com` DNS 해석 불가. `.github/workflows/deploy.yml`의 `VITE_*` 4종이 모두 `*.workers.dev`로 고정, HSTS 미적용 | 도메인 등록 → Cloudflare DNS/Custom Domain 연결 → HSTS/301 리다이렉트 → `ALLOWED_ORIGINS`/`PUBLIC_STOREFRONT_URL` 갱신 → `deploy.yml` 교체 후 재빌드·재배포 (`DOMAIN_CUTOVER_RUNBOOK.md`) |
| **BLK-05** | **법무 검토 및 정책 확정** | 약관·개인정보처리방침·환불정책 페이지에 법무 검토 전 초안 안내가 존재하며, 운영 수수료·쿠폰 분담·적립·등급·오늘출발 등 핵심 상업 정책(결정-01~14) 미확정 | 로펌/법무 검토 후 어드민 `/legal`에 정식 약관 발행, 운영 정책 수치 확정 및 DB 반영 |

### 4.2 상용 운영 품질을 위한 P1 항목 (계약·외부·인간 검수)

1. **트랜잭션 메일 & 문자/알림톡**: Resend 도메인 인증(SPF/DKIM) + `RESEND_API_KEY` (현재 비밀번호 재설정/이메일 인증/주문 메일 발송 불가), Solapi SMS/알림톡 키.
2. **소셜 로그인**: 카카오 디벨로퍼스 정식 앱 심사 및 `KAKAO_*` 시크릿 + `api.olmoa.com` 콜백 URL 등록.
3. **택배·통관·사업자 검증**: 택배사/추적 API 계약 및 `CARRIER_WEBHOOK_SECRET`, 관세청 `UNIPASS_API_KEY`(현재 형식 검증 `FORMAT_ONLY`), 국세청 `NTS_API_KEY`.
4. **운영 보안 강화**: 관리자 계정 TOTP 2FA 등록 완료, `ADMIN_2FA_REQUIRED=true` / `ADMIN_MFA_APPROVAL_REQUIRED=true` / `RATE_LIMIT_REQUIRED=true` 설정, Sentry DSN 및 장애 알림 `ALERT_WEBHOOK_URL` 주입, Cloudflare Paid 플랜(D1 Time Travel 30일 보관 등).
5. **멀티채널·B2B 실연동 키**: 스마트스토어·쿠팡·도매매·오너클랜·온채널·CJ 등 실 API 키 미발급(현재 모든 커넥터가 안전하게 fail-closed 격리되어 있으며 관련 Feature Flag도 기본 OFF).
6. **인간 검수 및 모바일 스토어 출시**: `reports/HUMAN_CHECKLIST.md`의 스크린샷 348장 육안 검수, Android/iOS 실기기 테스트, 서명 키스토어 생성, macOS iOS IPA 빌드, Google Play / App Store 개발자 계정 제출.

---

## 5. 이번 전수 코드 점검에서 발견된 코드 레벨 잔여 이슈 (P2/P3)

실제 상용화 배포 전에 정리해 두면 좋은 코드/테스트/문서 수준의 결함입니다.

1. **[P2] Windows 환경에서 `test:openapi` 실패 (`tests/openapi_reconciliation_test.mjs:414`)**
   - `parseDocumented()`가 `index.split('\n')`으로 줄을 나눈 뒤 `/^  (\/api\/\S+):$/`로 매칭합니다.
   - Windows 체크아웃에서 `docs/openapi/openapi.yaml`에 CRLF(`\r\n`)가 들어가면 줄 끝에 `\r`이 남아 **0건으로 파싱되며 `npm test` 체인이 중간에 중단**됩니다. (동일 파일에서 `\r\n`을 제거하면 320개 경로가 정상 파싱됨을 확인했습니다. Linux CI `ubuntu-latest`는 LF이므로 통과.)
   - **권장 조치**: `read(...)` 또는 `split(/\r?\n/)`로 개행 정규화.

2. **[P2] 크롤러 썸네일 외부 Unsplash 폴백 하드코딩 잔존 (`apps/cloudflare-gateway/src/services/crawler/crawler-service.js:200`)**
   - 이미지 추출 실패 시 `thumbnail_url: extracted.images[0] || 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e'`로 외부 더미 이미지를 자동 삽입합니다.
   - 또한 파트너 CSV/URL 임포트 샘플 코드(`apps/partner/src/views/BulkUploadView.vue:28-30`, `UrlImportView.vue:147,160,179`)에도 Unsplash URL 예시가 남아 있습니다.
   - **권장 조치**: `crawler-service.js:200`은 빈 문자열(`''`) 또는 내부 기본 에셋으로 교체해 실제 상품에 무관한 헤드폰 사진이 노출되는 사고를 차단.

3. **[P2] 멀티채널 커넥터 이중 계층 공존 (`services/connectors/*` vs `services/channels/*`)**
   - 구 계층(`routes/multichannel.js` + `services/connectors/*`)에는 `SANDBOX_STUB`과 `Math.random()` 가상 주문/운송장 생성 코드가 남아 있습니다.
   - 단, `routes/multichannel.js` 상단의 `assertConnectorUsable()` 가드가 `ENVIRONMENT=production`에서 외부 호출 시 **`501 CONNECTOR_NOT_INTEGRATED`로 fail-closed 차단**하므로 당장 운영에서 가짜 주문이 생성되지는 않습니다.
   - 신 계층(`routes/channels-ops.js`, `services/channels/*`, `services/sourcing/*`, `services/fulfillment/*`)은 Zero-Mock fail-closed로 별도 구현되어 있으므로, 실키 연동 시 구 `services/connectors/*` 시뮬레이션 코드를 신 계층으로 일원화하는 것을 권장합니다.

4. **[P3] CSpell 미등록 단어 정리 필요**
   - `apps/cloudflare-gateway/src/routes/admin.js`, `lib/seo-head.js`, `lib/pii-crypto.js`, `lib/http.js` 등 Phase 4~5 및 확장 트랙에서 추가된 식별자(`yday`, `dtype`, `dval`, `exag`, `hreflangs`, `llms`, `mojibake`, `unblind` 등)가 `cspell.json`에 미등록되어 있습니다.

5. **[P3] 모바일 앱 잔여 기능 (`mobile/RELEASE.md`)**
   - 파트너앱 FCM 푸시 플러그인 미배선(토큰 API만 준비), 푸시 탭 딥링크 미구현, iOS macOS 빌드 미실시.

6. **[P3] 과거 보고서 간 스냅샷 불일치**
   - `reports/GO_LIVE_CHECKLIST.md`(2026-11-13 기준, `d1_51/d1_52` 언급)와 `reports/WORK_ORDER_PHASE5_2026-11-17.md`(`d1_70` 기준) 등은 과거 시점 스냅샷입니다. 현재 최신 기준은 `reports/WORK_ORDER_PHASE5/DEPLOY_RUNBOOK.md`(`d1_51`~`d1_74`) 및 본 보고서(`2026-11-22`)를 정본으로 삼아야 합니다.

---

## 6. 상용화 완료(GO)까지의 권장 실행 로드맵

1. **Step 1 — 소규모 코드 마감 (개발, 반나절)**
   - `tests/openapi_reconciliation_test.mjs` CRLF 정규화 수정 → Windows/Linux 모두 `npm test` 100% 통과 확보
   - `crawler-service.js:200` Unsplash 폴백 제거
   - `cspell.json` 갱신 및 `reports/GO_LIVE_CHECKLIST.md` 최신화
2. **Step 2 — 행정·계약·도메인 확보 (운영자/PO)**
   - 사업자등록 · 통신판매업 신고 · 구매안전서비스(에스크로)
   - Toss Payments 실가맹(웹 API 키 + 모바일 위젯 키)
   - `olmoa.com` 도메인 등록, Resend/Solapi/Kakao/택배사/UNI-PASS 계약
   - 이용약관·개인정보·환불정책 법무 검토 확정 및 상업 정책(결정-01~14) 확정
3. **Step 3 — 운영 D1 백업·리허설 및 `main` 병합 (승인 후 실행)**
   - `wrangler d1 export openmarket-db --remote` 백업 + Time Travel 북마크 기록
   - 실 백업 사본에 `scripts/ops/rehearse_phase5.py` 재리허설 (`24/24 PASS` 확인)
   - `work-order/full` → `main` 병합
4. **Step 4 — 원격 마이그레이션·시크릿·도메인 컷오버·배포**
   - `.github/workflows/migrate-d1-remote.yml` (`APPLY`) 실행 → `MAX(version) = d1_74_seo_crawl.sql` 확인
   - `wrangler secret put`으로 결제·보안·외부 연동 시크릿 주입
   - `reports/DOMAIN_CUTOVER_RUNBOOK.md` 순서대로 DNS/Custom Domain/HSTS/`deploy.yml` VITE 4종 전환 및 5워커 배포
5. **Step 5 — 최종 오픈 검증 (Go-Live Sign-Off)**
   - 어드민 `/business` 실사업자 등록·활성화 및 관리자 2FA 등록
   - `GET https://api.olmoa.com/health` → `schemaVersion: d1_74_seo_crawl.sql`, `operator_entity_active: true`, `payment: "TOSS"` 확인
   - 브라우저 스모크(`route_smoke.mjs` 93주소) + 실결제 소액 1건 주문→결제→취소/환불 E2E 검증 후 공개 오픈
