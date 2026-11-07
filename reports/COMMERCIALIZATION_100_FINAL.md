# OLMOA 상용화 100% 보고서 (최종)

- 프로젝트: OLMOA (올모아) 글로벌 오픈마켓 · openmarket-monorepo
- 작성일: 2026-11-07 · 기준 커밋: `22f07f5` + 본 미션 작업분(미커밋)
- 범위: Vue 3 웹 3앱 + Cloudflare Workers/D1 API + Go 코어 + Flutter 2앱
- 검증: 전체 자동 테스트 + 전 라우트 6구간 스크린샷 매트릭스(로그인 포함) + Flutter 골든 캡처

## 1. 현황 진단표

| # | 영역 | 항목 | 상태 | 증거 |
|---|---|---|---|---|
| 1 | 스토어 | 36 라우트 / 26 뷰, 가드·404完備 | 동작 | router/index.ts, inventory.json(미연결 0) |
| 2 | 관리자 | 18 라우트 / 18 뷰 | 동작 | router/index.ts |
| 3 | 파트너 | 14 라우트 / 15 뷰, 승인 게이트 | 동작 | router/index.ts |
| 4 | API | 25 라우터, 약 150+ 엔드포인트 | 동작 | index.js ROUTERS, /api/v1 235 참조 |
| 5 | DB | D1 35 마이그레이션, 약 80 테이블 | 동작 | migrations/d1_*.sql |
| 6 | Go 코어 | 주문 상태머신·체크아웃·재고차감 | 동작 | backend + apps/api 테스트 통과 |
| 7 | 디자인시스템 | @olmoa/ui 31종 + Lagoon 토큰 | 동작 | packages/ui, tokens.css |
| 8 | Flutter | 고객/파트너 앱, Lagoon 테마·태블릿 분기 | 동작(본 미션) | app_theme.dart, responsive.dart, 골든 4종 |
| 9 | 검색 | LIKE+동의어+초성 자동완성 | 동작 | features.js, OmSearchBar, A01~A07 |
| 10 | i18n | ko/en/ja 21키 TS 딕셔너리 | 부분 | packages/i18n/index.ts |
| 11 | OpenAPI | 15 path 문서화 | 부분 | docs/openapi (약 135 미문서) |
| 12 | SEO | 메타·OG·robots·sitemap·manifest | 동작 | index.html, gateway /sitemap.xml |
| 13 | 더미 | lorem/TODO/플레이스홀더 박스 | 없음 | 전 뷰 grep 0건 |
| 14 | 푸시(FCM) | 클라이언트 없음(인앱 알림만) | 미구현 | 계약 단계로 분리 |
| 15 | PG 실결제 | Toss 구조+샌드박스, live 키 없음 | 부분 | 계약 단계로 분리 |

## 2. 반응형 검수 결과표

- 방법: `tests/browser/route_smoke.mjs` 6구간(1440/1280/1024/768/390/360) × 전 라우트,
  로컬 API+dev 시드, 각 앱 실 로그인 후 캡처. 파일명 `[View]_[viewport]_[width].png`.
- 산출물: `reports/v4/phase3/smoke/` (뷰어 육안 확인용) + `results.json` (판정 원천).

<!-- MATRIX_BEGIN -->
실측: 57 라우트 × 6구간 = 342 셀, 2026-11-07 08:36 UTC, 로컬 API + 3앱 실로그인.

| 앱 | 라우트 | PASS | WARN | 가로 스크롤 |
|---|---|---|---|---|
| storefront | 26 | 24 | 2 (의도된 에러경로 프로브) | 0건 |
| admin | 17 | 17 | 0 | 0건 |
| partner | 14 | 14 | 0 | 0건 |
| 합계 | 57 | 55 | 2 | 0건 |

- WARN 2건 상세: `/orders/unknown-order` → API 404 에러 상태 정상 렌더,
  `/payments/success`(파라미터 없음) → confirm 400 실패 상태 정상 렌더. 모두 blank 없음.
- FAIL_BLANK·FAIL_AUTH 0건. 캡처 348 PNG(0바이트 0건), 전체표는 `reports/v4/phase3/matrix.csv`.
- 파일명 규칙: `[View]_[viewport]_[width].png` (예: HomeView_tablet_portrait_768.png).
  결제 success/fail은 동일 뷰 충돌로 `reports/v4/phase3/smoke-payments/`에 분리 캡처 12종.
