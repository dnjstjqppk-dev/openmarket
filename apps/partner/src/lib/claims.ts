// Shared claim labels (4-5): Korean status/type names for the three claim views.
export const STATUS_LABEL: Record<string, string> = {
  REQUESTED: '요청',
  APPROVED: '승인됨',
  REJECTED: '거절됨',
  REFUNDED: '환불완료',
  CANCELLED: '철회됨',
  RESHIPPED: '재발송됨'
}
export const EXCHANGE_LABEL: Record<string, string> = {
  AWAITING_RESHIPMENT: '재발송 대기',
  RESHIPPED: '재발송됨'
}
export const TYPE_LABEL: Record<string, string> = {
  RETURN: '반품',
  EXCHANGE: '교환',
  PRICE_ADJUSTMENT: '가격보상'
}
