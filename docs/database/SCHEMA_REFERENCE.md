# 데이터베이스 스키마 명세서 (SCHEMA_REFERENCE.md)

## 1. 데이터 타입 및 제약조건 설계 원칙
- **Primary Key**: 무작위 UUID v4 (`DEFAULT gen_random_uuid()`) 사용하여 분산 환경 충돌 방지
- **통화 금액**: 부동소수점 오차 방지를 위해 `BIGINT` 타입 강제 (최소값 0 CHECK 제약조건 포함)
- **일시 필드**: 타임존 일관성을 위해 `TIMESTAMPTZ` (`DEFAULT NOW()`) 사용
- **상태값**: 문자열 `VARCHAR`와 `CHECK (status IN (...))` 결합을 통한 도메인 무결성 보장

## 2. 주요 테이블 요약 명세

### A. 카탈로그 및 상품 (Catalog)
| 테이블명 | 주요 컬럼 | 제약조건 및 설명 |
|---|---|---|
| `categories` | `id, parent_id, name, slug, depth, sort_order` | 33개 코어 카테고리 계층형 택소노미 |
| `products` | `id, partner_id, category_id, title, status` | 상품 기본 정보 및 입점사 외래키 |
| `product_skus` | `id, product_id, sku_code, original_price, sale_price, stock_quantity` | 단품 SKU, 가격, 재고, 버전 낙관적 락 |
| `flash_sale_items` | `id, campaign_id, sku_id, flash_price, remaining_stock, per_user_limit` | 타임특가 할당 재고 및 1인 구매 제한 |

### B. 주문 및 물류 (Order & Logistics)
| 테이블명 | 주요 컬럼 | 제약조건 및 설명 |
|---|---|---|
| `orders` | `id, buyer_user_id, idempotency_key, total_pay_amount, payment_status` | 마스터 결제 주문 및 중복 방지 멱등키 |
| `sub_orders` | `id, order_id, partner_id, sub_total_amount, status, carrier_code, tracking_number` | 판매자별 분기 하위 주문, 상태머신 전이 |
| `order_items` | `id, sub_order_id, product_id, sku_id, unit_price, quantity, line_total_amount` | 주문 품목 스냅샷 정보 |
| `shipments` | `id, sub_order_id, carrier_id, tracking_number, status` | 택배사 배송 추적 데이터 |

### C. 복식부기 및 정산 (Accounting & Settlement)
| 테이블명 | 주요 컬럼 | 제약조건 및 설명 |
|---|---|---|
| `ledger_accounts` | `id, account_code, account_type, partner_id, balance` | PG채권, 에스크로, 정산부채, 플랫폼수익 계정 |
| `ledger_transactions` | `id, reference_type, reference_id, description` | 결제/정산 원장 트랜잭션 헤더 |
| `ledger_entries` | `id, transaction_id, account_id, direction, amount` | DEBIT(차변) / CREDIT(대변) 분개 명세 |
| `settlements` | `id, partner_id, gross_sales_amount, commission_amount, net_payout_amount` | 월별/기수별 파트너 정산 확정 데이터 |