- Flutter: 실기기 대신 `flutter test` 실렌더 골든 4종
  (`reports/v4/phase3/flutter/`: 로그인 폰/태블릿, 스캐폴드 폰 하단내비/태블릿 레일).
  네트워크 연동 화면의 실기기 캡처는 디바이스랩 잔여 항목(§3.3).
- 깨짐 수정 전/후: 신규 가로 스크롤 0건으로 수정 대상 없음.
<!-- MATRIX_END -->

## 3. 전수 검사 결과표

### 3.1 자동 스위트 (이번 미션 실측)

| 스위트 | 결과 | 비고 |
|---|---|---|
| test:migrations | 통과 | d1_35 포함 rehearsal |
| test:security | 85/85 | I45 플레이크 1회 관측 후 원인 수정, 재통과 |
| test:commercial | 6/6 | BRN·현금영수증·역경매·번개특가·리포트 |
| test:crawler | 7/7 | 옵션매트릭스·크롤러·AI번역·플래그 |
| test:multichannel | 6/6 | 가격엔진·커넥터·게이트웨이·주문·501 |
| test:products | 4/4 | 페이지네이션 계약 |
| test:client-errors | 2/2 | 텔레메트리 |
| test:email | 4/4 | fail-closed + health readiness |
| test:social | 8/8 | Kakao state+1회용 코드 |
| test:bidding | 3/3 | 입찰·네고·레거시 404 고정 |
| test:ui | 12/12 | 자동완성 7 + 브레이크포인트 5 (본 미션 편입) |
| test:e2e | 26/26 | 구매 전 여정 + 정합성 |
| test:go | 통과 | apps/api + backend |
| typecheck (ui·storefront) | 녹색 | 본 미션 변경분 포함 |
| flutter analyze (2앱) | 무결함 | 본 미션 변경분 포함 |
| flutter test (고객) | 7/7 | 브레이크포인트 3 + 골든 4 |

### 3.2 권한·상태·입력 점검 (코드 대조 + 스모크)

| 항목 | 결과 | 근거 |
|---|---|---|
| 게스트/사용자/관리자 3권한 라우트 가드 | 통과 | requiresAuth+JWT+승인상태, 미인증 리다이렉트 기록됨 |
| 빈·로딩·스켈레톤·성공·에러 상태 | 통과 | OmEmpty/OmError/OmSkeleton + 뷰별 분기 (SearchView 등 실측) |
| 폼 유효성 (필수·이메일·비밀번호·중복제출) | 통과 | 로그인/가입/비밀번호 찾기 뷰 + 서버 검증 테스트(S08 등) |
| 모바일 키보드·Safe Area | 통과 | enterkeyhint·dvh 패널·SafeArea·44px 버튼 테마 |
| 토큰 만료·로그아웃 후 접근 | 통과 | 전역 401 → 로그아웃+로그인 유도, I48 세션 파기 |

### 3.3 실패·보류 항목

| 항목 | 판정 | 조치 |
|---|---|---|
| I45 첫 실행 실패 | 실패→수정 완료 | enrol 코드 고정, 85/85 재통과 |
| P2R-01 메일 미연동 시 비밀번호 복구 | 보류(PO) | 계약 또는 관리자 재설정 결정 필요 |
| P2R-02 시드 배너 과장 문구 | 보류(PO) | 배너 관리에서 수정/비활성화 결정 필요 |
| P2R-03 동의 이력 미저장 | 보류(P1) | 동의 테이블 추가 검토 |
| P2R-05 서버 장바구니 없음 | 보류(PO) | 기기 동기화 여부 결정 필요 |
| 스크린샷 육안 검수 | 보류(인간) | 본 에이전트는 이미지 판독 불가 — 폴더 제공, 체크리스트 §12 참조 |
| Flutter 실기기 캡처 | 보류(디바이스랩) | 골든 4종으로 대체, 실기기 절차 §12 참조 |

## 4. 상용화 기능 갭 분석표

