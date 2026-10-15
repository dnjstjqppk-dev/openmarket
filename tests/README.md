# OpenMarket 통합 테스트 스위트 (Tests Suite)

## 1. 테스트 디렉터리 구성
- `tests/unit/`: 단위 도메인 로직 및 상태머신 전이 테스트
- `tests/integration/`: Split-Order 주문 분기 및 복식부기 원장 통합 테스트
- `tests/security/`: 멀티테넌트 격리 및 멱등키 중복 결제 방어 테스트
- `tests/performance/`: Redis 7 Lua 동시성 재고 감산 벤치마크 테스트

## 2. 테스트 실행 명령어
```bash
# 전체 백엔드 및 통합 테스트 실행
npm test
# 또는
cd backend && go test -v ./...
```
모든 테스트는 모의(Mock) 객체가 아닌 실제 비즈니스 로직과 수학적 화폐 계산(`BIGINT`)을 직접 검증합니다.
