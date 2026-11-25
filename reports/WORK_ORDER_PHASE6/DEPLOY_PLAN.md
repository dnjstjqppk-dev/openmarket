# Phase-6 배포 계획서 (리허설 근거, 원격 0건)

- 작성: 2026-11-25 / 대상: `work-order/phase6` → `main` 병합 후 운영 반영
- 범위: 6-0 감사 수정 + 6-11·6-12·6-13 + 6-1~6-8 (게이트웨이·스토어프론트·파트너·관리자·루트 워커)
- 원칙: 규칙 12(원격 단계마다 운영자 승인) · 규칙 14(운영 반영은 운영자가 수행). 본 계획의 리허설은 로컬에서만 실행했고 원격 호출 0건.

## 0. 전제 조건

1. 6단계 관문이 전부 PASS(아래 6-9 리허설 + `npm test`·`typecheck`·`lint`·cspell·design_lint).
2. `work-order/phase6`를 `main`에 병합(리뷰 후, 운영자).
3. 6-0 보고서 §8안 적용(운영자 승인 후): `deploy.yml` API 단계의 `if:` 제거(6-0 결론이 **운영 배포 가능**이므로 게이트웨이 배포를 본 계획에 포함).

## 1. 배포 순서

| 순서 | 대상 | 방법 | 확인 |
|---|---|---|---|
| 1 | D1 백업 | `npx wrangler d1 export` 테이블별 + Time Travel 북마크(Phase-5 런북 주의: FTS 가상 테이블은 export 제외) | 백업 파일 존재·북마크 시각 기록 |
| 2 | D1 마이그레이션 | `migrate-d1-remote.yml`(APPLY): `d1_75_product_identifiers` → `d1_76_faqs` → `d1_77_user_locale` | `/health` schemaVersion=`d1_77_user_locale.sql` |
| 3 | API(`olmoa-api`) | push 자동 배포(§8 적용 후) 또는 수동 dispatch | `/health` 200, `/robots.txt` 3묶음+신호, `/llms-full.txt` 200, `/sitemap-index.xml` 항목 해결 |
| 4 | 시크릿 | `INDEXNOW_KEY`→API 워커, 소유 확인은 DNS TXT 권장(부득이하면 `NAVER_SITE_VERIFICATION`·`GOOGLE_SITE_VERIFICATION`→루트 워커) | `/<key>.txt` 본문 일치 200 |
| 5 | 파트너·관리자 콘솔 | 각 워커 배포(신규 화면: 식별정보·FAQ·검수) | 로그인·목록 200 |
| 6 | 루트 워커(`openmarket`, 마지막) | 배포(스토어프론트 빌드 포함 + `run_worker_first` 크롤 전달) | `/` 200, `/en`·`/ja` 200, `/robots.txt`·`/llms.txt`·`/llms-full.txt`·`/llms/product/*.md`가 API 생성 텍스트(HTML 셸 아님), `HUMAN_CHECKLIST.md` §5 잔항 |

순서 근거: D1이 먼저(신규 컬럼·테이블 없이 코드는 쓰기 실패) → API(하위 호환 추가만이라 구 콘솔과 공존) → 콘솔들(신규 API 필요) → 루트(신규 API로 크롤 전달 + 신규 스토어프론트 서빙). **API → 루트 워커** 순서를 깨면 크롤 경로가 구 API를 가리킨다.

## 2. 롤백 (이전 버전 재배포)

1. 역순 재배포: 루트 → 콘솔들 → API. 각 워커 대시보드 Rollback(또는 직전 버전 `wrangler deploy`)으로 복원.
2. D1은 원칙적으로 롤백하지 않는다: `d1_75`~`d1_77`은 추가형(신규 컬럼·테이블)이라 구 코드와 공존한다. 마이그레이션 자체가 실패했을 때만 Time Travel 복원(§1-1 북마크).
3. 롤백 후 확인: `/health` schemaVersion, 6-9 비교표의 행을 운영에서 재측(크롤 200·셸 200).

## 3. 리허설 증거

- `reports/WORK_ORDER_PHASE6/6-9-comparison.md`: 로컬 2스택(89bbf03 vs phase6) 전후 비교 15행.
- `reports/WORK_ORDER_PHASE6/6-9.md`: 리허설 실행 기록 + LCP 실측(전 구간 2500ms 내).
- `scripts/phase6-rehearsal-probe.mjs`: 비교표 생성 스크립트(재실행 가능).
