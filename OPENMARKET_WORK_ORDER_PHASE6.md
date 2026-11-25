# OLMOA 작업지시서 — 6단계 (도메인 이전 후 정리 + 검색 최적화: SEO·AEO·GEO·LLMO·AIO)

- 발행일: 2026-11-25 / 받는 사람: Muse Spark
- 기준: 이 문서를 커밋한 `main` HEAD (직전 커밋 `b58c62f` 계정 이전)
- 먼저 읽을 문서: `docs/DOMAIN_CONFIGURATION.md`(1.3.0, 현재 구조), `reports/DOMAIN_CUTOVER_RUNBOOK.md`(계정 이전 기록),
  `reports/GO_LIVE_CHECKLIST.md`, `reports/HUMAN_CHECKLIST.md` §5, `OPENMARKET_WORK_ORDER_PHASE5.md`(규칙 9~13)
- 목표: ① 운영에 올라가지 않은 코드(48360ae)를 감사해 배포 가능한 상태로 만들고, ② 검색엔진(SEO)과
  답변 엔진(AEO)·생성형 AI 검색(GEO)·대형 언어모델(LLMO)·AI 요약(AIO, 구글 AI 개요 등)이 **JavaScript를 실행하지 않고도**
  OLMOA의 실제 상품·카테고리·정책 정보를 정확히 읽고 인용할 수 있게 한다.
- 순서: 6-0 → 6-1 → … → 6-10 → 6단계 관문. 앞 작업의 완료 기준을 통과한 뒤 다음으로 넘어간다.

---

## 0. 현재 상태 (2026-11-25 실측)

| 항목 | 값 |
|---|---|
| Cloudflare 계정 | 도메인 계정 `f5c363135efe9b22ca66eb39f2f8e1da` 하나만 쓴다. 모든 wrangler 설정에 `account_id` 고정. 구 계정 `6d53e0…`의 OLMOA 자원은 **삭제됨**(같은 계정의 다른 프로젝트는 무관, 건드리지 않는다) |
| 주소 | `olmoa.com`(워커 `openmarket`) · `api.olmoa.com`(`olmoa-api`) · `admin.olmoa.com`(`olmoa-admin`) · `partner.olmoa.com`(`olmoa-partner`) · `www.olmoa.com`→301(`olmoa-edge`). `*.workers.dev` 주소는 없다(`workers_dev: false`) |
| D1 | `openmarket-db` `6e23f7cd-7999-4419-ac6e-63481edc5454`(APAC), 스키마 d1_74, 75 마이그레이션, 128 테이블 1,603행, 인덱스 105, 트리거 55 |
| 운영 API 코드 | **`fe4e11f`의 게이트웨이**(계정 이전 전 운영과 동일). `main`의 게이트웨이는 그 뒤 `48360ae`(미감사, 5파일 +434/-92)가 더해져 운영과 다르다 |
| 운영 콘솔 코드 | `main`(`b58c62f`)에서 VITE 값 `https://api.olmoa.com` 등으로 빌드·배포됨 |
| 시크릿 | `JWT_SECRET`·`PII_ENCRYPTION_KEY`·`TOTP_ENCRYPTION_KEY` 새로 생성(전원 재로그인, 2FA 관리자 1명 재등록), `ALLOWED_ORIGINS`=custom 4종, `PUBLIC_STOREFRONT_URL=https://olmoa.com`. 결제·메일·카카오 키 없음 |
| 테스트 | `npm test` 1,029 PASS / 0 FAIL (2026-11-25) |
| CI 배포 | `deploy.yml`은 `CLOUDFLARE_API_TOKEN`이 없어 첫 단계에서 실패한다(의도). 토큰은 6-0 통과 후 운영자가 넣는다 |
| 백업 | `wrangler d1 export`는 FTS5 테이블 때문에 실패한다. 표 단위 export + `scripts/ops/build_d1_restore.py`를 쓴다(`DEPLOY_RUNBOOK.md` 상단) |

### 0.1 검색 관련 실측 (이번 지시서의 출발점)

- `curl -A "GPTBot/1.1" https://olmoa.com/category/<slug>` → **모든 주소가 똑같은 `index.html`**: 제목·설명이 사이트 기본값이고 JSON-LD가 없다.
  상품·카테고리 제목, 가격, 구조화 데이터는 브라우저에서 JS가 돈 뒤에만 붙는다
  (`ProductDetailView.vue:85-86`, `PlpLayout.vue:288-289`의 `applyRouteHead`/`injectJsonLd`).
  JS를 실행하지 않는 크롤러(대부분의 AI 크롤러, 일부 검색 크롤러 1차 수집)는 상품 정보를 못 본다.
