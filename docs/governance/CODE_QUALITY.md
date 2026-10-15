# 코드 품질 및 정적 분석 기준서 (CODE_QUALITY.md)

## 1. 정적 분석 및 린트 가이드라인
- **Go 코드 품질**:
  - `golangci-lint` 기본 린터(govet, errcheck, staticcheck, ineffassign) 0 경고 준수.
  - 에러 처리 시 에러를 무시(`_ = err`)하지 않고 명시적으로 래핑(`fmt.Errorf("%w", err)`)하거나 반환.
- **SQL DDL 품질**:
  - 모든 테이블은 명시적인 Primary Key 및 Foreign Key 제약 명시.
  - 삭제 정책: 중요한 금융/원장/주문 데이터는 `ON DELETE RESTRICT`를 사용하여 임의 삭제 차단.
- **프론트엔드/자바스크립트 품질**:
  - 일관된 코드 포맷팅 (Prettier / ESLint) 적용.
  - 시맨틱 HTML5 태그(`header`, `nav`, `main`, `section`) 및 접근성 속성 준수.

## 2. 코드 리뷰 및 품질 게이트
1. PR 머지 전 반드시 GitHub Actions CI 통과 필수.
2. 단위 테스트 커버리지 최소 80% 이상 유지.
3. 데이터베이스 스키마 변경 시 반드시 롤백 시나리오 첨부.
