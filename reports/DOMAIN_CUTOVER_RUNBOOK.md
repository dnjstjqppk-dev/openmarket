# 도메인 컷오버 런북 — workers.dev → olmoa.com

- 최초 작성 2026-11-21, **개정 2026-11-25** (도메인 구매 전 전수 감사 반영).
- 원격 단계(DNS·시크릿·배포·대시보드)는 전부 운영자 승인 후 실행. 코드 수정은 이미 끝난 것만 둔다.
- 2026-11-25 조회: `olmoa.com`·`olmoa.net`·`olmoa.co.kr`·`olmoa.kr` 모두 NXDOMAIN, Verisign RDAP(.com/.net) 404 → 미등록.

## ★★ 계정 이전 기록 (2026-11-25, 최신 상태) — 아래 "실행 기록"의 프록시 구조를 대체

운영자 결정: 도메인은 도메인 계정(`f5c363…`)에서 관리 → **워커·D1·R2·시크릿을 도메인 계정으로 이전**.
현재 구조는 `docs/DOMAIN_CONFIGURATION.md` 1.3.0.

| 단계 | 내용 | 결과 |
|---|---|---|
| 조사 | 암호화 PII(`enc:v1:`) 0셀, 2FA 관리자 1명, 사용자 43, 주문 59(전부 CANCELLED), R2 객체 0, D1 2.25MB | 새 키 생성 가능 판단 |
| 백업 | `d1 export`는 FTS5 가상테이블 때문에 실패 → 실테이블 128개 `--table` 개별 export (`.ops-backups/`, git 제외). 인덱스·트리거는 export에 없음 → prod `sqlite_master`에서 DDL 추출 | 1,603행 |
| 복원 스크립트 | `scripts/ops/build_d1_restore.py`: CREATE TABLE 전부 → FK 의존 순서 INSERT(자기참조 `categories.parent_id`는 트리 깊이순) → FTS(d1_51) + 백필 → 수정(파일 URL 호스트 교체, 2FA 초기화) → 인덱스 105·트리거 55 | 로컬 FK-ON 리허설 통과 + 게이트웨이 스모크 |
| 함정 | D1 `--file` 가져오기는 `PRAGMA defer_foreign_keys`를 적용하지 않음 → 1차 가져오기 FK 실패(원자적 롤백, 데이터 무손상). 부모 우선 정렬로 해결 | 2차 성공 |
| 새 D1 | `openmarket-db` `6e23f7cd-7999-4419-ac6e-63481edc5454` (APAC). 128테이블 1,603행 0불일치, 인덱스 105, 트리거 55, FTS 64 | 일치 |
| 시크릿 | `JWT_SECRET`/`PII_ENCRYPTION_KEY`/`TOTP_ENCRYPTION_KEY` **새로 생성** (원본은 Cloudflare에서 읽을 수 없음) + `ALLOWED_ORIGINS`(custom 4종) + `PUBLIC_STOREFRONT_URL`. 값 사본: `.ops-backups/olmoa-api-secrets-2026-11-25.json` → **비밀번호 관리자로 옮긴 뒤 삭제** | 영향: 전원 1회 재로그인, 2FA 관리자 1명 재등록 |
| API | `olmoa-api` = **라이브와 동일한 fe4e11f 게이트웨이 코드** (미감사 48360ae 제외) → `api.olmoa.com` | /health 구계정과 동일 |
| 콘솔 | `openmarket`(olmoa.com), `olmoa-admin`, `olmoa-partner`를 VITE custom domain 값으로 빌드·배포 → Custom Domain 인수 (`olmoa-edge`는 www 리다이렉트만) | 번들 API=`api.olmoa.com`, 구 workers.dev 참조 0 |
| 데이터 공백 | 최종 export(06:44:02Z) 이후 구 DB 신규 사용자·주문 0 | 손실 없음 |

