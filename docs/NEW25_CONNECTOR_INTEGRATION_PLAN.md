# NEW-25 커넥터 실연동 계획 (Wave I) — PO 범위 확정 2026-11-13

## 1. 결정 기록

- NEW-25 실연동 범위: **19종 전부** (국내 마켓 6 · 해외 마켓 8 · B2B 소싱 4 · 3PL 1).
- 제외 없음. 계약 결과 나오는 대로 아래 페이즈 순서로 Wave I 진입.
- 본 문서는 계약 없이 확정할 수 있는 출발선·체크리스트·진입기준까지다. 실제 API 호출 구현은 계약 후.

## 2. 출발선 (코드 근거)

- 레지스트리 19종: `connector-registry.js` (전문화 8 + 일반 11). 전원 `isLive=false`.
- 시드 18행: `migrations/d1_29_…sql` `commerce_platforms` (auth_type·api_docs_url 포함).
  3PL은 `fulfillment_providers` 8행(추적 URL만, API 없음).
- 운영 차단: `simulation.js` — 스텁은 운영에서 501 `CONNECTOR_NOT_INTEGRATED`, DB 기록 없음.
- 출발선 핀: `tests/multichannel_e2e_test.mjs` 8번 (registry 19·시드 18·`api_integrated` 전수 false).
  `isLive` 전환은 계약 이벤트이며 핀을 의도적으로 갱신해야 한다.

## 3. 페이즈

| 페이즈 | 대상 | 근거 |
|---|---|---|
| I-1 | 국내 전문화 3사 (네이버·쿠팡·11번가) | 검증·페이로드 코드 존재, 거짓 기본값 제거済 (NEW-04) |
| I-2 | 국내 일반 3사 (G마켓/옥션·롯데온·SSG) | 일반 커넥터, 스펙 확인 후 구현 |
| I-3 | 해외 8사 (Amazon·eBay·AliExpress·Temu·Shopee·Lazada·Walmart·TikTok) | Amazon만 전문화, 나머지 일반 |
| I-4 | B2B 4사 + 3PL 8택배사 | B2B 3사 전문화(도매꾹 베이스 URL 주의), 3PL은 택배사별 API 계약 (OPS-03) |

## 4. 플랫폼별 체크리스트 (코드·시드 근거만 기재, 미확인 TBD)

### 4.1 국내 마켓

| ID | 인증 (시드) | 키 필드 (코드) | 문서 (시드) | 계약 |
|---|---|---|---|---|
| naver_smartstore | OAUTH2 | clientId + clientSecret (`naver-connector.js:18-19`) | api.commerce.naver.com/docs | 스마트스토어 판매자 + 커머스 API 앱 승인 |
| coupang_wing | HMAC_SHA256 | accessKey + secretKey + vendorId (`coupang-connector.js:43-45`) | developers.coupang.com | 입점 + Wing OpenAPI 키 발급 |
| eleven_street | API_KEY_SECRET | openApiKey (`eleven-street-connector.js:17`) | openapi.11st.co.kr | 입점 + OpenAPI 인증키 |
| gmarket_auction | TOKEN_HEADER | TBD (일반 커넥터) | api.esmplus.com | ESM 입점 + API 사용 승인 |
| lotte_on | API_KEY_SECRET | TBD (일반 커넥터) | openapi.lotteon.com | 입점 + OpenAPI 승인 |
| ssg_com | API_KEY_SECRET | TBD (일반 커넥터) | po.ssgadm.com | 입점 + 파트너 API 승인 |

### 4.2 해외 마켓

