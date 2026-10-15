# 장애 대응 및 롤백 가이드 (ROLLBACK_GUIDE.md)

## 1. 롤백 판단 기준 (Trigger Conditions)
- Cloudflare 엣지 5xx 에러율 1% 초과 발생 시
- 배포 직후 결제 승인 또는 재고 감산 API 연속 실패 시
- 파트너 데이터 격리 위반 등 크리티컬 보안 이슈 감지 시

## 2. Cloudflare 즉시 롤백 절차
Cloudflare Workers 및 Pages는 이전 배포 버전(Deployment ID)을 영구 보존하므로 즉각적인 무중단 롤백이 가능합니다.

```bash
# 1. 이전 배포 목록 조회
npx wrangler deployments list

# 2. 특정 정상 배포 버전으로 즉시 롤백
npx wrangler rollback [DEPLOYMENT_ID]
```

## 3. 데이터베이스 스키마 롤백 절차
- 마이그레이션 실패 시 사전 백업된 R2 스냅샷 또는 `.down.sql`을 실행하여 롤백합니다.
- 테이블 드롭 시 `CASCADE` 사용을 엄격히 제한하고 역순으로 외래키 종속 테이블부터 안전하게 해제합니다.
- 롤백 후 `audit_logs`에 사유 및 영향도 분석 리포트를 남깁니다.
