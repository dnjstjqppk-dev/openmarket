# G. PHASE 0 — 운영 보안 핫픽스 배포 보고 (2026-11-05)

## 1. 기준선

| 항목 | 값 |
|---|---|
| 배포 전 운영 코드 | `50c0d4a` (프론트 번들 해시 4종 일치로 확인. API는 `/version`의 commit이 `unset`이라 동작으로 확인) |
| 배포 커밋 | `7cad111` (브랜치 `fix/v3.2-integrity-regressions`, main 미병합) |
| 변경 범위 | API 14파일, 구매자 4화면, 파트너 1화면, 테스트 4파일. 관리자 소스 0, 마이그레이션 0, wrangler 설정 0 |
| DB 마이그레이션 / 운영 DB 쓰기 / 시크릿·변수 변경 | 없음 / 없음 / 없음 (dry-run 바인딩·변수 동일) |

## 2. 배포 전 검증 (`evidence/11`)

마이그레이션 리허설 PASS, 보안·무결성 77/77, 상업 기능 6/6, URL 수집·3PL 7/7, 멀티채널 6/6, 기능 E2E 26/26 (합계 123), 공격 재현 0/18 취약.
새 테스트를 이전 코드에 실행하면 실패함: `evidence/10`.
정정: 이전 보고의 "상업 기능 7/7"은 성공 배너 줄까지 센 오류이며 실제 6/6.

`vue-tsc`: **실행 불가(NOT_RUN)**. `apps/storefront/tsconfig.json`의 `"ignoreDeprecations": "6.0"`이 설치된 TypeScript 5.9.3에서 무효(TS5103). 커밋 `dd4f56e`(2026-10-30)부터 존재했고 이번 수정과 무관. 빌드(vite)는 타입 검사를 하지 않음.

## 3. 배포 (순서: API → 프론트)

| Worker | 이전 버전(롤백 대상) | 새 버전 | 번들 |
|---|---|---|---|
| olmoa-api | `cf700ab6-ba8a-43dc-8e3f-5b26af81c6dd` | `72f9d62a-4e3a-4069-b412-25faf2ff1892` | — |
| olmoa-storefront | `fb29719a-2e67-4674-ad2a-54698511f34a` | `22606e68-aaac-45d7-aab1-c7594d69db95` | index-DqMinqiG |
| openmarket (구매자 2번째 Worker, 같은 dist) | `c0f57a57-66fb-4743-8820-dca888867c11` | `b0fe484c-64a7-4ed1-b65f-7b988faac7e0` | index-DqMinqiG |
| olmoa-partner | `c7361249-8727-4c3d-93cb-8dfa690b09c6` | `34b70ec7-9855-4af8-9ed9-506cf8362bc1` | index-D1fL7Q5M |
| olmoa-admin | `05f85866-db4c-43a0-80c4-1476fd5dfcad` | 재배포 안 함 | 소스 변경 0, 번들 해시 동일 |

모든 새 버전의 배포 메시지: `hotfix 7cad111 v3.2 integrity regressions`. 재빌드 결과가 커밋된 dist와 동일(변경 0줄).
롤백: `npx wrangler rollback <이전 버전 ID> --name <worker>` (API는 DB 변경이 없어 단독 롤백 가능).

## 4. 배포 후 운영 검증 (`scripts/prod-hotfix-probe.sh`, `evidence/12`→`13`, `14`)

| ID | 점검 | 배포 전 | 배포 후 |
|---|---|---|---|
| H01 | 세금계산서 목록 무인증 | 200 | 401 |
| H02 | 현금영수증 신청 무인증 | 400 | 401 |
| H03 | 현금영수증 조회 무인증 | 404 | 401 |
| H05 | 연동 상태 무인증 | 200 | 401 |
| H06 | 가짜 번개특가 피드 | 200 | 410 |
| H07 | 가짜 이미지 유사도 | 200 | 501 |
| H08 | 원가 없는 가격 계산 | 200 | 400 |
| H10 | 사업자 상태 | CHECKSUM_VERIFIED(상태 날조) | CHECKSUM_ONLY |
| H15 | 서명 없는 웹훅 | (배포 전 미실행: DB 기록 발생) | 501, 기록 없음 |
| H04·H09·H11~H14 | 무인증 차단·카탈로그·실캠페인·위조 토큰·CORS | 정상 | 정상 유지 |

운영 구매자 JS에서 가짜 문구 8종(“함께 보는 중”, “최근 1시간 내 8건”, “실시간 1위”, “전수 검수 완료”, “국세청 승인 완료”, 이미지 유사도 호출, 14200초 타이머, deals/lightning 호출) 0건.
판매자 간 접근(IDOR) 차단은 운영 테스트 계정을 만들지 않기 위해 로컬 테스트로만 검증(I 시나리오·crawler 7번 테스트).

## 5. 운영 DB 인증정보 읽기 전용 조사 — **BLOCKED**

`PRAGMA query_only = ON; SELECT COUNT…` 를 실행했으나 D1이 `not authorized: SQLITE_AUTH [7500]`로 PRAGMA를 거부해 **요청 전체가 실행되지 않음**(SELECT 포함 0건 실행).
D1/wrangler OAuth 토큰에는 읽기 전용 트랜잭션·읽기 전용 권한을 강제할 수단이 없어, 지시의 필수 조건을 충족한 상태로는 조사할 수 없음. PO 결정 필요(최종 보고 참고).
