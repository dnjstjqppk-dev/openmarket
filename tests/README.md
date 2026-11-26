# OpenMarket 테스트 스위트

Node 기반 회귀 스위트. 모의(Mock) 객체 없이 실제 게이트웨이(`apps/cloudflare-gateway/src/index.js`)와
인메모리 D1(node:sqlite, FK ON)을 `tests/lib/harness.mjs`로 구동해 검증합니다.

## 디렉터리 구성

- `tests/*.mjs`: 게이트웨이 API·도메인 스위트 (쿠폰, 정산, 보안, 여정, SEO 등)
- `tests/ui/*.test.mjs`: 프론트 소스 정적 계약 + 동작 테스트 (C-N01 스타일: 소스 직접 import 가능)
- `tests/browser/`: 실브라우저 e2e·LCP·카테고리 떨림 프로브 (CDP + vite preview + 로컬 API 필요)
- `tests/security/`: 익스플로잇 베이스라인 (`npm run test:exploits`)
- `tests/runtime/`: workerd 실구동 스모크 (`npm run test:runtime`)
- `tests/audit/`: 감사 보조 스크립트
- `tests/lib/harness.mjs`: 인메모리 D1 + Worker 호출 + 러너 (`createGateway`, `createRunner`)

## 실행 명령어

```sh
node scripts/gen-dev-seed.mjs   # 최초 1회: dev 시드 생성 (npm test가 자동 선행)
npm test                        # 전체 체인 (루트 package.json test 스크립트)
npm run test:ui                 # UI 계약 스위트만
node tests/<suite>.mjs          # 단일 스위트 직접 실행
```

요구사항: Node 22+ (`node:sqlite` 사용). 브라우저 스위트와 런타임 스모크는
살아있는 8787 로컬 API(브라우저는 Chrome CDP까지)가 필요해 기본 `npm test`
체인에 포함되지 않습니다 (LCP는 CI lcp-budget 잡에서 별도 실행).
