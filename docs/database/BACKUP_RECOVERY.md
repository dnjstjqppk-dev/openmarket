# 데이터베이스 백업 및 재해 복구 계획서 (BACKUP_RECOVERY.md)

## 1. 백업 정책 (Backup Policy)
- **WAL 아카이빙 (Point-in-Time Recovery - PITR)**:
  - PostgreSQL Write-Ahead Logging(WAL)을 Cloudflare R2 버킷으로 1분 간격 스트리밍 아카이빙.
  - 최대 35일간의 임의 시점으로 초 단위 롤백 가능 (RPO < 1분).
- **일일 풀 백업 (Daily Full Snapshot)**:
  - 매일 새벽 03:00 UTC에 `pg_dump` 기반 압축 백업 수행 후 R2 Cold Tier에 90일 보존.

## 2. 재해 복구 목표치 (RPO & RTO)
- **RPO (복구 시점 목표)**: 1분 이내 (최대 1분 분량의 트랜잭션 유실 허용)
- **RTO (복구 시간 목표)**: 15분 이내 (인스턴스 장애 시 신규 파드/컨테이너 기동 및 복원 완료)

## 3. 복구 훈련 시나리오 (DR Simulation)
1. 데이터 손상 또는 비정상 삭제 발생 감지
2. 복구 목표 시점(Timestamp T) 특정
3. 최신 기본 백업 스냅샷 복원
4. WAL 로그를 시점 T까지 리플레이(Roll-Forward)
5. `ledger_entries` 및 `orders` 데이터 대사 후 서비스 트래픽 재개

