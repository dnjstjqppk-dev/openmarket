# 데이터베이스 백업 및 재해 복구 계획서 (BACKUP_RECOVERY.md)

> 실측 기준 2026-11-11, wrangler 4.158.0. 운영 데이터는 D1(`openmarket-db`) 하나에 산다.
> PostgreSQL WAL/pg_dump/R2 아카이빙은 이 프로젝트의 서빙 경로에 존재하지 않는다 —
> 과거 버전의 그記述은 허구였으며 본 개정에서 삭제했다.

## 1. 방어선 1: Time Travel (자동 PITR, 주 수단)

D1 Time Travel은 설정 없이 동작하는 자동 시점 복원이다. 분 단위 임의 시점으로
복원하며 보존 기간은 플랜에 따라 다르다.

- Workers Paid: 30일 / Workers Free: 7일. **유료 플랜 전환(§5 인간 항목)이
  끝나기 전까지는 7일로 가정**하고 §2 export 주기를 짧게 가져간다.
- 복원 횟수 제한: DB당 10분당 10회.
- Time Travel은 DB 삭제·계정 탈취에는 무력하다(§2가 그 간극을 메운다).

```bash
cd apps/cloudflare-gateway
# 1. 복원 지점 북마크 조회 (Unix 초 또는 RFC3339, 보존 기간 내)
npx wrangler d1 time-travel info openmarket-db --timestamp 2026-11-11T02:00:00.000Z
# 2. 복원 (원격 DB에 직접 작용 — 승인 후 실행)
npx wrangler d1 time-travel restore openmarket-db --timestamp 2026-11-11T02:00:00.000Z
```

## 2. 방어선 2: `d1 export` 오프라인 사본 (DB 삭제 대비)

```bash
# 마이그레이션 전 필수 스냅샷 (PII 포함 — git-ignored .ops-backups/ 이하에만 보관)
npx wrangler d1 export openmarket-db --remote --output .ops-backups/openmarket-db-20261111-pre-d1XX.sql
# 주 1회 전체 export를 권장 (유료 전환 전까지는 격일)
```

export 파일로 복원할 때는 빈 D1(또는 복원 전용 DB)에 `d1 execute --file`으로
적재한 뒤 §4 검증 쿼리를 통과한 것만 운영 바인딩으로 교체한다.
직접 덮어쓰기가 아니라 교체 방식인 이유: 실패 시 원본이 그대로 남는다.

## 3. RPO & RTO (정직 표기)

- **RPO**: Time Travel 복원 시 < 약 2분(분 단위 복원 지점). export선만 있을
  때는 마지막 export 시점(= 주기에 따름, 기본 주 1회).
- **RTO**: Time Travel 복원 수 분 + §4 검증. export 적재 복원은 DB 크기에
  비례하며 미실측(첫 운영 export 때 실측 기록 예정).

## 4. 복원 후 검증 (트래픽 재개 전 필수)

```bash
# 스키마 수준: 최신 마이그레이션까지 와 있는지
npx wrangler d1 execute openmarket-db --remote \
  --command "SELECT MAX(version) FROM schema_migrations"
# 동등: GET /health 의 schemaVersion / migrationsApplied
```

- `GET /health`: `status=UP`, `operator_entity_active`가 복원 전과 동일.
- 대사: `ledger_entries` 차·대변 합계 일치, `orders` 건수·합계가 장애 감지
  시점 기록과 복원 지점 차이만큼만 감소 (그 이상이면 복원 지점 오류).
- `admin_audit_log`에 복원 사유·지점·검증 결과를 남긴다.

## 5. 훈련 기록

- **2026-11-11 로컬 드릴 PASS** (원격 미실시 — 승인 없이 원격에 손대지 않음).
  전체 마이그레이션+dev 시드로 SQLite를 구축 → 파일 스냅샷 → 장애 시뮬레이션
  (products 절반 UPDATE 오염, skus 재고 오염, users 이메일 오염) → 스냅샷에서
  복원 → 6개 테이블 지문(count+sha) 완전 일치.
  - 스냅샷 1,335,296 bytes. 복원 후 `restore matches snapshot: true`.
  - 다음 차례: 운영 export 1회 실측 + Time Travel `info`(읽기 전용) 조회로
    원격 보존 윈도우 확인.
