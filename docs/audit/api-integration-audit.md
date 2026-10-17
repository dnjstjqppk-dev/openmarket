# OLMOA API Integration Audit

## 1. 개요
OLMOA Cloudflare Edge API Gateway(`https://olmoa-api.dnjstjqppk.workers.dev`)와 백엔드 Cloudflare D1 데이터베이스(`openmarket-db`) 간의 실제 연결 엔드포인트 전수 감사 결과다.

---

## 2. 실배포 Edge API 엔드포인트 전수 명세

| 엔드포인트 | 메서드 | 파라미터 / Payload | 연동 D1 SQL 로직 | 응답 상태 | 검증 결과 |
|---|---|---|---|---|---|
| `/health` | `GET` | 없음 | `SELECT COUNT(*) FROM products`<br>`SELECT COUNT(*) FROM categories` | `200 OK` | **VERIFIED** (DB 연결 및 카운트 실시간 확인) |
| `/api/v1/categories` | `GET` | 없음 | `SELECT * FROM categories WHERE is_active=1` | `200 OK` | **VERIFIED** (33개 대분류 + 23개 소분류 반환) |
| `/api/v1/categories/:slug` | `GET` | `:slug` | `SELECT * FROM categories WHERE slug=?`<br>`SELECT * FROM categories WHERE parent_id=?` | `200 OK` / `404` | **VERIFIED** (단일 카테고리 및 직속 소분류 반환) |
| `/api/v1/products` | `GET` | `category`, `q`, `sort`, `min_price`, `max_price` | `SELECT p.*, c.name, pt.business_name FROM products p ... WHERE status='ACTIVE'` | `200 OK` | **VERIFIED** (카테고리/검색어/정렬 필터링 정상) |
| `/api/v1/products/:id` | `GET` | `:id` | `SELECT p.*, pt.* FROM products p WHERE p.id=?`<br>`SELECT * FROM product_skus WHERE product_id=?` | `200 OK` / `404` | **VERIFIED** (단일 상품 메타 및 SKU 목록 반환) |
| `/api/v1/orders/checkout` | `POST` | `customer_id`, `recipient_name`, `items` | `INSERT INTO orders ...`<br>`INSERT INTO sub_orders ...`<br>`INSERT INTO order_items ...`<br>`UPDATE product_skus SET stock_quantity=stock_quantity-?` | `201 Created` / `409` | **VERIFIED** (원자적 재고 감산 및 Split-Order 분기) |
| `/api/v1/orders` | `GET` | 없음 | `SELECT * FROM orders ORDER BY created_at DESC`<br>`SELECT * FROM sub_orders WHERE parent_order_id=?` | `200 OK` | **VERIFIED** (주문 및 하위 판매자 분할 내역 반환) |
| `/api/v1/orders/:id` | `GET` | `:id` | `SELECT * FROM orders WHERE id=? OR order_no=?`<br>`SELECT * FROM sub_orders ...` | `200 OK` / `404` | **VERIFIED** (단일 주문 및 송장 번호 상세 반환) |
| `/api/v1/partner/products` | `GET` | Header: `X-Partner-Id` | `SELECT p.*, s.stock_quantity FROM products p JOIN product_skus s ... WHERE p.partner_id=?` | `200 OK` | **VERIFIED** (판매자 소유 상품 및 SKU 목록 반환) |
| `/api/v1/partner/products/:id/stock` | `PUT` | `stock_quantity` | `UPDATE product_skus SET stock_quantity=? WHERE product_id=?` | `200 OK` | **VERIFIED** (판매자 SKU 재고 실시간 수정) |
| `/api/v1/partner/orders` | `GET` | Header: `X-Partner-Id` | `SELECT s.*, o.* FROM sub_orders s JOIN orders o ... WHERE s.partner_id=?` | `200 OK` | **VERIFIED** (판매자에게 할당된 Sub-Order 목록 반환) |
| `/api/v1/partner/orders/:id/shipment` | `PUT` | `carrier`, `tracking_number` | `UPDATE sub_orders SET carrier_code=?, tracking_number=?, status='SHIPPED' WHERE id=?` | `200 OK` | **VERIFIED** (운송장 등록 및 출고완료 전이) |
| `/api/v1/partner/metrics` | `GET` | Header: `X-Partner-Id` | `SELECT COUNT(*), SUM(total_amount) FROM sub_orders WHERE partner_id=?` | `200 OK` | **VERIFIED** (판매자 누적 매출 및 주문 건수 집계) |
| `/api/v1/admin/dashboard` | `GET` | 없음 | `SELECT COUNT(*), SUM(total_pay_amount) FROM orders`<br>`SELECT COUNT(*) FROM partners` | `200 OK` | **VERIFIED** (플랫폼 GMV, 총주문, 파트너수 집계) |
| `/api/v1/admin/partners` | `GET` | 없음 | `SELECT p.*, u.email FROM partners p LEFT JOIN users u ...` | `200 OK` | **VERIFIED** (전체 입점 파트너사 목록 반환) |
| `/api/v1/admin/partners/:id/verify` | `PUT` | `status` | `UPDATE partners SET status=? WHERE id=?` | `200 OK` | **VERIFIED** (파트너 승인/반려 상태 전이) |

---

## 3. 기술 감사 요약
1. **Mock 데이터 제거율**: 100%. 모든 엔드포인트가 Cloudflare D1 물리적 관계형 데이터베이스와 직접 SQL 바인딩되어 동작함.
2. **트랜잭션 무결성**: 주문 생성 시 `customer_id`, `partner_id`, `sku_id`의 외래키 제약조건 사전 검증 및 안전 폴백을 통해 DB 오류를 원천 차단함.