**아직 남은 것**
1. **Always Use HTTPS 켜기** (대시보드: olmoa.com → SSL/TLS → Edge Certificates). 지금 `http://olmoa.com`은 301 없이 200.
2. ~~구 계정 정리~~ **완료(2026-11-25, 운영자 지시)**: 구 계정의 OLMOA 워커 5개(`openmarket`, `olmoa-storefront`, `olmoa-admin`, `olmoa-partner`, `olmoa-api`), D1 `openmarket-db`(`6935e21b…`), R2 `olmoa-media` 삭제. 옛 `*.dnjstjqppk.workers.dev` 주소는 더 이상 응답하지 않는다. 같은 계정의 다른 프로젝트(luno·checkin·Pages 6개)는 이 저장소와 무관해 별도 판단.
3. CI: `deploy.yml`은 이제 도메인 계정으로 배포된다(설정에 `account_id`). `CLOUDFLARE_API_TOKEN`은 도메인 계정 권한으로 발급. 단, **main의 게이트웨이에는 미감사 48360ae가 포함**되어 있어 토큰을 넣으면 그 코드가 배포된다 → 먼저 감사.
4. ~~구 계정 `openmarket` Git 자동 빌드~~ 워커 삭제로 함께 사라짐. 새 계정 워커에는 Git 연결이 없다(CI `deploy.yml`만 사용).
5. 롤백: 구 계정 자원이 삭제되어 **계정 롤백은 불가**. 새 계정 안에서의 복구는 D1 Time Travel(`wrangler d1 time-travel`) 또는 `.ops-backups/` export + `scripts/ops/build_d1_restore.py`로 새 DB를 만들어 바인딩 교체.

## ★ 실행 기록 (2026-11-25) — 실제 적용된 구조

`olmoa.com`은 2026-11-25 Cloudflare Registrar로 **도메인 계정**(`f5c363…`, 운영자가 모든 도메인을 관리)에 등록됐다.
앱 워커·D1·R2·시크릿은 **워커 계정**(`6d53e0…`)에 있다. Custom Domain은 같은 계정끼리만 붙으므로
(`wrangler triggers deploy` → `The zone "olmoa.com" does not exist on your account [10083]`), 아래 §3-4의
"각 앱 워커에 Custom Domain" 방식은 **쓰지 않았다**. 대신:

| 단계 | 내용 | 결과 |
|---|---|---|
| 프록시 워커 | 도메인 계정에 `olmoa-edge`(`infra/domain-proxy/`) 배포. Custom Domain 4개: `olmoa.com`, `www`, `admin`, `partner` → 각 workers.dev 업스트림. apex 크롤 경로는 API로 직행. www·http 301, HSTS(preload 없음) | 배포 완료 (version `364bef02`) |
| API | `api.olmoa.com` **미사용**. 프록시를 거치면 모든 사용자가 같은 egress IP로 보여 API의 IP별 레이트리밋(로그인 5/분)이 공유 버킷이 된다. API는 workers.dev 유지 | 변경 없음 |
| CORS | `ALLOWED_ORIGINS` = workers.dev 4종 + `olmoa.com`, `www`, `admin`, `partner` (기존 6개 유지 + 2개 추가) | 8개 허용·임의 오리진 차단 확인 |
| 검증 | apex 200 SPA, `www`/`http` 301(경로·쿼리 유지), robots `text/plain`, sitemap-index·sitemaps `application/xml`(loc 전부 `https://olmoa.com/...`), llms `text/plain`, admin/partner 200 | 통과 |

**연결 직후 이상 현상:** 첫 몇 분간 `olmoa.com`·`www`가 Shopify(423 Locked, `powered-by: Shopify`)로 응답했다.
운영자는 Shopify를 연결한 적이 없다. 웹 아카이브상 이 도메인은 2016–2025년 다른 소유자가 썼던 이력이 있어,
이전 소유자의 Shopify 라우팅이 엣지에 남아 있던 것으로 보인다(추정). 몇 분 뒤 자동으로 `olmoa-edge`로 바뀌었다.
다시 나타나면 Cloudflare/Shopify 지원에 도메인 소유 증빙과 함께 해제를 요청한다.

**남은 일 (이 표 이후 §3에서 유효한 것):**
- deploy.yml·대시보드의 `VITE_STOREFRONT_URL`/`VITE_PARTNER_URL`/`VITE_ADMIN_URL`을 custom domain으로 교체 후 재빌드
  (콘솔 간 링크용). `VITE_API_BASE_URL`은 workers.dev 그대로.
- `PUBLIC_STOREFRONT_URL=https://olmoa.com` 명시 설정 (현재 기본값과 같음, 명시만).
- 메일 DNS(§3-8), 검색엔진 등록(§3-9), 카카오 도입 시 Redirect URI는 API workers.dev 호스트 기준.
- `api.olmoa.com`이 필요해지면: API 워커+D1+R2+시크릿을 도메인 계정으로 이전하거나, 존을 워커 계정으로 이동.
- 링크가 모두 custom domain으로 바뀐 뒤 `ALLOWED_ORIGINS`에서 workers.dev 제거. 앱 워커의 workers.dev 자체는 끄지 않는다(프록시 업스트림).

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
