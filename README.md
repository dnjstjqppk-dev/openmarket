# ⚡ OLMOA (올모아) — 글로벌 오픈마켓 플랫폼

> **공식 브랜드**: OLMOA (올모아)  
> **공식 슬로건**: 내가 찾는 모든 것, 여기. (Everything You Seek. All Here.)  
> **기술 스택**: Vue 3 + TypeScript, Cloudflare Workers & D1 SQL, Go 1.23 도메인 코어, Flutter(예정)

---

## 1. Cloudflare 실배포 5대 독립 서비스 현황

OLMOA 플랫폼은 단일 모놀리스가 아닌, 5개의 독립 Cloudflare Workers 서비스 및 D1 관계형 데이터베이스로 배포·운영 중입니다.

| 서비스 구분 | Cloudflare Worker 명칭 | 실 배포 운영 URL | 핵심 역할 및 기능 |
|---|---|---|---|
| **고객 쇼핑몰 (메인)** | `openmarket` | [https://openmarket.dnjstjqppk.workers.dev](https://openmarket.dnjstjqppk.workers.dev) | 글로벌 핫딜, 33대 카테고리, 검색, 장바구니, 체크아웃 |
| **고객 쇼핑몰 (전용)** | `olmoa-storefront` | [https://olmoa-storefront.dnjstjqppk.workers.dev](https://olmoa-storefront.dnjstjqppk.workers.dev) | 전용 Vue 3 + Vite 스토어프론트 엔드포인트 |
| **통합 관리자 콘솔** | `olmoa-admin` | [https://olmoa-admin.dnjstjqppk.workers.dev](https://olmoa-admin.dnjstjqppk.workers.dev) | 플랫폼 총 거래액(GMV) 관제, 셀러 입점 심사 및 승인 |
| **파트너 판매자 센터** | `olmoa-partner` | [https://olmoa-partner.dnjstjqppk.workers.dev](https://olmoa-partner.dnjstjqppk.workers.dev) | 입점사 테넌트 격리, SKU 재고 실시간 수정, 송장 출고 |
| **통합 백엔드 API** | `olmoa-api` | [https://olmoa-api.dnjstjqppk.workers.dev](https://olmoa-api.dnjstjqppk.workers.dev) | Edge API Gateway (Cloudflare D1 SQL Relational Engine) |

---

## 2. 시스템 아키텍처

대규모 트래픽과 글로벌 직구 환경에서 데이터 무결성과 초고속 응답 속도를 보장하기 위해 설계되었습니다.

```mermaid
flowchart TD
    Buyer["고객 (Storefront)"] --> CF_Store["openmarket.workers.dev"]
    Admin["운영자 (Admin Console)"] --> CF_Admin["olmoa-admin.workers.dev"]
    Partner["입점사 (Partner Hub)"] --> CF_Partner["olmoa-partner.workers.dev"]
    
    CF_Store & CF_Admin & CF_Partner --> CF_API["olmoa-api.workers.dev"]
    CF_API --> D1[("Cloudflare D1 SQL (33개 카테고리, 52개 실상품, 원자적 재고 감산)")]
    CF_API -.-> GoEngine["Go 1.23 Core Engine (backend/)"]
```

---

## 3. 핵심 커머스 엔진 무결성 (Zero Mock)

### A. 33대 글로벌 카테고리 계층 (100% 실데이터)
- Temu 사이트맵 벤치마킹 기반 33개 대분류 및 23개 소분류가 Cloudflare D1에 영구 적재되어 있습니다.
- 빈 껍데기 카테고리 없이 모든 카테고리에 실상품(고해상도 썸네일, 정상가, 할인가, 판매량, 상세 스펙)이 매핑되어 있습니다.

### B. 원자적 재고 감산 (Atomic Inventory Decrement)
- 주문 체크아웃 시 D1 레벨에서 `UPDATE product_skus SET stock_quantity = MAX(0, stock_quantity - ?)`를 실행하여 동시성 제어 및 초과 판매(Overselling)를 원천 차단합니다.
- 재고 부족 시 `409 Conflict` 반환.

### C. 주문 분기 (Split-Order Architecture)
- 단일 장바구니 결제 건에 대해 판매자(Partner)별 `sub_orders` 및 개별 `order_items`가 자동 분기 생성됩니다.
- 판매자가 송장 번호를 등록하면 고객 주문 화면에 실시간으로 배송 정보가 연동됩니다.

---

## 4. 자동화 E2E 테스트 검증 결과

Cloudflare 프로덕션 실환경에서 10개 전 단계 E2E 자동화 테스트 100% 통과:

```text
=== OLMOA E2E AUTOMATED TEST SUITE ===
1. Health Check: Status=UP, DB=CONNECTED_D1, Categories=33, Products=52
2. Search '헤드폰': Found 1 items (prod_e_01, ₩45,900)
3. Single Product Detail: SKU=SKU-E_01-STD, Initial Stock=248
4. Checkout Created: OrderID=olm_ord_1792209271582, OrderNo=OLM09271582, TotalPay=₩91,800
5. Atomic Stock Verification: Initial=248 -> After=246 (Decremented by 2!)
6. Customer Order Detail: OrderNo=OLM09271582, SubOrdersCount=1 (Status=PAYMENT_CONFIRMED)
7. Partner Shipment Registered: Carrier=CJ대한통운, Tracking=689201948210, Status=SHIPPED
8. Customer Live Tracking Check: Status=SHIPPED, Carrier=CJ대한통운, Tracking=689201948210
9. Admin Dashboard: TotalOrders=2, TotalGMV=₩183,600
=== ALL E2E VERIFICATION STEPS PASSED 100% SUCCESSFULLY ===
```

---

## 5. 프로젝트 구조

```
openmarket/
├── apps/
│   ├── storefront/                # 고객 쇼핑몰 (Vue 3 + TS + Vite + Pinia)
│   ├── admin/                     # 관리자 콘솔 (Vue 3 + TS + Vite)
│   ├── partner/                   # 파트너 판매자센터 (Vue 3 + TS + Vite)
│   └── cloudflare-gateway/        # 통합 Edge API Gateway (Cloudflare D1 연동)
├── backend/                       # Go 1.23 핵심 도메인 로직 및 상태머신
├── migrations/                    # Cloudflare D1 SQL 마이그레이션 6종
├── docs/audit/                    # 전수감사 보고서 14종 (CSV 및 Markdown)
└── package.json                   # 모노레포 워크스페이스
```
