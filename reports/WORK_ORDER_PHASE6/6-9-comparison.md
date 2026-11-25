# 6-9 리허설 전후 비교표

- 일시: 2026-11-25 12:16Z / 원격 0건(로컬 스택 2개)
- 전(베이스): API http://127.0.0.1:8788 + 스토어프론트 http://127.0.0.1:4283 (커밋 89bbf03 빌드)
- 후(작업): API http://127.0.0.1:8787 + 스토어프론트 http://127.0.0.1:4183 (`work-order/phase6` 미커밋 빌드)
- 표본: 전 상품 `prod_001` / 분류 `womens-clothing`, 후 상품 `prod_001` / 분류 `womens-clothing` (각 스택 실측 첫 건)
- 클라이언트 렌더 헤드(제목·robots·canonical)는 단위 테스트 영역이라 본 표에서 제외

| 확인 | 전(89bbf03) | 후(phase6) |
|---|---|---|
| /health | 200 schema=d1_74_seo_crawl.sql | 200 schema=d1_77_user_locale.sql |
| 6-1 크롤 brief 바이트 동일 | 크롤 미제공(404) | 바이트 동일 O |
| 6-1 크롤 404 | 404 O | 404 O |
| 6-4 key_facts_html | 크롤 미제공 | 있음 O |
| 6-5 /llms.txt | 200 3.2KB | 200 5.9KB 정책O 문서링크O |
| 6-5 /llms-full.txt | 200 9.6KB | 200 15.8KB 전문O 요약O |
| 6-5 /llms/product/:id.md | 404 | 200 0.6KB 가격일치 O |
| 6-5 /llms/category/:slug.md | 404 | 200 |
| 6-6 /robots.txt | 0/3 묶음 신호X | 3/3 묶음 신호O 학습허용O |
| 6-7 /<key>.txt (키 없음) | 404 (키 없음, 정상) | 404 (키 없음, 정상) |
| 사이트맵 색인 | 200 항목 3개 | 200 항목 3개 |
| 6-8 셸 로케일 | 200 langO x-d 마케팅문구X | 200 langO ko-KR x-d |
| 6-8 셸 설명 3종 | twitter상이 | 3종동일 O |
| 6-2 /en · /ja | 200 · 200 (폴백 셸) | 200 · 200 (미러 라우트, 단위핀 H05·H06) |
| 6-8 /search | 200 (폴백 셸) | 200 (폴백 셸) |

로컬 apex 합성 안내: vite preview는 정적 셸만 내주므로 크롤 경로(/robots.txt·/sitemap*·/llms*)는
위 표에서 API에 직접 조회했다. 운영 apex 워커는 같은 경로를 API로 전달한다(A01·A02 핀).
