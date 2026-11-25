# 도메인 컷오버 런북 — workers.dev → olmoa.com

- 최초 작성 2026-11-21, **개정 2026-11-25** (도메인 구매 전 전수 감사 반영).
- 원격 단계(DNS·시크릿·배포·대시보드)는 전부 운영자 승인 후 실행. 코드 수정은 이미 끝난 것만 둔다.
- 2026-11-25 조회: `olmoa.com`·`olmoa.net`·`olmoa.co.kr`·`olmoa.kr` 모두 NXDOMAIN, Verisign RDAP(.com/.net) 404 → 미등록.

## 0. 구매 전 금지 사항

코드의 `PUBLIC_STOREFRONT_URL` 기본값이 `https://olmoa.com`이다. 비밀번호 재설정·이메일 인증 링크(`lib/email.js`)와
카카오 로그인 1회용 코드 리다이렉트(`routes/social-auth.js`)가 이 호스트로 나간다.

- **`olmoa.com`을 소유하기 전에는 `RESEND_API_KEY`/`EMAIL_FROM`/`KAKAO_*` 시크릿을 넣지 않는다.** 남의 도메인으로 토큰이 나간다.
- 다른 도메인을 사게 되면 위 기본값(`lib/email.js`, `routes/seo.js`, `routes/integrations.js`, `lib/seo-head.js`,
  `services/seo/indexnow.js`, `apps/storefront/index.html`)부터 바꾼다.
- 상표(KIPRIS "올모아/OLMOA", 35류) 검색은 구매 전 운영자가 직접 확인한다.

## 1. 사전 완료 코드 (2026-11-21, 2026-11-25)

| 항목 | 내용 | 검증 |
|---|---|---|
| PriceScanner `product_url` | `PUBLIC_STOREFRONT_URL` 추종 (11-21) | `p1_api_data` P05 |
| 루트 도메인 크롤 경로 | 루트 워커 `openmarket`에 `apps/storefront/edge/apex-worker.js` 추가. `/robots.txt`, `/sitemap.xml`, `/sitemap-index.xml`, `/sitemaps/*`, `/llms.txt`, `/llms-full.txt`만 `run_worker_first`로 API 워커(서비스 바인딩 `API` → `olmoa-api`)에 전달, 나머지는 정적 SPA. 이전에는 이 경로들이 `200 text/html`(SPA 껍데기)이었고 API sitemap-index의 `olmoa.com/sitemaps/*`가 전부 HTML을 가리켰다 | `tests/apex_worker_test.mjs` A01–A04, `wrangler deploy --dry-run`(CI) |
| 정적 사이트맵 삭제 | `apps/storefront/public/sitemap.xml`(존재하지 않는 `olmoa-storefront.pages.dev` URL) 삭제 | A05 |
| 정적 robots | workers.dev Sitemap 줄 제거. 루트 도메인에서는 API가 생성한 robots가 나간다 | A05 |
| 빌드 env 가드 | `scripts/vite-require-env.mjs`: Cloudflare Workers Builds(`WORKERS_CI`) 또는 `OLMOA_REQUIRE_BUILD_ENV=1`에서 VITE_* 누락 시 **빌드 실패** (깨진 번들 배포 대신) | A06, 실빌드 확인 |
| deploy.yml env | VITE_* 4종을 job 레벨로 이동. 각 `wrangler deploy` 단계가 자기 `[build]`를 다시 돌리는데 env가 첫 빌드 단계에만 있어서, 토큰을 넣는 순간 4개 프론트가 env 없이 재빌드·배포될 상태였다 | A06 |

## 2. 도메인 의존 지점 인벤토리

| 위치 | 현재 값 | 컷오버 조치 |
|---|---|---|
| `.github/workflows/deploy.yml` job `env` VITE 4종 | `*.workers.dev` | custom domain 4종으로 교체 후 push (§3-6) |
| Cloudflare 대시보드 `openmarket` 워커 Build Variables | **없음** (Git 자동 빌드) | §3-2. 가드 덕분에 이제 배포 대신 빌드 실패로 끝나지만, 값 설정 또는 Git 연결 해제는 필요 |
| Worker secret `ALLOWED_ORIGINS` | workers.dev 4종 | 전환 기간: 새 4종 + 기존 workers.dev. 검증 후 workers.dev 제거 |
| Worker secret `PUBLIC_STOREFRONT_URL` | 미설정(기본 olmoa.com) | `https://olmoa.com` 명시 |
| Worker secret `KAKAO_REDIRECT_URI` | 미설정 | 카카오 도입 시 `https://api.olmoa.com/api/v1/auth/social/kakao/callback` + 카카오 콘솔 등록 |
| `EMAIL_FROM` | 미설정 (`.env.example`: `noreply@olmoa.com`) | §3-8 메일 DNS 후 설정 |
| DB `storage_objects.public_url` 등 | `https://olmoa-api.dnjstjqppk.workers.dev/...` 절대 URL | **`olmoa-api`의 workers.dev 라우트를 끄지 않는다.** 신규 업로드는 요청 호스트(`api.olmoa.com`)로 저장됨 |
| 모바일 `api_service.dart` 2종 `defaultValue` | olmoa-api workers.dev | 릴리스 빌드 `--dart-define API_BASE_URL=https://api.olmoa.com`. 기본값 유지 가능(workers.dev 유지 전제) |
| `docs/openapi/openapi.yaml`, `docs/integrations/pricescanner-openapi.yaml` | workers.dev | 컷오버 후 문서 갱신 (코드 무관) |
| `route_smoke.mjs`·`lcp_probe.mjs` 기본 API | workers.dev | REMOTE 실행용 기본값, env로 덮어씀 |
| `services/connectors/logistics-3pl-connector.js` `storage.olmoa.com` | 시뮬레이션 송장 URL | 호출부 없는 죽은 코드. 정리 대상, 컷오버 무관 |
| IndexNow 키 파일 | 없음 | §3-9 |

