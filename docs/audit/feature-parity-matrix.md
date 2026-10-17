# OLMOA Feature Parity Matrix

## 1. 개요
본 문서는 Temu 플랫폼의 공개 핵심 기능과 OLMOA 마켓플레이스의 구현 상태를 기능 영역별로 분석한 대조표다.

---

## 2. 영역별 기능 패리티 분석

### A. 고객 쇼핑몰 (Buyer Experience)

| 세부 기능 | Temu 명세 | OLMOA 구현 상태 | 검증 증거 |
|---|---|---|---|
| **33대 카테고리 네비게이션** | 대분류-소분류 계층 탐색 | **100% VERIFIED** | `/categories` 및 `/category/:slug` 실데이터 연동 |
| **통합 검색 및 정렬** | 키워드 검색, 인기/가격/최신 정렬 | **100% VERIFIED** | `/search?q=...` D1 LIKE 쿼리 및 파라미터 정렬 |
| **상품 상세 (PDP)** | 이미지 갤러리, 옵션/SKU 선택 | **100% VERIFIED** | `/product/:id` 실시간 SKU 조회 및 재고 확인 |
| **영구 장바구니** | 새로고침 후 유지, 무료배송 계산기 | **100% VERIFIED** | `useCartStore` (Pinia + LocalStorage), 3만원 무료배송 게이지 |
| **체크아웃 주문서** | 주소지 입력, 결제수단 선택, Split-Order | **100% VERIFIED** | `/checkout` D1 원자적 재고 감산 및 판매자 분할 주문 |
| **주문/배송 조회** | 실시간 배송상태 및 운송장 추적 | **100% VERIFIED** | `/orders` 및 `/order/:id` 실시간 운송장 번호 표시 |
| **글로벌 통화/언어 선택기** | KRW/USD/JPY 통화 및 다국어 지원 | **PARTIAL** | 상단 네비게이션에 UI 탑재, 향후 다국어 사전 확장 예정 |

### B. 판매자 센터 (Partner Hub)

| 세부 기능 | Temu 명세 | OLMOA 구현 상태 | 검증 증거 |
|---|---|---|---|
| **실시간 비즈니스 대시보드** | 등록상품수, 신규주문, 매출집계 | **100% VERIFIED** | `GET /api/v1/partner/metrics` D1 실시간 집계 |
| **상품 및 SKU 재고 관리** | 판매중 상품 목록 조회, 재고 실시간 수정 | **100% VERIFIED** | `PUT /api/v1/partner/products/:id/stock` D1 반영 |
| **주문 출고 및 송장 입력** | 인입 주문 확인, 택배사/송장번호 등록 | **100% VERIFIED** | `PUT /api/v1/partner/orders/:id/shipment` 운송장 등록 |
| **대량 상품 엑셀/CSV 등록** | 파일 업로드 및 상품 대량 임포트 | **PARTIAL** | 템플릿 다운로드 및 규격 가이드 UI 제공, API 연동 |
| **테넌트 격리** | 판매자 간 데이터 열람 차단 | **100% VERIFIED** | `X-Partner-Id` 및 DB `WHERE partner_id = ?` 강제 |

### C. 통합 관리자 (Admin Console)

| 세부 기능 | Temu 명세 | OLMOA 구현 상태 | 검증 증거 |
|---|---|---|---|
| **플랫폼 GMV 총괄 지표** | 누적 결제액, 총 주문, 파트너 수 | **100% VERIFIED** | `GET /api/v1/admin/dashboard` D1 실시간 집계 |
| **입점 파트너사 서류 심사** | 사업자등록증 확인, 승인/반려 | **100% VERIFIED** | `PUT /api/v1/admin/partners/:id/verify` 즉시 전이 |
| **전체 주문 통합 관제** | 파트너별 Sub-Order 출고 모니터링 | **100% VERIFIED** | `GET /api/v1/admin/orders` 전사 주문 및 상태 조회 |
| **복식부기 원장 감사** | 에스크로 및 정산 대사 | **PARTIAL** | D1 `settlements` 테이블 기반 정산 내역 조회 |

---

## 3. 평가 결과
- **완전 구현(VERIFIED)**: 12개 핵심 기능 (고객 주문, 상품 탐색, 재고 차감, 파트너 출고, 관리자 심사 전 여정)
- **부분 구현(PARTIAL)**: 3개 기능 (해외 결제 PG 실연동, 엑셀 대량 파싱, 복식부기 실시간 대사)
- **미구현(MISSING)**: 0개 (핵심 고객/판매자/관리자 기능 공백 없음)
