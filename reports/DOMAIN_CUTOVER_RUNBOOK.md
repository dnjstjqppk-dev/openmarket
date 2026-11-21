# 도메인 컷오버 런북 — workers.dev → olmoa.com

Date: 2026-11-21 (도메인 구매 전 사전 준비본). 구매 당일 이 문서 순서대로 실행한다.
원격 단계(DNS·시크릿·배포)는 전부 운영자 승인 후. 코드 수정은 이미 끝난 것만 둔다.

## 0. 사전 완료 (2026-11-21, 커밋 대기)

- PriceScanner 피드 `product_url` 하드코딩 제거:
  `routes/integrations.js`가 `PUBLIC_STOREFRONT_URL`(기본 `https://olmoa.com`)을
  따르도록 수정 + P05에 기본값·env·trailing-slash 3단언 추가. `p1_api_data` 14/14.
- 소스 내 `workers.dev` 잔여는 무해·문서·컷오버 당일분만 남음 (§1 표).

## 1. 도메인 의존 지점 인벤토리

| 위치 | 현재 값 | 컷오버 조치 |
|---|---|---|
| `.github/workflows/deploy.yml` VITE 4종 | `*.workers.dev` | 당일 custom domain 4종으로 교체 후 push → CI 재배포 (필수, 순서 §2-5) |
| Worker secret `ALLOWED_ORIGINS` | workers.dev 4종 | `https://olmoa.com,https://www.olmoa.com,https://admin.olmoa.com,https://partner.olmoa.com` |
| Worker secret `PUBLIC_STOREFRONT_URL` | 미설정(기본 olmoa.com) | `https://olmoa.com` 명시 설정 (sitemap·canonical·피드·메일 링크) |
| Worker secret `KAKAO_REDIRECT_URI` | workers.dev 콜백 | `https://api.olmoa.com/api/v1/auth/social/kakao/callback` + 카카오 콘솔 재등록 |
| `EMAIL_FROM` | `noreply@olmoa.com` | Resend 도메인 인증(SPF/DKIM TXT) 후 발송 개시 |
| `docs/openapi/openapi.yaml`, `docs/integrations/pricescanner-openapi.yaml` | workers.dev 3곳 | 컷오버 후 문서 URL 갱신 (코드 무관) |
| 모바일 `api_service.dart` 2종 `defaultValue` | olmoa-api workers.dev | 릴리스 빌드 `--dart-define API_BASE_URL=https://api.olmoa.com`; 기본값 교체는 후속 검토 |
| `route_smoke.mjs`·`lcp_probe.mjs` 기본 API | workers.dev | REMOTE 실행용 기본값, 무해 (env로 덮어씀) |
| `commerce_engine_e2e.js` 등 구 테스트 3종 | workers.dev | npm test 체인 밖 stale, 무시 |
| IndexNow 키 파일 | 없음 | KEY 발급 후 `apps/storefront/public/<KEY>.txt`(내용=KEY) 추가·재배포 (§2-8) |

## 2. 컷오버 당일 순서

1. **도메인 등록** — Cloudflare Registrar 권장 (DNS·SSL 자동).
2. **DNS** (`docs/DOMAIN_CONFIGURATION.md` §2 표 그대로, 전부 Proxied):
   `A @ → 192.0.2.1`, `CNAME www → olmoa.com`,
   `CNAME api/admin/partner → 각 워커의 workers.dev 호스트`.
3. **Worker Custom Domains** (각 Worker → Settings → Domains & Routes):
   `olmoa.com → openmarket`(root, storefront dist),
   `api/admin/partner.olmoa.com → olmoa-api/admin/partner`.
   `olmoa-storefront` 워커는 apex에 붙이지 않고 workers.dev warm spare로 유지.
4. **리다이렉트·보안** (Cloudflare 대시보드): `www → apex 301`,
   `http → https 301`, SSL Full (Strict), HSTS `max-age=31536000; includeSubDomains; preload`.
5. **시크릿 + CI URL 교체 + 재배포**:
   `wrangler secret put ALLOWED_ORIGINS / PUBLIC_STOREFRONT_URL / KAKAO_REDIRECT_URI`,
   `deploy.yml` VITE 4종 교체 후 `main` push → 5 워커 재배포.
   (리빌드 없는 배포는 엔드포인트를 안 옮긴다.)
6. **외부 콘솔**: 카카오 Redirect URI·사이트 도메인, Toss 상점 URL 현행화.
7. **Resend**: olmoa.com 도메인 인증 후 테스트 메일 1통.
8. **IndexNow**: KEY 발급 → `public/<KEY>.txt` → 재배포 → SEO drain 실행.

## 3. 검증 (합격 기준)

- `GET https://api.olmoa.com/health` → `UP`, `schemaVersion: d1_74_seo_crawl.sql`.
- 4 오리진 CORS preflight 200, `www/http` 301, HSTS 헤더 존재.
- 3 콘솔 custom domain 1페이지씩 로드, 샌드박스 주문 1건 E2E.
- `/sitemap-index.xml`·canonical·`product_url` 호스트가 전부 `olmoa.com`.
- `/robots.txt`·`/llms.txt` 200.

## 4. 롤백

DNS CNAME을 workers.dev로 복귀하거나 Custom Domain detach 후,
`deploy.yml` VITE를 workers.dev로 되돌려 `main` push → 이전 엔드포인트로 재배포.
D1·시크릿 롤백은 `reports/WORK_ORDER_PHASE5/DEPLOY_RUNBOOK.md`를 따른다.
