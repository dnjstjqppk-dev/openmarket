# 5-2 사전 실패 기록 (rule 13) — 2026-11-17, base `579dbd1` + 테스트만 추가

## 1. `node tests/settlement_policy_test.mjs` → 10/15 pass, 5 fail

- 11: `wrong amount code, got WITHDRAWAL_EXCEEDS_AVAILABLE` (기대 `WITHDRAWAL_FULL_AMOUNT_ONLY`)
- 12: `출금 금액이 올바르지 않습니다.` (INVALID_AMOUNT) — 금액 없는 신청 불가
- 13: 동일 — 금액 없는 신청 불가
- 14: 동일 — 금액 없는 신청 불가
- 15: 동일 — 금액 없는 신청 불가
- 기존 1~10 전부 pass (회귀 없음)

## 2. `node tests/api_partner_2_9_test.mjs` → 22/23 pass, 1 fail

- P10: `over-full refused with 400 — 409 !== 400` (기대 400 `WITHDRAWAL_FULL_AMOUNT_ONLY`)
- 나머지 P1~P9, P11~P23 pass

## 3. 구 계약 probe (`$env:TEMP\probe-52-prefix.mjs`, 구 코드 + amount 명시)

- 드리프트 승인: `WITHDRAWAL_AMOUNT_CHANGED 409` 후에도 상태 `REQUESTED` 유지,
  재신청 `PAYOUT_REQUEST_INFLIGHT`로 차단 → 지시서 "현재 문제" 그대로 재현
- 동시 중복 승인: `["ok","NOTHING_TO_PAY:409"]` → 패자가 결정-경쟁 409가 아닌
  혼란스러운 코드를 받음 (인터리빙에 따라 PAYOUT_DRIFT 500 가능)

위 5개 신규 테스트 + P10이 구현 후 전부 통과해야 5-2 완료.
