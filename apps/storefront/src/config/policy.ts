// apps/storefront/src/config/policy.ts
// P2-S07: customer-facing policy figures in ONE module. Values must equal the
// server constants (pinned by tests/ui/p2_wavef.test.mjs F-S07):
//   WELCOME_CREDIT <- routes/auth.js WELCOME_CREDIT
//   LATE_COMPENSATION <- routes/temu-ops.js LATE_COMPENSATION_KRW
//   RETURN_WINDOW_DAYS <- routes/orders.js RETURN_WINDOW_DAYS_DEFAULT
//   PRICE_ADJUST_WINDOW_DAYS <- routes/orders.js PRICE_ADJUST_WINDOW_DAYS
export const WELCOME_CREDIT = 10000
export const LATE_COMPENSATION = 5300
export const RETURN_WINDOW_DAYS = 7
export const PRICE_ADJUST_WINDOW_DAYS = 30

export const fmtKRW = (n: number) => `${n.toLocaleString('ko-KR')}원`