- 게이트웨이에 서버용 빌더가 이미 있다. 그러나 **어떤 라우트도 쓰지 않는다**:
  `lib/seo-meta.js`(productMeta·categoryMeta·storeMeta), `lib/seo-jsonld.js`(siteGraphs·breadcrumbGraph·productGraph·faqGraph·itemListGraph),
  `lib/seo-head.js`(routeHead·renderHeadHtml).
- 루트 워커 `apps/storefront/edge/apex-worker.js`는 크롤 경로 6개(`/robots.txt`, `/sitemap*.xml`, `/sitemaps/*`, `/llms*.txt`)만
  서비스 바인딩 `API`로 넘긴다(`run_worker_first`). 나머지는 정적 SPA다.
- 존재하지 않는 상품 주소도 SPA 폴백 때문에 **200**을 준다(소프트 404).
- `robots.txt`는 `User-agent: *` 한 묶음뿐이다. AI 크롤러별 정책·Content-Signal이 없다.
- `llms.txt`는 카테고리 링크와 진입 주소만 있다. 상품 단위 문서(마크다운)가 없다.
- `apps/storefront/index.html` 기본 설명에 "가장 합리적인 가격과 무료배송"이 있다. 사실 근거가 없는 표시광고 문구다(결정-19).
- 데이터: 상품 64(`brand`, `country_origin`, `avg_rating_x10`, `updated_at` 있음, **GTIN/MPN 필드 없음**), `product_reviews`,
  `product_qna` 4, `shipping_policies`, `business_entities` **0행**(운영 사업자 미등록 → 법인 정보를 구조화 데이터에 쓸 수 없다).

---

## 1. 공통 규칙

`OPENMARKET_WORK_ORDER.md` §0 규칙 1~8, `OPENMARKET_WORK_ORDER_PHASE5.md` 규칙 9~13을 그대로 지킨다. 아래를 추가한다.

14. **운영 반영 금지.** `wrangler deploy`, `wrangler secret`, `wrangler d1 execute --remote`, Custom Domain·DNS 변경은 하지 않는다.
    배포가 필요한 작업은 "배포 대기"로 보고하고 운영자가 승인한다. 비대화형 wrangler는 확인 질문에 자동으로 yes를 고르고
    기존 DNS 레코드·Custom Domain을 덮어쓴다(`--dry-run` 외 금지).
15. **구조화 데이터·AI용 문서에는 DB에 있는 사실만 쓴다.** 평점은 실제 리뷰가 1건 이상일 때만, 재고는 SKU 재고에서,
    배송·반품은 `shipping_policies`·`RETURN_WINDOW_DAYS`에서, 법인 정보는 활성 `business_entities` 행에서만 가져온다.
    값이 없으면 그 속성을 **빼고**, 지어내거나 기본값으로 채우지 않는다. "최저가", "무료배송", "정품 보장" 같은 문구는 근거 데이터가 있을 때만 쓴다.
16. **클로킹 금지.** 사람과 봇에게 같은 HTML을 준다. User-Agent로 내용을 바꾸지 않는다(robots 정책만 예외).
    엣지에서 넣는 제목·설명·본문 요약은 SPA가 그리는 내용과 같아야 한다.
17. 검색 산출물은 **JS 없이** 증명한다: 테스트에서는 워커를 직접 호출하고, 운영 확인은 `curl -A <봇 UA>`로 한다. 브라우저 화면만으로 통과 처리하지 않는다.
18. 스키마 유형은 검색엔진 문서가 허용하는 용도로만 쓴다. 예: 상품 문의에 `QAPage`를 쓰지 않는다(포럼용), 뉴스가 아닌 곳에 `speakable`을 쓰지 않는다.

---

## 2. 운영자 결정 필요 (결정 전 동작은 괄호 안 기본값)

