# Cloudflare 프로젝트 생성 및 환경 설정 가이드 (CLOUDFLARE_SETUP.md)

## 1. 프로젝트 네이밍 및 구성

| 프로젝트명 | 프레임워크 / 빌드 모드 | 루트 디렉터리 | 빌드 명령어 | 출력 디렉터리 |
|---|---|---|---|---|
| `openmarket` (루트 통합) | Static Assets | `.` | `npm run build` | `public` |
| `openmarket-storefront` | Static Assets | `apps/storefront` | `echo ready` | `dist` |
| `openmarket-admin` | Static Assets | `apps/admin` | `echo ready` | `dist` |
| `openmarket-partner` | Static Assets | `apps/partner` | `echo ready` | `dist` |
| `openmarket-api` | Cloudflare Worker | `apps/api` | `echo ready` | `src/index.js` |

## 2. 필수 환경 변수 및 시크릿 (Environment Variables & Secrets)
- `DATABASE_URL`: PostgreSQL 16 연결 문자열 (Cloudflare Hyperdrive 바인딩)
- `REDIS_URL`: Redis 7 클러스터 또는 Upstash Redis 연결 엔드포인트
- `JWT_SECRET`: HS256 / RS256 토큰 서명 비밀키
- `CLOUDFLARE_API_TOKEN`: CI/CD 자동 배포 권한 토큰 (Workers:Edit, Pages:Edit)

## 3. 로컬 및 CLI 배포 실행 명령어
```bash
# 루트 통합 콘솔 배포
npx wrangler deploy

# 콘솔별 개별 독립 배포
npm run deploy:storefront
npm run deploy:admin
npm run deploy:partner
npm run deploy:api
```
모든 프로젝트는 `wrangler.jsonc` 및 `wrangler.toml`의 유효성 검증을 통과하도록 구성되어 있습니다.

