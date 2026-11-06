# Cloudflare 프로젝트 생성 및 환경 설정 가이드 (CLOUDFLARE_SETUP.md)

## 1. 프로젝트 구성 (실측 기준)

| Worker 이름 | 용도 | 디렉터리 | 진입점 |
|---|---|---|---|
| `olmoa-api` | Edge API 게이트웨이 + D1 | `apps/cloudflare-gateway` | `src/index.js` (`wrangler.jsonc`) |
| `olmoa-storefront` | 구매자 스토어프론트 (정적) | `apps/storefront` | `dist` (`wrangler.jsonc` assets) |
| `olmoa-partner` | 판매자 콘솔 (정적) | `apps/partner` | `dist` (`wrangler.jsonc` assets) |
| `olmoa-admin` | 관리자 콘솔 (정적) | `apps/admin` | `dist` (`wrangler.jsonc` assets) |

D1 데이터베이스: `openmarket-db` (`6935e21b-ffdc-47d1-8e7d-d97b1b8b317a`), 바인딩명 `DB`.
`apps/api`(Go 데모 서버)와 `backend/`(Go 도메인 참조 구현)는 프로덕션 요청 경로가 아니다.

## 2. 시크릿 주입 (프로덕션 필수)

```bash
cd apps/cloudflare-gateway
wrangler secret put JWT_SECRET            # 32자 이상, 필수
wrangler secret put TOSS_SECRET_KEY       # live 모드에서 필수 (test_/live_ 키)
wrangler secret put PAYMENT_WEBHOOK_SECRET
wrangler secret put CARRIER_WEBHOOK_SECRET
wrangler secret put RESEND_API_KEY        # 메일 발송용 (없으면 NOT_INTEGRATED 유지)
wrangler secret put KAKAO_REST_API_KEY    # 소셜 로그인용 (없으면 501 유지)
```

그 밖의 논시크릿은 `wrangler.jsonc` vars 또는 `.env.example` 참조:
`ALLOWED_ORIGINS`(브라우저 오리진 allowlist, 필수),
`PAYMENT_MODE=live`, `TOSS_CLIENT_KEY`, `EMAIL_FROM`, `KAKAO_REDIRECT_URI`,
`PUBLIC_STOREFRONT_URL`, `ADMIN_IP_ALLOWLIST`, `ADMIN_2FA_REQUIRED=true`,
`RATE_LIMIT_REQUIRED=true`, `SOLAPI_*`, `PRICESCANNER_API_KEY`,
`CONNECTOR_SIMULATION=false`(프로덕션 고정), `ALERT_WEBHOOK_URL`.

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
