# 프로덕션 릴리스 체크리스트 (RELEASE_CHECKLIST.md)

## 1. 릴리스 사전 점검표 (Pre-Release Checklist)

```text
[V] 1. Go 백엔드 테스트 및 상태머신 전이 테스트 PASS (100%)
[V] 2. 6개 PostgreSQL 마이그레이션 DDL 정합성 검증 완료
[V] 3. Redis 7 Lua 동시성 및 보상 롤백 로직 검증 완료
[V] 4. Customer Storefront 33대 카테고리 및 Split-Order 검증 완료
[V] 5. Admin Console 파트너 심사 및 복식부기 원장 검증 완료
[V] 6. Partner Console 상품 등록 및 운송장 배송 상태머신 검증 완료
[V] 7. Cloudflare 4대 앱 Wrangler dry-run 빌드 배포 검증 완료
[V] 8. GitHub Actions CI/CD 파이프라인 워크플로우 등록 완료
[V] 9. Git 커밋 및 Remote Push 완료 (main 브랜치 최신화)
[ ] 10. 상용 PG사 운영 계약 및 라이브 결제 키 연동 (외부 의존성 - CONDITIONAL)
[ ] 11. 택배사 공식 B2B API 계약 및 실송장 자동 채번 연동 (외부 의존성 - CONDITIONAL)
```

## 2. 출시 판정 (Launch Verdict)
- **기술적 구축 및 배포 (Technical Deployment)**: **PASS**
- **상용 라이브 오픈 (Commercial Launch Readiness)**: **CONDITIONAL GO** (실제 상품 공급 계약 및 PG 가맹 계약 체결 완료 후 즉시 전환 가능)