| 번호 | 질문 | 결정 전 기본값 |
|---|---|---|
| 결정-18 | AI 크롤러 정책: 검색·답변용 수집(OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot, Perplexity-User)과 **학습용 수집**(GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot, Bytespider, meta-externalagent)을 각각 허용할지 | 검색·답변 허용, 학습 허용(현행 `User-agent: *` 전체 허용 유지). 6-6에서 결정값 하나로 전환 가능하게 구현 |
| 결정-19 | `index.html` 기본 설명의 "가장 합리적인 가격과 무료배송" 문구 유지 여부 | 6-8에서 사실 문구로 교체 제안만, 교체는 승인 후 |
| 결정-20 | GTIN(바코드)·MPN(모델번호)을 상품 등록 항목(선택)으로 추가할지 | 추가하지 않음. 6-3에서 필드 없음으로 처리 |
| 결정-21 | 카테고리 소개문·자주 묻는 질문을 운영자가 직접 쓰는 항목으로 둘지 | 없음. 소개문·FAQ 구조화 데이터는 데이터가 생길 때만 출력 |

---

## 작업 6-0. 48360ae 감사 (배포 전 필수)

- 대상: `git diff fe4e11f 48360ae -- apps/cloudflare-gateway` (5파일: `routes/multichannel.js`, `services/channels/partner-live.js`(신규 282줄),
  `services/channels/coupang-orders.js`, `services/channels/smartstore-orders.js`, `services/connectors/naver-connector.js`).
  프런트·모바일 변경(62파일)도 같이 본다.
- 지시:
  1. 새 외부 호출(`fetch`)마다 인증 정보 출처, 실패 시 동작, 응답 위조 시 동작을 표로 정리한다.
  2. 파트너 A가 파트너 B의 채널 자격증명·주문·발주에 접근할 수 없음을 공격 테스트로 증명한다(`tests/security_integrity.mjs` 방식).
  3. 키가 없을 때 `SANDBOX_STUB`·가짜 성공이 아니라 `501 CONNECTOR_NOT_INTEGRATED`가 나오는지 확인한다(이전 감사 `audit-other-tool-commits` 사례).
  4. 결함은 고치고 실패 테스트를 먼저 커밋한다.
- 완료 기준: `reports/WORK_ORDER_PHASE6/6-0-audit.md`(표 + 결함 목록 + 수정 커밋), `npm test` 0 FAIL. 보고서에 "운영 배포 가능 / 불가"를 쓴다.

## 작업 6-1. 검색 기준선 측정 도구

- 지시:
  1. `scripts/seo/bot_view.mjs <url>`: 지정 UA 목록(Googlebot, Bingbot, Yeti(네이버), Daum, GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended 등)으로
     JS 없이 받아 상태코드·`<title>`·`meta description`·canonical·robots·JSON-LD 유형 목록·본문 텍스트 길이를 표로 출력한다(읽기 전용).
  2. 대상: `/`, 상품 3개(`/product/:slug`), 카테고리 3개, 판매자 1개(`/store/:id`), `/policy/:type`·`/legal/*` 전부, 없는 상품 1개.
  3. 결과를 `reports/WORK_ORDER_PHASE6/6-1-baseline.md`에 저장한다(현재 상태 = 0.1절 확인).
- 완료 기준: 스크립트 + 기준선 보고서. 이후 작업은 같은 스크립트로 전후를 비교한다.

## 작업 6-2. 엣지 렌더링: JS 없이 읽히는 HTML (SEO·GEO·LLMO·AIO 공통 기반)

- 설계: 루트 워커가 페이지 요청에 대해 정적 `index.html`을 받아 `HTMLRewriter`로 머리말·JSON-LD·본문 요약을 **모든 방문자에게 같게** 넣는다.
  데이터는 API의 새 읽기 전용 엔드포인트 하나에서 받는다.
