# 상용화 100% 미션 — Phase 0 현황 진단 보고서

- 프로젝트: OLMOA (올모아) 글로벌 오픈마켓 (openmarket-monorepo)
- 진단일: 2026-11-07, 진단 기준 커밋: `22f07f5` + 미커밋 12건(전 세션 이월)
- 진단 방법: 전수 코드 판독 + 전체 테스트 실행 + 라우터/API/DB 인벤토리 실측
- 결론: 백엔드·주문·결제·보안 코어는 상용 수준(테스트 전체 녹색). 미션 대비 갭은
  반응형 체계화·다국어 구조·OpenAPI 커버리지·Flutter 테마·태블릿/앱 스크린샷에 집중됨.

## 1. 스택 실측 (미션 프롬프트 가정과의 차이)

| 영역 | 프롬프트 가정 | 실측 결과 | 판정 |
|---|---|---|---|
| 웹 | Vue 3 + Vite + Pinia + Vue Router | 동일 (storefront/admin/partner 3앱) | 일치 |
| 백엔드 | Go + Gin/Echo/Fiber 중 1개 | Cloudflare Workers(JS)+D1 게이트웨이가 실 API, Go 1.23(stdlib+redis, 프레임워크 없음)는 코어 엔진 | 구조 상이, 기능 충족 |
| 앱 | Flutter 3.x + go_router + Riverpod/Bloc | Flutter + 기본 Navigator + provider | 라우터/상태관리 상이 |
| 디자인 시스템 | Base* 9종 신규 필요 | `@olmoa/ui` Om* 31종 + tokens.css(Lagoon) 이미 존재 | 대체 충족 (Vue) |
| i18n | vue-i18n + locales/*.json | packages/i18n TS 딕셔너리(ko/en/ja, 약 21키) | 갭 |
| 자동완성 API | /v1/search/suggest | /api/v1/search/autocomplete (초성+동의어+상품미리보기, 실구현) | 경로명 상이, 기능 충족 |

## 2. 페이지 전수 (메뉴 1 = URL 1 = 파일 1)

| 앱 | 라우트 수 | 뷰 파일 수 | 미연결 뷰 | 상태 |
|---|---|---|---|---|
| storefront | 36 (+404) | 26 | 0 (inventory.json 확인) | 전수 존재 |
| admin | 18 (+404) | 18 | 0 | 전수 존재 |
| partner | 14 (+404) | 15 | 0 | 전수 존재 |

- 라우터 가드: storefront requiresAuth+전역 fetch 401 처리(main.ts), partner 토큰+승인상태 가드,
  admin은 main.ts JWT 검사. 404 뷰 3앱 모두 존재.
- 더미 스캔: 전 뷰에서 lorem/TODO/FIXME/xxxxx 0건.

## 3. API/DB 전수

- 게이트웨이 라우터 25개(apps/cloudflare-gateway/src/index.js ROUTERS),
  `/api/v1` 참조 235건(유니크 약 200, 실측 엔드포인트 약 150개 이상).
- D1 마이그레이션 35개(d1_01~d1_35, d1_35 미적용·미커밋), CREATE TABLE 102건(유니크 약 80 테이블).
- Postgres 마이그레이션 6개(backend/migrations, Go 코어용).
- OpenAPI: 13 path → 이번 세션에 search 2종 추가 후 15 path. 약 135개 미문서(§5 P1).

## 4. 테스트 베이스라인 (이번 세션 실측)

| 스위트 | 결과 |
|---|---|
| test:migrations + gen-dev-seed | 통과 (체인 진입 확인) |
| test:security | 85/85 (단, 첫 실행 I45 실패 후 재실행 통과 → 시간경계 플레이크 확정, 수정 완료) |
| test:commercial 6/6, test:crawler 7/7, test:multichannel 6/6 | 통과 |
| test:products 4/4, test:client-errors 2/2, test:email 4/4 | 통과 |
| test:social 8/8, test:bidding 3/3, test:e2e 26/26 | 통과 |
| test:go (apps/api + backend) | 통과 |
| test:ui (신규 편입) | 12/12 (A01~A07 + B01~B05) |
| typecheck (packages/ui) | 녹색 |

- tests/performance, tests/unit 디렉터리는 비어 있음 → LCP 측정 인프라 없음(갭).
- 기존 스크린샷: reports/v4/phase2/{smoke,smoke-auth,smoke-local,smoke-prod}에
  전 라우트 desktop 1440 + mobile 390 캡처 존재. 태블릿 1024/768, 모바일 360, Flutter 캡처는 없음(갭).

## 5. 기능 갭 분석 (미션 §8 기준 발췌)

| 기능 | 상태 | 우선순위 | 비고 |
|---|---|---|---|
| 회원가입/로그인/로그아웃/비밀번호찾기 | 구현됨 | — | 단, 메일 미연동 시 찾기 플로우 무력(P2R-01, PO) |
| 소셜 로그인 구조 | 구현됨(Kakao OAuth+state+1회용 코드) | — | d1_35 원격 적용 필요 |
| 프로필/RBAC/약관/탈퇴·삭제 | 구현됨 | — | 동의이력 미저장(P2R-03, P1) |
| 검색/필터/정렬/페이지네이션 | 구현됨 | — | LIKE+동의어 기반(§6) |
| 자동완성 | 구현됨(서버+OmSearchBar+코어 단위테스트) | — | 키보드/ESC/최근검색어 위젯 내 확인 필요(P1) |
| 상세/찜/최근본/인앱알림/문의·공지/FAQ | 구현됨 | — | 푸시(FCM)는 계약 단계(P1 구조) |
| 관리자 18종 | 구현됨 | — | P2R-04는 7623a54에서 처리됨(검증 예정) |
| SEO/robots/sitemap/PWA manifest | 구현됨 | — | hreflang·/ko//en/ 없음(P2), SW 없음(P2) |
| useBreakpoint 7구간 | 미구현 → 구현됨(이번 세션) | P0 완료 | B01~B05 테스트 포함 |
| OpenAPI 전체 | 부분(15/약150) | P1 | 나머지 reconcilation 필요, 기존 13건 중 stale 의심 |
| 다국어 구조 | 부분(21키 TS 딕셔너리) | P1 | vue-i18n+locales 스캐폴드 필요 |
| Flutter 테마/태블릿 분기 | 미구현 | P1 | app_theme.dart + LayoutBuilder 필요 |
| LCP 측정 | 미구현 | P1 | route_smoke 확장 또는 별도 측정 |
| 다크모드 토글 | 토큰만 존재(UI 없음) | P2 | useTheme 있으나 미연결 |
| 서버 장바구니 | 미구현(P2R-05) | PO | 기기 동기화 결정 필요 |

## 6. 엔진 현황 (미션 §9)

- 검색: DB LIKE + search_synonyms + LIMIT 200 상위N 표기. FTS 아님.
  상용 비교(PostgreSQL FTS / Meilisearch / Typesense)는 Phase 5 보고서에 포함 예정.
  현 단계는 D1 호환 DB 방식 유지(외부 계약 금지 준수).
- 자동완성: chosung·normalized·synonym·상품 미리보기 실구현. 디바운스 200ms(코어 기본값).
  미션 요구 경로명(/v1/search/suggest)과 상이 → 개명하지 않고 매핑 문서화(호환 유지).
- 다국어: ko-KR/en-US/ja-JP 딕셔너리. 중문 없음. URL·hreflang·날짜/통화 포맷 분기는 미구현.
- 추천/알림/통계/이미지/CDN/결제: 인앱 알림·주문통계·Toss 구조(샌드박스) 존재.
  이미지 최적화·CDN·푸시·PG 실계약은 상용화 단계 항목으로 분리(§7).

## 7. 계약 금지 준수 + 상용화 단계 계약 목록 (초안)

이번 단계에서 계약·결제·가입을 일체 진행하지 않음(코드 변경은 로컬 동작 범위 내).
P0 통과 후 상용화 단계에서 진행할 목록(상세 비교·추정치는 Phase 5 보고서):

1. Cloudflare 유료 플랜·D1·R2·CDN (현재 workers.dev 운영 중)
2. Toss PG 실가맹점 승인 + live 키
3. Resend(메일) 유료 플랜 — RESEND_API_KEY
4. Kakao 개발자 앱 정식 설정 — KAKAO_*
5. SMS 발송사 (미정) 6. 캐리어 트래킹 API + UNI-PASS 7. olmoa.com DNS·SSL
8. 앱스토어·플레이스토어 개발자 계정 9. 약관·개인정보 법무 검토

## 8. 이번 세션 구현 (P0)

1. I45 TOTP 플레이크 수정: enrol step·code 고정 재사용. security 85/85 녹색 유지.
2. useBreakpoint: packages/ui breakpoints.ts(순수 코어) + useBreakpoint.ts(Vue 래퍼),
   tests/ui/breakpoints.test.mjs 5건, test:ui를 npm test 체인에 편입. 12/12 + typecheck 녹색.
3. OpenAPI: docs/openapi/paths/search.yaml 신규(실구현 대조 검증) + openapi.yaml 연결. 13→15 path.

## 9. 가정 목록

1. 미션의 "Go + Gin/Echo/Fiber"는 현 구조(Workers 게이트웨이 + Go 코어)로 대체 충족 판정.
2. "Base*" 컴포넌트 요구는 동등 기능의 Om* 31종으로 대체 충족 판정(중복 생성 안 함).
3. "/v1/search/suggest"는 기존 /api/v1/search/autocomplete로 매핑(개명 시 호환 깨짐 방지).
4. state 관리 "Riverpod or Bloc"은 현 provider가 동작하므로 유지(개편은 P2).
5. 스크린샷 명명규칙은 기존 산출물(View_desktop/mobile)과 병행, 신규분부터 [페이지]_[기기]_[너비] 적용.

## 10. 남은 작업 (다음 단계)

- P1: OpenAPI reconcilation(기존 13건 stale 검증 + 핵심 경로 확대), vue-i18n 스캐폴드,
  Flutter app_theme + 태블릿 분기, route_smoke 768/1024/360 확장 실행, LCP 측정.
- PO(운영자 결정): P2R-01(메일 계약 vs 관리자 재설정), P2R-02(시드 배너 문구), P2R-05(서버 장바구니).
- Phase 5: 미션 §10 목차 12항 전체 보고서 (엔진 비교표·로드맵·계약 비교 포함).
