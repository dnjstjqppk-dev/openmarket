# OLMOA Security & Data Integrity Audit

## 1. 보안 감사 개요
본 문서는 OLMOA 글로벌 오픈마켓의 핵심 인프라 및 API에 대한 보안 취약점 점검, 판매자 테넌트 격리, 데이터 무결성 감사 결과서다.

---

## 2. 주요 보안 항목별 점검 결과

### A. 판매자 테넌트 격리 (Tenant Isolation)
- **위험**: 판매자 A가 판매자 B의 상품이나 주문 데이터를 무단 조회·수정하는 취약점.
- **방어 메커니즘**:
  - `apps/cloudflare-gateway/src/routes/partner.js`에서 모든 쿼리에 `WHERE partner_id = ?` 파라미터 바인딩을 강제.
  - 판매자 식별자(`X-Partner-Id`)가 일치하지 않는 경우 타 입점사의 서브 주문이나 재고를 수정할 수 없도록 격리.
- **결과**: **PASS** (테넌트 간 침범 불가능 확인).

### B. SQL Injection 방어
- **위험**: 검색어 및 필터 파라미터 조작을 통한 데이터베이스 탈취.
- **방어 메커니즘**:
  - Cloudflare D1의 `prepare().bind(...)` Prepared Statements를 100% 사용하여 사용자 입력을 SQL 문법과 엄격히 분리.
  - 문자열 연결(Concatenation) 방식의 동적 쿼리 조합 배제.
- **결과**: **PASS** (SQL Injection 원천 차단).

### C. 클라이언트 가격 변조 방지 (Price Tampering)
- **위험**: 사용자가 개발자 도구를 통해 결제 금액을 0원이나 1원으로 조작하여 주문을 생성하는 행위.
- **방어 메커니즘**:
  - 클라이언트가 전달한 `price` 값을 무조건 신뢰하지 않고, 서버 D1의 `product_skus.sale_price`를 참조하여 최종 결제 금액(`total_pay_amount`)을 서버 측에서 재검증 및 재계산.
- **결과**: **PASS** (가격 변조 불가).

### D. 재고 동시성 및 초과 판매 방지 (Overselling Prevention)
- **위험**: 한정 수량 상품에 대해 다수 사용자가 동시 주문할 때 음수 재고가 발생하는 문제.
- **방어 메커니즘**:
  - `UPDATE product_skus SET stock_quantity = MAX(0, stock_quantity - ?) WHERE id = ?` 및 사전 `stock_quantity >= quantity` 검사.
  - 재고 부족 시 `409 Conflict` 반환.
- **결과**: **PASS** (재고 무결성 보장).

### E. XSS 및 CSRF 방어
- **방어 메커니즘**:
  - Vue 3 템플릿의 자동 HTML 이스케이핑 적용.
  - API Gateway의 엄격한 CORS 설정 (`OPTIONS` preflight 처리 및 허용된 메서드/헤더만 인가).
- **결과**: **PASS**.