- 지시:
  1. API `GET /api/v1/seo/page?path=<경로>` 추가: `{ status, head:{title,description,canonical,robots,og,twitter}, jsonld:[...], summary_html }`.
     기존 `seo-meta`·`seo-jsonld`·`seo-head` 빌더를 쓴다. 대상(실제 라우터 기준): `/`, `/product/:slug`, `/category/:slug`, `/categories`, `/store/:id`(판매자), `/channel/lightning-deals`, `/channel/best-sellers`, `/policy/:type`, `/legal/terms`·`/legal/privacy`·`/legal/refund`, `/support`.
     비공개 경로(`isNoindex`)는 `robots: noindex,nofollow`만 준다. 공개 캐시 `s-maxage=300`.
  2. `apps/storefront/edge/apex-worker.js`: 위 경로를 `run_worker_first`에 더하고, `env.API.fetch`로 받은 값을 `HTMLRewriter`로
     `<title>`·meta·canonical·`og:*`·`twitter:*`·`<script type="application/ld+json">`·`<div id="seo-summary">`(앱이 뜨면 SPA가 같은 내용을 그린다)에 넣는다.
     API 실패·시간초과(예: 800ms) 시 손대지 않은 `index.html`을 준다(사이트는 항상 뜬다).
  3. **상태코드**: 없는 상품·카테고리·판매자는 `404`, 비공개·판매중지 상품은 정책에 맞게 `404` 또는 `410`. 본문은 SPA 그대로(사용자는 앱의 404 화면을 본다).
  4. SPA 쪽(`ProductDetailView.vue`, `PlpLayout.vue`, `main.ts`)은 같은 API 응답을 쓰거나 같은 빌더 규칙을 따라 엣지와 문구가 일치하게 한다(규칙 16).
  5. `CRAWL_PATHS`/`run_worker_first` 일치 테스트(`tests/apex_worker_test.mjs` A01)를 새 목록으로 갱신한다.
- 완료 기준: `tests/seo_edge_render_test.mjs`(워커 직접 호출, 가짜 ASSETS + 하네스 API) — 상품·카테고리·판매자·정책 페이지에서 제목·설명·canonical·JSON-LD가 DB 값과 같음,
  없는 상품 404, API 장애 시 원본 HTML 200, 같은 URL에 UA를 바꿔도 HTML 동일. 6-1 스크립트 결과를 로컬 미리보기(`dist-local` + 로컬 API)로 첨부.

## 작업 6-3. 구조화 데이터 (SEO 리치 결과 + AEO·AIO 사실 근거)

- 지시 (모두 규칙 15 적용):
  1. **Product** (`productGraph` 확장): `name`, `description`(태그 제거·요약), `image`(전부), `brand`(있을 때), `sku`, `countryOfOrigin`,
     `offers`: SKU가 여럿이면 `AggregateOffer`(lowPrice·highPrice·offerCount) 아니면 `Offer`, `priceCurrency: KRW`, `availability`(재고 합계로 InStock/OutOfStock),
     `seller`(판매자 상호, `partners.business_name`), `shippingDetails`(`OfferShippingDetails`: 배송비·`handlingTime`=`processing_days`, 지역 KR),
     `hasMerchantReturnPolicy`(`MerchantReturnPolicy`: 반품 기간 `RETURN_WINDOW_DAYS`, 반품 배송비 `return_fee`, 국가 KR),
     `aggregateRating`·`review`(승인된 실제 리뷰만, 0건이면 생략), `dateModified`=`products.updated_at`.
     GTIN·MPN은 결정-20 전까지 넣지 않는다.
  2. **BreadcrumbList**: 상품·카테고리·판매자 페이지.
  3. **ItemList**: 카테고리·기획 채널 첫 페이지 상품(최대 20, 실제 순서).
  4. **Organization**: 활성 `business_entities` 행이 있으면 `legalName`·`address`·`telephone`·`email`·통신판매업 신고번호(`identifier`)까지,
     없으면 `name`·`url`·`logo`만. 하드코딩 금지(V3 지시: 운영 주체가 바뀌어도 과거 기록은 당시 주체로).
  5. **WebSite + SearchAction**: 홈에만. `target`은 실제 검색 주소(`/search?q=`)와 일치해야 한다.
  6. **FAQPage**: 실제 FAQ 데이터가 있는 페이지(고객센터·정책)만. 데이터 출처가 없으면 결정-21 전까지 출력하지 않는다.
  7. 판매자 페이지: `Organization`(판매자) + 상호·통신판매업 번호(있을 때).
- 완료 기준: `tests/seo_jsonld_facts_test.mjs` — 각 속성이 DB 행과 일치, 리뷰 0건 상품에 `aggregateRating` 없음, 재고 0이면 OutOfStock,
  사업자 0행이면 Organization에 법인 속성 없음, 모든 JSON-LD가 `JSON.parse` 가능·`</script>` 주입 불가(XSS). schema.org 유형·속성 철자 검사(허용 목록).

## 작업 6-4. AEO: 답이 먼저 보이는 본문 블록

