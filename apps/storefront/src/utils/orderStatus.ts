// apps/storefront/src/utils/orderStatus.ts
// P2-S14: one order/sub-order status label source for Orders + OrderDetail.
export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  READY: '결제 대기',
  PAID: '결제 완료',
  PARTIAL_REFUNDED: '부분 환불',
  REFUNDED: '환불 완료',
  CANCELLED: '주문 취소',
  EXPIRED: '결제 만료',
  DELIVERED: '배송 완료',
  CONFIRMED: '구매 확정',
  COMPLETED: '구매 확정',
  PURCHASE_CONFIRMED: '구매 확정',
  FAILED: '결제 실패'
}

export const SUBORDER_STATUS_LABEL: Record<string, string> = {
  PAYMENT_PENDING: '결제 대기',
  PAYMENT_CONFIRMED: '결제 완료 · 출고 준비',
  PREPARING: '상품 준비중',
  SHIPPED: '출고 완료',
  IN_TRANSIT: '배송중',
  DELIVERED: '배송 완료',
  PURCHASE_CONFIRMED: '구매 확정',
  CANCEL_REQUESTED: '취소 요청',
  CANCELLED: '주문 취소',
  RETURN_REQUESTED: '반품 요청',
  RETURNED: '반품 완료',
  EXPIRED: '결제 만료'
}

export const paymentStatusLabel = (s: string): string => PAYMENT_STATUS_LABEL[s] || s
export const subOrderStatusLabel = (s: string): string => SUBORDER_STATUS_LABEL[s] || s

// 5-1: OmBadge tones for the status pills (same states as the labels above).
export type StatusTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'highlight'
const PAYMENT_STATUS_TONE: Record<string, StatusTone> = {
  READY: 'warning',
  PAID: 'success', DELIVERED: 'success', CONFIRMED: 'success', COMPLETED: 'success', PURCHASE_CONFIRMED: 'success',
  PARTIAL_REFUNDED: 'info', REFUNDED: 'info',
  FAILED: 'danger',
  CANCELLED: 'neutral', EXPIRED: 'neutral'
}
const SUBORDER_STATUS_TONE: Record<string, StatusTone> = {
  PAYMENT_PENDING: 'warning', PREPARING: 'warning', CANCEL_REQUESTED: 'warning', RETURN_REQUESTED: 'warning',
  PAYMENT_CONFIRMED: 'info', SHIPPED: 'info', IN_TRANSIT: 'info',
  DELIVERED: 'success', PURCHASE_CONFIRMED: 'success',
  CANCELLED: 'neutral', RETURNED: 'neutral', EXPIRED: 'neutral'
}
export const paymentStatusTone = (s: string): StatusTone => PAYMENT_STATUS_TONE[s] || 'neutral'
export const subOrderStatusTone = (s: string): StatusTone => SUBORDER_STATUS_TONE[s] || 'neutral'
