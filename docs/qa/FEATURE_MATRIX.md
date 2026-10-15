# 기능 명세 및 구현 매트릭스 (FEATURE_MATRIX.md)

## 1. 기능별 구현율 및 상태 매트릭스

| 도메인 | 요구 기능 | 구현 상세 | 상태 |
|---|---|---|---|
| **카탈로그** | 33대 글로벌 카테고리 | PostgreSQL 16 seed migration 구현 완료 | PASS |
| **카탈로그** | 상품 및 SKU 다중 옵션 | 옵션 조합 JSONB, BIGINT 가격, 재고 관리 | PASS |
| **특가 프로모션** | 타임세일 (Flash Sale) | 실시간 카운트다운 타이머, Redis 동시성 연동 | PASS |
| **장바구니** | Split-Order 다중 판매자 | 입점사별 배송비 및 무료배송 기준 자동 계산 | PASS |
| **주문/결제** | 원자적 주문 분기 | Master Order 1건 -> N개 Sub-Order 생성 | PASS |
| **주문/결제** | 멱등성 보장 | UUID 기반 Idempotency Key 중복 청구 차단 | PASS |
| **배송/물류** | 서브오더 상태머신 | PAYMENT_PENDING -> PAID -> PREPARING -> SHIPPED | PASS |
| **회계/원장** | 복식부기 에스크로 원장 | 차변(PG채권) = 대변(에스크로) 절대 일치 | PASS |
| **정산** | 파트너 정산서 | 매출, 10% 수수료 자동 공제, Net Payout 계산 | PASS |
| **파트너** | CSV 대량 상품 업로드 | 컬럼 유효성 검사 및 100건 일괄 등록 시뮬레이션 | PASS |
| **관리자** | 파트너사 심사 승인 | PENDING -> APPROVED 상태 변경 및 감사로그 | PASS |
| **관리자** | SDUI 레이아웃 엔진 | 클라이언트 무배포 실시간 홈 피드 블록 제어 | PASS |
| **인프라** | Cloudflare Edge 배포 | 4개 프로젝트 Wrangler 배포 검증 완료 | PASS |
| **CI/CD** | GitHub Actions 자동 배포 | push 시 Go 테스트 및 Wrangler 빌드 자동화 | PASS |

## 2. 외부 의존성 관련 운영 상태 판정
- **실 결제 PG 승인**: 공식 샌드박스 및 주문 분기 아키텍처 구현 완료 (`BLOCKED` - 실 PG사 가맹 계약 및 상점 키 발급 필요)
- **택배사 API 자동 연계**: 운송장 입력 및 상태머신 전이 구현 완료 (`BLOCKED` - CJ/한진/우체국 기업 물류 API 계약 필요)
