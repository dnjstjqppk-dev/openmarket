# 라우트 인벤토리 명세서 (ROUTE_INVENTORY.md)

## 1. Customer Storefront 라우트 목록
| 경로 (Route) | 뷰 및 컴포넌트 | 연동 API | 상태 |
|---|---|---|---|
| `/` | 메인 홈, 타임특가, 33대 카테고리 바 | `GET /api/v1/home/sdui` | PASS |
| `/categories/:slug` | 카테고리별 상품 탐색 리스트 | `GET /api/v1/products?category=` | PASS |
| `/products/:id` | 상품 상세, 옵션/SKU 선택, 즉시구매 | `GET /api/v1/products/{id}` | PASS |
| `/cart` | 장바구니, 입점사별 배송비 그룹화 | `GET /api/v1/cart` | PASS |
| `/checkout` | Split-Order 결제서 및 주소 입력 | `POST /api/v1/orders/checkout` | PASS |
| `/mypage/orders` | 주문 내역, 배송 상태 타임라인 | `GET /api/v1/orders` | PASS |

## 2. Admin Console 라우트 목록
| 경로 (Route) | 뷰 및 컴포넌트 | 연동 API | 상태 |
|---|---|---|---|
| `/admin` | 통합 운영 총괄 대시보드 | `GET /api/v1/admin/dashboard` | PASS |
| `/admin/partners` | 입점 파트너사 서류 심사 및 승인 | `POST /api/v1/admin/partners/{id}/verify` | PASS |
| `/admin/ledger` | 복식부기 에스크로 원장 대사 | `GET /api/v1/admin/ledger` | PASS |
| `/admin/sdui` | SDUI 레이아웃 JSON 에디터 | `POST /api/v1/admin/sdui/layouts` | PASS |

## 3. Partner Console 라우트 목록
| 경로 (Route) | 뷰 및 컴포넌트 | 연동 API | 상태 |
|---|---|---|---|
| `/partner` | 파트너사 운영 현황 요약 | `GET /api/v1/partner/dashboard` | PASS |
| `/partner/products` | 상품/SKU 등록 및 가격/재고 수정 | `POST /api/v1/partner/products` | PASS |
| `/partner/bulk-import` | CSV/Excel 대량 상품 임포트 | `POST /api/v1/partner/products/bulk` | PASS |
| `/partner/orders` | 발주 확인 및 운송장 입력 상태머신 | `PATCH /api/v1/partner/sub-orders/{id}/shipment`| PASS |
| `/partner/settlements` | 월별 매출/수수료 정산 내역서 | `GET /api/v1/partner/settlements` | PASS |