- 목적: 답변 엔진·AI 개요가 "배송 며칠?", "반품 가능?", "어디서 만든 거?" 같은 질문에 페이지에서 바로 답을 찾게 한다.
- 지시:
  1. 상품 상세 상단에 **핵심 정보 표**(`<dl>`): 판매가(할인 전·후), 재고 상태, 배송비·출고 기간, 반품 기간·반품 배송비, 원산지, 브랜드, 판매자, 정보 갱신일.
     값은 6-3과 같은 출처. 엣지 `summary_html`과 SPA가 같은 마크업을 쓴다.
  2. 정책 페이지(`/policy/:type`, `/legal/*`): 제목을 질문형 소제목(예: "반품은 언제까지 할 수 있나요?")으로 나누고 첫 문장에 답을 쓴다. 내용은 현행 약관·정책 문서(`legal_documents`) 그대로.
  3. 상품 문의(`product_qna`): 답변 완료·공개 건만 본문에 질문/답 형태로 노출(구조화 데이터 유형은 쓰지 않는다, 규칙 18).
  4. 카테고리 소개문은 결정-21 전까지 만들지 않는다(문구 생성 금지).
- 완료 기준: `tests/seo_answer_blocks_test.mjs` — 표 값이 DB와 일치, 값 없는 항목은 행 자체가 없음, 비공개 문의 미노출. 3개 화면 디자인 검사(`design_lint`) 0건.

## 작업 6-5. GEO·LLMO: AI가 읽고 인용하기 좋은 문서

- 지시:
  1. **`/llms.txt`** 개편(llmstxt.org 형식): `# OLMOA` → 한 줄 요약(blockquote) → 운영 주체(활성 사업자 있을 때) → 섹션 `## 카테고리`, `## 판매 정책`(배송·반품·교환·개인정보 링크),
     `## 상품 문서`(아래 `.md` 링크), `## 연락처`, `## 인용 안내`(정식 주소 `https://olmoa.com/...`, 가격은 KRW·조회 시점 기준이라는 안내).
  2. **`/llms-full.txt`**: 정책 전문 + 카테고리별 상품 요약(상위 N개, 상한 명시).
  3. **상품 마크다운** `GET /llms/product/<slug>.md`(API 생성, 루트 워커 크롤 경로에 `/llms/*` 추가): 제목, 정식 주소, 가격·재고·배송·반품·원산지·브랜드·판매자 표,
     설명 텍스트, 갱신 시각. 없는 상품은 404. 카테고리 `.md`도 같은 방식.
  4. **엔터티 일관성**: 사이트 이름·한 줄 설명·로고가 Organization JSON-LD, `llms.txt`, `index.html`, 푸터에서 같은 문자열이어야 한다(한 곳에서 정의).
  5. **신선도**: JSON-LD `dateModified`, 사이트맵 `lastmod`(이미 있음), `.md` 갱신 시각이 같은 값을 쓴다.
  6. 각 HTML 페이지 `<head>`에 대응 `.md`를 `<link rel="alternate" type="text/markdown" href="...">`로 알린다.
- 완료 기준: `tests/seo_llms_docs_test.mjs` — 링크가 전부 200을 줄 주소를 가리킴, 가격·재고가 DB와 일치, 비공개·판매중지 상품 미포함, 문서 크기 상한 준수.

## 작업 6-6. robots.txt와 AI 크롤러 정책

- 지시:
  1. `services/seo/crawl-text.js`의 `robotsTxt`를 정책 표 기반으로 바꾼다: 검색 크롤러(Googlebot, Bingbot, Yeti, Daum 등) · 답변용 AI 크롤러 · 학습용 AI 크롤러를
     각각 `User-agent` 묶음으로 쓰고, 결정-18 값 하나(`AI_TRAINING_ALLOWED` 같은 env 또는 정책 테이블)로 학습용 묶음만 Allow/Disallow 전환한다.
  2. 비공개 경로 Disallow는 모든 묶음에 똑같이 넣는다(`/api/`, `/cart`, `/checkout`, `/my`, `/orders`, `/login` 등 현행 목록).
  3. Cloudflare Content Signals 줄(`Content-Signal: search=yes, ai-input=yes, ai-train=<결정-18>`)을 추가한다.
  4. 사이트맵 줄 유지(`/sitemap-index.xml`, `/sitemap.xml`).
  5. 운영자에게 알릴 것: Cloudflare 대시보드의 AI 크롤러 차단 설정(AI Crawl Control 등)이 robots 정책과 어긋나지 않게 맞춰야 한다(대시보드 작업, 보고서에 적기).
