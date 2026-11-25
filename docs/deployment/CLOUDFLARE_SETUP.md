# Cloudflare 프로젝트 생성 및 환경 설정 가이드 (CLOUDFLARE_SETUP.md)

## 1. 프로젝트 구성 (실측 기준)

모든 자원은 **도메인 계정** `f5c363135efe9b22ca66eb39f2f8e1da`(olmoa.com 존 소유)에 있다. 각 wrangler 설정에 `account_id`가 고정돼 있다.
(구 계정 `6d53e0…`의 OLMOA 자원은 2026-11-25 삭제. 상세: `docs/DOMAIN_CONFIGURATION.md`, `reports/DOMAIN_CUTOVER_RUNBOOK.md`)

| Worker 이름 | 주소 (Custom Domain) | 디렉터리 | 진입점 |
|---|---|---|---|
| `olmoa-api` | `https://api.olmoa.com` | `apps/cloudflare-gateway` | `src/index.js` (`wrangler.jsonc`) |
| `openmarket` | `https://olmoa.com` | 저장소 루트 | `wrangler.toml` — 스토어프론트 `dist` + `apps/storefront/edge/apex-worker.js`(크롤 경로 → API) |
| `olmoa-admin` | `https://admin.olmoa.com` | `apps/admin` | `dist` (`wrangler.jsonc` assets) |
| `olmoa-partner` | `https://partner.olmoa.com` | `apps/partner` | `dist` (`wrangler.jsonc` assets) |
| `olmoa-edge` | `https://www.olmoa.com` → 301 apex | `infra/domain-proxy` | `worker.js` |

모든 워커는 `workers_dev: false`다. `olmoa-storefront`(예비 워커)는 폐지됐다.

D1 데이터베이스: `openmarket-db` (`6e23f7cd-7999-4419-ac6e-63481edc5454`, APAC), 바인딩명 `DB`. R2: `olmoa-media`(바인딩 `STORAGE_BUCKET`).
백업: `wrangler d1 export`는 FTS5 테이블 때문에 실패한다 → `reports/WORK_ORDER_PHASE5/DEPLOY_RUNBOOK.md` 상단 주의와 `scripts/ops/build_d1_restore.py` 참조.
`apps/api`와 `backend/`(구 Go 참조 구현)는 2026-11-12 NEW-24 결정으로 삭제됐다. API는 `apps/cloudflare-gateway` 단일 구현이다.

## 2. 시크릿 주입 (프로덕션 필수)

```bash
cd apps/cloudflare-gateway
wrangler secret put JWT_SECRET            # 32자 이상, 필수
wrangler secret put TOSS_SECRET_KEY       # live 모드에서 필수 (test_/live_ 키)
wrangler secret put PAYMENT_WEBHOOK_SECRET
wrangler secret put CARRIER_WEBHOOK_SECRET
wrangler secret put RESEND_API_KEY        # 메일 발송용 (없으면 NOT_INTEGRATED 유지)
wrangler secret put KAKAO_REST_API_KEY    # 소셜 로그인용 (없으면 501 유지)
wrangler secret put TOTP_ENCRYPTION_KEY   # 32자 이상, 운영 필수 (없으면 운영에서 2FA seal 거부)
wrangler secret put PII_ENCRYPTION_KEY    # 32자 이상, 운영 필수 (없으면 운영에서 정산계좌·PCCC·알림 seal 거부)
```

`TOTP_ENCRYPTION_KEY`·`PII_ENCRYPTION_KEY`는 `JWT_SECRET`과 독립된 키여야 한다.
운영(`ENVIRONMENT=production`)에서 미설정 시 해당 seal 호출이 실패하므로 배포 전 주입을 확인할 것.
키 교체 시 기존 seal 값을 복호화할 수 없으므로 교체 전 복호화·재암호화 백필이 필요하다.

그 밖의 논시크릿은 `wrangler.jsonc` vars 또는 `.env.example` 참조:
`ALLOWED_ORIGINS`(브라우저 오리진 allowlist, 필수),
`PAYMENT_MODE=live`, `TOSS_CLIENT_KEY`, `EMAIL_FROM`, `KAKAO_REDIRECT_URI`,
`PUBLIC_STOREFRONT_URL`, `ADMIN_IP_ALLOWLIST`, `ADMIN_2FA_REQUIRED=true`,
`RATE_LIMIT_REQUIRED=true`, `SOLAPI_*`, `PRICESCANNER_API_KEY`,
`CONNECTOR_SIMULATION=false`(프로덕션 고정), `ALERT_WEBHOOK_URL`,
`SENTRY_DSN`(서버 500 오류 외부 알림, 미설정 시 no-op), `GIT_COMMIT`(릴리스 태그),
`FDS_BLOCK_SCORE`(기본 85), `FDS_REVIEW_SCORE`(기본 40), `FDS_HIGH_VALUE_KRW`(기본 1500000),
`FDS_VELOCITY_COUNT`(기본 3), `FDS_VELOCITY_MINUTES`(기본 10).

## 3. D1 마이그레이션 적용

```bash
# 원격 D1에 순서대로 적용 (신규 설치 시 d1_01부터 전체, 운영 중이면 d1_34만 추가)
npx wrangler d1 execute openmarket-db --remote --file=migrations/d1_34_social_accounts.sql
```

## 4. 배포 명령어

```bash
npm run build          # 3개 프론트엔드 빌드
npm run deploy:api
npm run deploy:storefront
npm run deploy:partner
npm run deploy:admin
```

GitHub Actions(`.github/workflows/ci.yml`, `deploy.yml`)가 main 푸시마다 빌드·E2E·배포를 수행한다.

## 5. 실서비스 전환(Go-Live) 체크리스트

- [ ] PG 실계약 후 `TOSS_SECRET_KEY`(live_) + `TOSS_CLIENT_KEY` 주입, `PAYMENT_MODE=live`
- [ ] Resend 발신 도메인 DNS 인증 후 `RESEND_API_KEY`·`EMAIL_FROM` 주입, 재설정 메일 수신 확인
- [ ] Kakao 개발자 콘솔에 Redirect URI 등록 + `account_email` 동의 항목 활성화 후 키 주입
- [ ] 택배사 웹훅 계약 후 `CARRIER_WEBHOOK_SECRET` 주입 (서명 검증 실패 시 401)
- [ ] UNI-PASS(관세청) 및 캐리어 실시간 API는 별도 B2B 계약 후 연동 (현재 `NOT_INTEGRATED`로 정직 표기)
- [ ] `olmoa.com` 구매 후 DNS·커스텀 도메인 바인딩, `ALLOWED_ORIGINS`·`PUBLIC_STOREFRONT_URL` 갱신
- [ ] 관리자 2FA 등록 + `ADMIN_IP_ALLOWLIST` 설정
- [ ] `/health` readiness 전부 녹색, `/api/v1/client-errors` 수신 확인 (Cloudflare Logs)