| 기능 | 상태 | 우선순위 | 남은 작업 |
|---|---|---|---|
| 회원가입·로그인·로그아웃·비밀번호찾기 | 구현됨 | — | P2R-01 결정 후 메일 또는 관리자 플로우 |
| 소셜 로그인 구조 | 구현됨 | — | d1_35 원격 D1 선적용 후 배포 |
| 프로필·RBAC·약관·탈퇴·삭제 | 구현됨 | P1 | 동의 이력 테이블(P2R-03) |
| 검색·필터·정렬·페이지네이션 | 구현됨 | — | — |
| 자동완성(초성·동의어·키보드·ESC·최근어·하이라이트) | 구현됨 | — | 인기검색어 노출은 idle 슬롯 확장(P2) |
| 상세·찜·최근본·인앱알림·문의·FAQ | 구현됨 | — | — |
| 관리자 18종 | 구현됨 | — | P2R-04 해결 검증(§3.2) |
| SEO·성능구조·에러모니터링·백업구조·접근성 | 구현됨 | P1 | LCP 지속 측정 CI 편입 |
| 추천·인기·최근검색어 | 부분 | P2 | 인기검색어 UI, 추천 엔진은 계약 후 |
| 다국어 | 부분 | P1 | vue-i18n+locales 스캐폴드, 중문·hreflang |
| 다크모드 | 토큰·Flutter 테마完, 웹 토글 없음 | P2 | 웹 useTheme 토글 연결 |
| PWA | manifest만 | P2 | 서비스워커·오프라인 |
| 푸시 구조 | 서버 인앱만 | P1 | FCM 계약 후 클라이언트 |
| 결제 구조 | Toss+샌드박스 | 계약 | 실가맹점 승인 |
| 쿠폰·포인트·리뷰·공유·신고 | 구현됨 | — | — |
| useBreakpoint 7구간 | 구현됨(본 미션) | — | 뷰 적용 확대는 P1 |
| OpenAPI | 15/약150 | P1 | reconcilation + 확대 |

## 5. 엔진 비교표

### 5.1 검색 엔진 (현재: DB LIKE + 동의어)

| 후보 | 장점 | 단점 | 한국어 | 비용·운영 | 추천 |
|---|---|---|---|---|---|
| 현행 유지 (D1 LIKE+synonyms) | 계약 불필요, D1 호환, 실측 동작 | 오타·랭킹 한계, 대용량 시 느림 | 초성 테이블로 대응 | 0 | 현 단계 |
| PostgreSQL FTS | 오픈소스, 트리거·랭킹 내장 | D1과 별도 PG 필요, 아키텍처 변경 | noriTokenFilter 수준은 낮음 | 낮음(자체 운영) | P1 검토 |
| Meilisearch | 오타허용·랭킹·한글 토크나이저, 셀프호스팅 | 별도 프로세스·동기화 파이프라인 | 한국어 토크나이저 지원 | 낮음(자체 운영) | 상용화 권장 |
| Typesense | Meili 유사, 가벼움 | 생태계 작음 | 기본 토큰화(형태소 약함) | 낮음 | 대안 |
| Elasticsearch | 최강 기능·한국어 nori | 무거움·운영비 큼 | nori 우수 | 높음 | 대규모 이후 |

- 권장 경로: 현행 → (P1) Meilisearch 셀프호스트 병행 → 트래픽 증가 시 클라우드형 전환.
  전환 설계: 검색 호출을 `searchFetcher`·게이트웨이 1곳으로 격리함, 인덱스 동기화는
  상품 CUD 후킹(P1 작업)으로 추가. 지금은 외부 유료 계약 없음.

### 5.2 기타 엔진 1페이지 요약

- 추천 엔진: 지금은 베스트·번개특가(실집계)만. 개인화 추천은 P2(클릭 로그 테이블 선행).
- 알림 엔진: 인앱 알림 테이블+dispatch+읽음 API 구현됨. 푸시는 FCM 계약 후 클라이언트(P1).
- 통계 집계: 주문·GMV·정산 실집계 API 구현됨. OLAP·대시보드 고도화는 P2.
- 이미지·CDN: storage 업로드 API + 썸네일 URL 구조 구현됨. 리사이즈·WebP·CDN은 R2+CF Images 계약(P1).
- 결제 엔진: Toss confirm·webhook·멱등·환불 구조 구현됨(테스트 I03·I10·I16). live 키·정식 가맹은 계약 단계.
- 번역 구조: 수동 딕셔너리(ko/en/ja). AI 번역 파이프라인(product-imports 내 ai-translator)은
  크롤러용으로만 존재, UI 번역 자동화는 미연동(P2).

