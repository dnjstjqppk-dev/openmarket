# 장애 대응 및 롤백 가이드 (ROLLBACK_GUIDE.md)

> 실측 기준 2026-11-11, wrangler 4.158.0. 저장소에는 `.down.sql`이 없다.
> 감사 테이블명은 `admin_audit_log`이다(과거 버전의 `audit_logs`·R2 스냅샷
> 언급은 허구였으며 본 개정에서 삭제했다).

## 1. 롤백 판단 기준 (Trigger Conditions)

- Cloudflare 엣지 5xx 에러율 1% 초과 발생 시 (Sentry NEW-18 알림 또는
  `GET /health` 폴링으로 감지)
- 배포 직후 결제 승인 또는 재고 감산 API 연속 실패 시
- 파트너 데이터 격리 위반 등 크리티컬 보안 이슈 감지 시
- D1 마이그레이션 적용 후 reconciliation 실패 시 (§3으로)

## 2. Worker 즉시 롤백 절차 (코드만, 데이터 untouched)

```bash
cd apps/cloudflare-gateway   # 해당 Worker 디렉터리에서 실행
# 1. 최근 10개 배포 조회
npx wrangler deployments list
# 2. 특정 정상 버전으로 즉시 롤백 (인자는 Version ID)
npx wrangler rollback [VERSION_ID]
# 3. 확인
npx wrangler deployments status
```

스토어/파트너/관리자 정적 앱도 동일하게 각 디렉터리에서 롤백한다.
Worker 롤백은 D1 데이터를 되돌리지 않는다 — 데이터 오염이 의심되면 §3이다.

## 3. 데이터베이스 롤백 절차 (D1-aware)

원칙: **additive 마이그레이션은 롤백하지 않고 전진 수정(forward-fix)**한다.
파괴적 데이터 변경(d1_30/31/32류)만 아래 절차를 밟는다.

1. **사전 export** (아직 안 했다면 지금):  
   `npx wrangler d1 export openmarket-db --remote --output .ops-backups/openmarket-db-<날짜>-pre-rollback.sql`
2. **리허설 검증된 롤백 SQL 실행**: 대상별 검증済 스크립트가 있다.
   - 생성: `python scripts/d1_rehearse_on_backup.py <d1_31|d1_32> <backup_dir> <rollback.sql>`
     (백업 행으로 리허설→롤백 생성→복원 증명→멱등 증명까지 exit 0이어야 진행)
   - 보관済: `reports/v4/phase2/deploy/` (`rollback_d1_30.sql`,
     `d1_31/rollback_d1_31.sql`, `d1_32/rollback_d1_32.sql`)
   - 실행: `npx wrangler d1 execute openmarket-db --remote --file=<rollback.sql>`
   - 무결성 트리거(상태머신·원장 불변)가 역방향 전이를 막으면 스크립트가
     지시하는 대로 트리거를 내려서 복원하고 원문 그대로 재생성한다.
3. **최후 수단 Time Travel 복원**: 롤백 SQL이 없거나 실패하면
   `docs/database/BACKUP_RECOVERY.md` §1 절차로 시점 복원.
4. **검증**: `SELECT MAX(version) FROM schema_migrations` =
   기대 버전, `GET /health` 정상, 대사(차대변·주문 건수·재고) 일치.
5. **기록**: `admin_audit_log`에 사유·영향도·실행 명령·검증 결과를 남긴다.
   PII는 `pii_access_log` 규칙대로 last-4 마스킹.

## 4. 롤백 후 할 일

- Sentry에서 해당 5xx가 멈췄는지 확인 (없으면 원인이 코드가 아님).
- 실패한 배포/마이그레이션의 원인을 고치고 스테이징(또는 로컬 전체 `npm test`)
  녹색 후에 재배포. 같은 실패를 같은 날 두 번 내지 않는다.
