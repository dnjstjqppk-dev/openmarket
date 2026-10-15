# 보안 및 권한 격리 전수 점검 보고서 (SECURITY_REPORT.md)

## 1. 보안 공격 벡터별 방어 검증

| 공격 유형 | 방어 메커니즘 | 검증 내용 | 판정 |
|---|---|---|---|
| **SQL Injection** | 파라미터화 쿼리 (Prepared Statements) 강제 | 입력값에 `' OR '1'='1` 주입 시 구문 에러 없이 이스케이프 처리 | **PASS** |
| **XSS (Cross-Site Scripting)** | 템플릿 엔진 자동 인코딩 및 CSP 헤더 | `<script>alert(1)</script>` 상품명 등록 시 텍스트 렌더링 | **PASS** |
| **CSRF** | SameSite 쿠키 및 커스텀 헤더 검증 | 브라우저 외부 비인가 도메인 요청 차단 | **PASS** |
| **타 파트너 데이터 탈취 (BOLA/IDOR)** | 서버 측 Tenant ID 강제 주입 | 파트너A 토큰으로 파트너B 주문 조회 시 `403 Forbidden` 차단 | **PASS** |
| **재고 초과 판매 (Race Condition)** | Redis Single-Thread Lua Script 원자성 | 동시 100건 요청 시 정확히 재고 수량만큼만 승인 | **PASS** |
| **이중 결제 (Double Spending)** | 멱등키 (UUID) UNIQUE 제약 | 동일 키 재요청 시 기처리된 주문 결과 캐시 반환 | **PASS** |

## 2. 관리자 감사 추적 및 PII 보호
- 주민등록번호, 계좌번호 등 민감 개인정보는 마스킹 처리되어 UI에 노출.
- 비밀번호는 복호화 불가능한 단방향 해시로만 저장되며, 복호화 불가 검증 완료.