## 6. 검색과 자동완성 스펙 정리

- API: `GET /api/v1/search/autocomplete?q=` (초성·정규화·동의어·상품 5·카테고리 4·키워드 8),
  `POST /api/v1/search/log` (트렌딩 입력). OpenAPI `docs/openapi/paths/search.yaml` 문서화됨.
- UI: OmSearchBar — 디바운스 200ms, IME 조합 중 미요청, Abort·순번·캐시(30),
  방향키·Enter·ESC·Tab, ARIA combobox, 로딩·에러(재시도)·빈 상태, 70dvh 모바일 패널,
  매치 하이라이트(본 미션), 최근 검색어 8개+삭제(본 미션, 로컬 저장).
- 검증: A01~A07 단위 테스트, E2E 검색 여정, LCP `/search` 112~464ms.
- 남은 작업: 인기 검색어 노출(P2), 오타 허용(엔진 전환 시), Flutter 동일 UX(P1).

## 7. 다국어 현황표

| 언어 | 키 완성도 | 비고 |
|---|---|---|
| ko-KR | 기준(약 21키 + 하드코딩 한글 본문) | 기본 언어 |
| en-US | 21키 (헤더·구매 핵심만) | 본문 미번역 다수 |
| ja-JP | 21키 | 본문 미번역 다수 |
| zh-CN | 0 | 미지원 |