- 완료 기준: robots 테스트 — 결정값 두 경우 각각 기대 출력, 모든 묶음에 비공개 경로 포함, 사이트맵 줄이 `PUBLIC_STOREFRONT_URL` 기준.

## 작업 6-7. 색인 알림과 검색엔진 등록 준비

- 지시:
  1. IndexNow 키 파일을 정적 파일 대신 API가 env(`INDEXNOW_KEY`)로 내주게 한다(`/<key>.txt`, 루트 워커 크롤 경로). 키가 없으면 404·drain은 degraded 유지(현행 정직 동작).
  2. 상품 생성·수정·판매중지 시 IndexNow 큐에 넣는 경로를 점검하고 빠진 곳을 채운다(`services/seo/indexnow.js`). 보낼 엔드포인트(빙 등 IndexNow 참여 엔진, 네이버 참여 여부)는 구현 시 각 공식 문서로 확인해 보고서에 근거를 적는다.
  3. 네이버·구글 사이트 소유 확인용 meta(`naver-site-verification`, `google-site-verification`)를 env 값이 있을 때만 엣지 머리말에 넣는다(DNS TXT로 할 경우 불필요하다고 보고서에 적기).
- 완료 기준: 테스트(키 유무 2경우, 큐 적재 지점). 실제 제출은 운영자 작업(`HUMAN_CHECKLIST.md` §5-4).

## 작업 6-8. 국문 검색 세부 정리

- 지시:
  1. `html lang="ko"`, `og:locale=ko_KR`, hreflang `ko-KR` + `x-default` 일관.
  2. 목록 페이지의 정렬·필터 쿼리(`?sort=`, `?page=` 등): canonical은 쿼리 없는 주소, 2페이지 이후 처리 방침을 정하고 테스트한다. 검색 결과(`/search`)는 `noindex,follow`.
  3. 제목 규칙: 상품 `상품명 | 브랜드 | OLMOA`, 카테고리 `카테고리명 상품 | OLMOA`(길이 상한), 설명은 상품 설명에서 추출(마케팅 문구 생성 금지).
  4. 이미지 `alt`(상품명 + 옵션), 깨진 이미지 0.
  5. 결정-19 대비: `index.html` 기본 설명을 사실 문구로 바꾼 안을 보고서에 제시(교체는 승인 후).
- 완료 기준: `tests/seo_head_policy_test.mjs` 확장, design_lint 0, LCP 예산 CI(`lcp-budget`) 유지.

## 작업 6-9. 운영 반영 리허설 (원격 없음)

- 지시: `dist-local` + `scripts/local-api-server.mjs`로 6-2~6-8을 묶어 띄우고 6-1 스크립트로 전후 비교표를 만든다. 배포 순서(API → 루트 워커)와 롤백(이전 버전 재배포)을 `reports/WORK_ORDER_PHASE6/DEPLOY_PLAN.md`에 적는다.
  게이트웨이 배포는 6-0 결론이 "가능"일 때만 계획에 넣는다.
- 완료 기준: 전후 비교표, 배포 계획서. 운영 반영은 하지 않는다(규칙 14).

## 작업 6-10. 문서

- `docs/DOMAIN_CONFIGURATION.md`(크롤 경로 목록 갱신), `docs/openapi/openapi.yaml`(새 엔드포인트 + `openapi_reconciliation` 통과),
  `reports/WORK_ORDER_PROGRESS.md`(6-x 행 추가, 5-x 행 누락분도 `f123899` 기준으로 채운다), `reports/WORK_ORDER_QUESTIONS.md`(해석·보류 항목).

---

## 6단계 관문

- `npm test` 0 FAIL, `npm run typecheck` 0, `npm run lint` 0, cspell 0, design_lint 상한 증가 없음.
- 6-1 스크립트 전후 비교: 상품·카테고리·판매자·정책 페이지가 JS 없이 고유 제목·설명·canonical·JSON-LD·요약 본문을 가짐, 없는 상품 404.
- 구조화 데이터·`.md`·`llms.txt`의 모든 값이 DB와 일치(테스트), 지어낸 값 0.
- 같은 URL에 UA만 바꾼 응답 HTML이 동일(클로킹 0).
- 6-0 보고서 결론과 배포 계획서 존재. 운영 반영 0건(규칙 14).
- 완료 보고는 PASS / FAIL / BLOCKED / NOT_RUN 네 가지로만 쓴다. 결정 대기 항목은 BLOCKED.