## 3. 순서

1. **등록** — `.com`은 Cloudflare Registrar(존 자동 생성). `.co.kr`/`.kr` 방어 등록은 국내 등록기관(Cloudflare 미지원) →
   네임서버를 Cloudflare로 지정 → `.com`으로 301.
2. **대시보드 자동 빌드 정리 (컷오버 전 필수)** — `openmarket` 워커 → Settings → Build:
   Variables에 `VITE_API_BASE_URL`/`VITE_PARTNER_URL`/`VITE_ADMIN_URL`(+`VITE_STOREFRONT_URL`)을 넣거나 Git 연결을 해제.
   다른 워커도 Git 연결돼 있으면 동일. deploy.yml과 대시보드 두 곳에서 배포하면 값이 어긋나기 쉬우므로 **하나만 쓰는 것을 권장**.
3. **이 커밋을 workers.dev 상태에서 먼저 배포**하고 확인한다 (루트 워커에 서비스 바인딩이 생긴다):
   `curl -sI https://openmarket.dnjstjqppk.workers.dev/sitemap-index.xml` → `content-type: application/xml`.
4. **DNS 레코드를 손으로 만들지 않는다.** Worker Custom Domain이 레코드·인증서를 직접 만든다. 같은 이름의 레코드가 있으면
   충돌한다 (구 문서의 `A @ 192.0.2.1`, `CNAME api → olmoa-api.workers.dev`는 쓰지 않는다).
   Workers & Pages → 각 워커 → Settings → Domains & Routes → Custom Domain:
   `olmoa.com → openmarket`, `api.olmoa.com → olmoa-api`, `admin.olmoa.com → olmoa-admin`, `partner.olmoa.com → olmoa-partner`.
   `olmoa-storefront`는 루트 도메인에 붙이지 않고 workers.dev 예비로 둔다.
5. **www·HTTPS·HSTS** — DNS `AAAA www 100::`(Proxied) + Redirect Rule "www → apex" 301(경로·쿼리 유지).
   SSL/TLS → Edge Certificates: Always Use HTTPS 켬. HSTS `max-age=31536000; includeSubDomains`.
   **`preload`는 첫날 신청하지 않는다** (되돌리기 어렵다. 수 주 안정화 후 검토).
6. **시크릿 + CI** — `wrangler secret put ALLOWED_ORIGINS`(전환 기간 신·구 병기), `PUBLIC_STOREFRONT_URL=https://olmoa.com`.
   `deploy.yml` job env 4종을 `https://api.olmoa.com`/`https://olmoa.com`/`https://partner.olmoa.com`/`https://admin.olmoa.com`으로
   교체 → `main` push → 5 워커 재빌드·재배포. 로컬 배포 시에도 같은 4종을 셸에 export (각 `wrangler deploy`가 다시 빌드한다).
7. **외부 콘솔** — Toss 상점 사이트 URL, (도입 시) 카카오 Redirect URI·사이트 도메인.
8. **메일** — Resend 도메인 인증(SPF/DKIM TXT), DMARC `_dmarc TXT "v=DMARC1; p=none; rua=mailto:<수신주소>"`.
   하단 고지용 고객센터 메일을 받으려면 수신 MX 필요 (Cloudflare Email Routing). 그다음 `RESEND_API_KEY`/`EMAIL_FROM` 설정.
9. **검색엔진** — Google Search Console·네이버 서치어드바이저 소유 확인(DNS TXT) 후 `https://olmoa.com/sitemap-index.xml` 제출.
   IndexNow: KEY 발급 → `apps/storefront/public/<KEY>.txt`(내용=KEY) → 재배포 → SEO drain.
10. **전환 기간 종료** — 검증 후 `ALLOWED_ORIGINS`에서 workers.dev 제거. `olmoa-api` workers.dev는 계속 유지(§2).

## 4. 검증 (합격 기준)

상태 코드만 보지 않는다. SPA 폴백은 없는 경로에도 200을 준다. **Content-Type까지 확인한다.**

```bash
curl -s https://api.olmoa.com/health                                    # status UP, 기대 schemaVersion
for p in /robots.txt /sitemap-index.xml /sitemaps/categories.xml /llms.txt; do
  curl -s -o /dev/null -w "$p %{http_code} %{content_type}\n" https://olmoa.com$p
done                                                                    # 200 + xml/text/plain (text/html이면 불합격)
curl -s https://olmoa.com/sitemap-index.xml | grep -o '<loc>[^<]*'      # 전부 https://olmoa.com/...
curl -sI http://olmoa.com/ https://www.olmoa.com/x?y=1 | grep -i -E '^(HTTP|location)'   # 301 → https://olmoa.com/...
curl -sI https://olmoa.com/ | grep -i strict-transport                  # HSTS 존재
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS https://api.olmoa.com/api/v1/products \
  -H "Origin: https://olmoa.com" -H "Access-Control-Request-Method: GET"   # 4 오리진 각각, ACAO 헤더 확인
```

- 3 콘솔 custom domain 1페이지씩 로드, 번들의 API 호스트가 `api.olmoa.com`인지 확인.
- 샌드박스 주문 1건 E2E.

## 5. 롤백

Custom Domain detach(트래픽은 workers.dev로 계속 동작) → `deploy.yml` job env를 workers.dev로 되돌려 `main` push.
`ALLOWED_ORIGINS`에 workers.dev가 남아 있으면 즉시 복구된다. D1·시크릿 롤백은 `reports/WORK_ORDER_PHASE5/DEPLOY_RUNBOOK.md`.