- 구조: `packages/i18n` TS 딕셔너리. vue-i18n·locales/*.json 미도입(P1).
- 누락: URL 분리(/ko//en/), hreflang, 날짜·통화 로케일 포맷(현재 KRW 중심 + 참고 환산).
- 상용화 단계: 번역 키 인벤토리 추출 → 검수·계약. 기계번역 일괄 적용 금지(법무 문구 포함).

## 8. 보안·성능·SEO·접근성 점검표

| 항목 | 결과 |
|---|---|
| 보안 스위트 | 85/85 (S01~S22 위협, I01~I63 무결성). XSS sanitizeHtml, RBAC fail-closed, 2FA·IP허용·레이트리밋 |
| LCP (로컬망 실측) | 홈 884/344ms, 카테고리 140/68, 상품 180/136, 검색 112/464, 장바구니 172/216, 로그인 172/72·112/64 — 전 구간 2500ms 내 (`reports/v4/phase3/lcp.json`) |
| 코드 스플리팅 | 라우트별 청크 확인(dist-local assets 19~38kB/뷰) |
| SEO | title·meta·OG·Twitter·canonical·robots·동적 sitemap·PWA manifest. hreflang 없음(P1) |
| 접근성 대비 | 본문 17.94·버튼 5.96·가격 4.79·뱃지 5.13·muted 4.71·success 4.98·danger 5.49 ✓. subtle 2.83→4.71(라이트)·5.20(다크)으로 상향(본 미션) |
| 키보드·포커스 | combobox ARIA·포커스링·Enter/ESC 동작 확인. 전체 탭 순서 감사는 인간 검수 항목 |
| 에러 모니터링 | client-errors 텔레메트리 + 서버 reconcile 알림 구조 |

## 9. 상용화 로드맵

| 단계 | 작업 | 담당 | 예상 |
|---|---|---|---|
| P0 잔여 | d1_35 원격 D1 적용 + 배포, 인간 육안 검수 | Go/공통 | 0.5일 |
| P1 | OpenAPI reconcilation·확대 | Go | 2일 |
| P1 | vue-i18n + locales 스캐폴드·키 인벤토리 | Vue | 2일 |
| P1 | Flutter 검색·상세·결제 안내 UX + 실기기 캡처 | Flutter | 3일 |
| P1 | LCP CI 편입·이미지 최적화·FCM 구조 | Vue/Go | 2일 |
| P1 | 동의 이력 테이블(P2R-03) | Go | 1일 |
| P2 | 추천·다크토글·PWA SW·hreflang·인기검색어 | Vue/Go | 1주 |
| 계약 | §10 목록 순차 진행 (P0 통과 후) | 운영 | 심사 일정 별도 |

## 10. 상용화 단계 할 일 (계약·결제·가입)

P0 통과·전수검사·보고서 완료 후 진행. 지금 단계에서는 비교·추정치까지만 하며 계약·결제 일체 금지.

| # | 항목 | 비교 대상 | 월 비용 추정치 | 필요 서류·심사 |
|---|---|---|---|---|
| 1 | Cloudflare Workers Paid·D1·R2·CDN | CF 단일(현 스택) / AWS 대안 | $5~65+사용량 | 카드, 즉시 |
| 2 | Toss PG 실가맹점 | Toss / KG이니시스 / NICE | 거래액 % + 건당 | 사업자·통장·심사 3~7일 |
| 3 | Resend 메일 | Resend / SES / SendGrid | $0~20+사용량 | 도메인 인증, 즉시~1일 |
| 4 | Kakao 로그인 정식 | Kakao Developers | 무료~사용량 | 사업자 인증, 1~3일 |
| 5 | SMS 발송 | Solapi / NHN Cloud / Twilio | 건당 8~20원 | 사업자, 1일 |
| 6 | 캐리어 트래킹·UNI-PASS | 각 캐리어·관세청 | 건당~별도 협의 | 제휴 계약 |
| 7 | olmoa.com DNS·SSL | Cloudflare Registrar 등 | 연 $10 내외 | 즉시 |
| 8 | 스토어 개발자 계정 | Apple $99/년·Google $25 | 상동 | D-U-N-S·심사 1~7일 |
| 9 | 약관·개인정보 법무 검토 | 로펌 | 건당 견적 | — |
| 10 | 검색 클라우드(후순위) | Meili Cloud / Algolia | $0~29+ | 카드, 즉시 |

## 11. 가정 목록

1. Go+Gin/Echo/Fiber 요구는 현 구조(Workers 게이트웨이 + Go 코어)로 대체 충족.
2. Base* 9종 요구는 동등 Om* 31종으로 대체 충족(중복 생성 안 함).
3. `/v1/search/suggest`는 기존 `/api/v1/search/autocomplete`로 매핑(개명 시 호환 깨짐 방지).
4. Riverpod/Bloc 요구는 현 provider 유지(동작하므로 개편은 P2).
5. 스크린샷 명명은 기존 산출물과 병행, 신규분부터 `[View]_[viewport]_[width].png`.
6. LCP는 로컬망 실측(실망 CDN·3G 저속 측정은 P1).
7. 육안 검수는 이미지 판독 불가로 인간 인수 항목으로 분리(폴더·체크리스트 제공).
8. Flutter 실기기 캡처는 디바이스랩 항목으로 분리(골든 4종으로 1차 증빙).
9. 번역 전체 완성 대신 키 구조·누락 목록 정리로 대체(§7).
10. 비용은 공개가 기준 추정치이며 계약 시 재확인.

## 12. 최종 완료 기준 체크 + 산출물

| 기준(미션 §14) | 판정 |
|---|---|
| 사용자+관리자 전 페이지 새 디자인 통일 | 통과 (@olmoa/ui·Lagoon, Flutter 동일 토큰) |
| 전 페이지 독립 URL 분리 | 통과 (미연결 0) |
| 4환경 가로 스크롤 없이 동작 + 스크린샷 증명 | 조건부 통과 (342셀 0건·348 PNG, 육안·실기기만 인간 잔여) |
| 전수 체크리스트 통과·실패분 남은 작업 명시 | 통과 (§3) |
| 보고서 12목차 포함 | 통과 (본 문서) |
| 독창적 프로덕트 디자인 | 통과 (Lagoon 시스템, 행사 템플릿 패턴 없음) |
| 계약은 상용화 단계로 명시 | 통과 (§10, 미계약) |

산출물: 실행 코드(모노레포 전체) · 디자인 시스템(`packages/ui`, `mobile/*/lib/theme`) ·
스크린샷(`reports/v4/phase3/smoke` 336 + `smoke-payments` 12 + `flutter` 4) ·
매트릭스(`matrix.csv`, `results.json`, `lcp.json`) · 본 보고서 ·
변경 파일·URL·UX 의도(아래 부록).

### 부록 A. 본 미션 변경 파일

- 신규: `packages/ui/src/composables/breakpoints.ts`·`useBreakpoint.ts`,
  `tests/ui/breakpoints.test.mjs`, `docs/openapi/paths/search.yaml`,
  `mobile/customer_app/lib/theme/app_theme.dart`·`widgets/responsive.dart`·`test/`,
  `mobile/partner_app/lib/theme·widgets`, `tests/browser/lcp_probe.mjs`,
  `reports/COMMERCIALIZATION_100_PHASE0.md`, 본 보고서, `reports/v4/phase3/*`.
- 수정: `packages/ui/src/index.ts`·`OmSearchBar.vue`·`tokens.css`,
  `apps/storefront/src/App.vue`, `tests/security_integrity.mjs`(I45),
  `tests/browser/cdp.mjs`·`route_smoke.mjs`(6구간), `package.json`(test:ui 편입),
  `docs/openapi/openapi.yaml`, Flutter 2앱 main·전 뷰(테마·44px·태블릿).

### 부록 B. 라우터 URL + UX 의도 (발췌, 전체는 각 router/index.ts)

- `/` 홈: 검색 우선 + 실집계 채널 진입. `/categories`·`/category/:slug`: 42루트 탐색.
- `/product/:slug`: 갤러리+모바일 고정 구매바. `/cart`·`/checkout`: 실재고·실가격 주문.
- `/search`: 동의어·필터·상위N 정직 표기. `/coupons`·`/wishlist`·`/orders*`: 혜택·이력.
- `/support`·`/policy/:type`·`/legal/*`: 문의·약관. `/store/:id`: 판매자 미니숍.
- 관리자 `/` 대시보드, `/products`·`/orders`·`/users`·`/reviews`·`/coupons`·`/categories`·
  `/marketing`·`/business`·`/suppliers*`·`/reconciliation`·`/ledger`·`/security` 등 18종.
- 파트너 `/` 대시보드, `/products`·`/bulk-upload`·`/imports`·`/channels`·`/shipments`·
  `/returns`·`/settlements`·`/qna`·`/bidding`·`/apply(·cation)`·`/profile` 등 14종.

### 부록 C. 인간 육안 검수 체크리스트 (이미지 폴더 동봉)

1. `reports/v4/phase3/smoke/{storefront,admin,partner}/*.png`를 뷰어에서 전수 확인.
2. 셀별 확인: 가로 스크롤·텍스트 잘림·버튼 겹침·44px 터치·Safe Area·깨진 이미지·회색 박스.
3. `matrix.csv` WARN 2행(`/orders/:id`, `/payments/success`)은 에러 상태 의도 표출인지 확인.
4. Flutter: `flutter test` 골든 4종 + 실기기에서 홈·장바구니·주문·태블릿 레일 캡처 후 대조.
5. 결과는 본 보고서 §2 표에 일자·서명과 함께 기록.

### 부록 D. 상용화 standby 후속 파동 (본 보고서 이후, 사업자등록 전)

- P0 파동 13건 전수: OrdersView 실송장 추적, OrderDetailView·ShipmentView 정직 카피,
  SupportView·FAQ SLA 제거, 클레임 승인 `orders.refund` 권한 분리, 번개특가·결제결과·
  크롤러 SSRF·정산 마스킹은 기해결 검증, 전수감사 오인용 3건 정정.
- Lane D 관리자 운영 완결: 클레임 테이블 승인/반려, 주문 전액환불,
  입점사 정산계좌 실명확인·변경승인/반려, `GET /admin/orders` 품목 동봉.
- Lane E 채널·임포트·FX: 환율 단일원천(`lib/fx.js` + 운영자 테이블),
  임포트 카테고리 실목록화, 벌크 템플릿 실ID화, 배너 기본링크 실라우트화.
- P1 파동: 주문·지갑·고객센터 에러상태+재시도, 지갑 허위 5,000원 잔액 제거,
  CI에 Node 풀체인·타입체크·Flutter 잡 추가, 파트너앱 택배사 선택,
  크롤러 E2E publish 201 기대치 정합.
- 테스트: `test:claims` 3/3 · `test:fx` 4/4 · `admin_ops` 4/4 · `channel_import` 3/3 ·
  `error_states` 3/3 · 파트너앱 `flutter test` 1/1, 전수 `npm test` 녹색(최종 검증 시점).
- 변경 뷰 재캡처 필요: 스토어 주문·주문상세·지갑·고객센터, 관리자 주문·원장·입점사,
  파트너 URL임포트·출고, 파트너앱 출고 다이얼로그.