| ID | 인증 (시드) | 키 필드 (코드) | 문서 (시드) | 계약 |
|---|---|---|---|---|
| amazon_sp_api | OAUTH2 | lwaClientId + lwaClientSecret + refreshToken (`amazon-sp-connector.js:19-21`, NA·US 기준) | developer-docs.amazon.com/sp-api | Seller Central + SP-API 앱 승인·마켓 선택 |
| ebay_rest | OAUTH2 | TBD (일반 커넥터) | developer.ebay.com/api-docs | 개발자 계정 + 앱 키 |
| aliexpress_open | HMAC_SHA256 | TBD (일반 커넥터) | open.aliexpress.com | 셀러 + 오픈플랫폼 앱 |
| temu_partner | OAUTH2 | TBD (일반 커넥터) | partner.temu.com | 파트너 입점 + API 승인 |
| shopee_v2 | HMAC_SHA256 | TBD (일반 커넥터) | open.shopee.com | 셀러 + 오픈플랫폼 앱 |
| lazada_open | HMAC_SHA256 | TBD (일반 커넥터) | open.lazada.com | 셀러 + 오픈플랫폼 앱 |
| walmart_marketplace | TOKEN_HEADER | TBD (일반 커넥터) | developer.walmart.com | 마켓플레이스 입점 + API 키 |
| tiktok_shop | HMAC_SHA256 | TBD (일반 커넥터) | partner.tiktokshop.com | 샵 입점 + 파트너 앱 승인 |

### 4.3 B2B 소싱 + 3PL

| ID | 인증 (시드) | 키 필드 (코드) | 문서 (시드) | 계약 |
|---|---|---|---|---|
| domeggook_domeme | API_KEY_SECRET | apiKey + memberId (`domestic-b2b-connector.js:18`) | domeggook.com/main/api | 도매꾹/도매매 회원 + API 사용 |
| onchannel_b2b | API_KEY_SECRET | apiKey + memberId (동일 클래스, 베이스 URL은 도매꾹 — 실연동 시 교체) | onchannel.co.kr/b2b | 온채널 제휴 + API |
| ownerclan_b2b | API_KEY_SECRET | apiKey + memberId (동일 클래스, 베이스 URL은 도매꾹 — 실연동 시 교체) | ownerclan.com/v2/b2b_api | 오너클랜 제휴 + API |
| alibaba_1688 | OAUTH2 | TBD (일반 커넥터) | open.1688.com | 1688 회원 + 오픈플랫폼 앱 |
| 3pl_logistics | 없음 (추적 URL만) | 택배사별 TBD | — | 택배사별 추적 API 계약 (OPS-03): CJ·한진·롯데·우체국·DHL·FedEx·UPS·SF |

## 5. 플랫폼별 진입기준 (Wave I, 공통 5단계)

1. 판매·제휴 계약 + API 사용 승인 (외부).
2. 샌드박스 키 발급 → `/channels/credentials` 등록 (저장은 sealed 済).
3. 실제 호출 구현 + `isLive=true` 전환 (해당 커넥터만).
4. 검증 테스트: 자격검증 + 샌드박스 라운드트립 (리스팅·수집 중 해당분) + 출발선 핀 갱신.
5. 운영 컷오버: 운영 키 교체, 첫 실주문 모니터링, 롤백 (키 무효화 + `isLive` 원복) 확인.

## 6. 비목표

- 계약 전 실제 외부 호출 없음. 시뮬레이션 응답에 `simulated:true` 유지.
- TBD 셀은 스펙 확인 없이 채우지 않는다 (추측 기재 금지).
- 자격증명 저장 구조 변경 없음 (`platform_credentials` sealed 済).

## 7. 수용기준과 증거

- AC-NEW25-1 범위 확정: 본 문서 §1 (2026-11-13 사용자 결정).
- AC-NEW25-2 체크리스트: §4 (전 셀 코드·시드 근거 또는 TBD).
- AC-NEW25-3 출발선 핀: `test:multichannel` 8/8 (8번 신규).
- AC-NEW25-4 핀 실효: 레드드릴 — `isLive` 변조 시 3/8 적색 (8번 실패 확인) →
  sha256 `033B…FA2FF` 일치 원복 → 8/8 녹색.
- feature_delivery 검증기 게이트: 패키지에 스크립트 없음 (전 세션과 동일) → deferred.
  fail-first 대신 출발선 핀 + 레드드릴 + 실 스위트로 대체.
