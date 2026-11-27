// apps/storefront/src/utils/orderStatus.ts
// P2-S14: single order/sub-order status label source for Orders + OrderDetail,
// localized across ko-KR / en-US / ja-JP / zh-TW via @olmoa/ui uiLocale.
import { uiLocale, type UiLocale } from '@olmoa/ui'

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

const I18N_STATUS: Record<string, Record<Exclude<UiLocale, 'ko-KR'>, string>> = {
  READY: { 'en-US': 'Awaiting Payment', 'ja-JP': '入金待ち', 'zh-TW': '待付款' },
  PAYMENT_PENDING: { 'en-US': 'Awaiting Payment', 'ja-JP': '入金待ち', 'zh-TW': '待付款' },
  PAID: { 'en-US': 'Paid', 'ja-JP': '決済完了', 'zh-TW': '已付款' },
  PAYMENT_CONFIRMED: { 'en-US': 'Paid · Preparing', 'ja-JP': '決済完了・出荷準備', 'zh-TW': '已付款・備貨中' },
  PREPARING: { 'en-US': 'Preparing', 'ja-JP': '発送準備中', 'zh-TW': '商品備貨中' },
  SHIPPED: { 'en-US': 'Shipped', 'ja-JP': '出荷完了', 'zh-TW': '已出貨' },
  IN_TRANSIT: { 'en-US': 'In Transit', 'ja-JP': '配送中', 'zh-TW': '配送中' },
  DELIVERED: { 'en-US': 'Delivered', 'ja-JP': '配送完了', 'zh-TW': '已送達' },
  CONFIRMED: { 'en-US': 'Confirmed', 'ja-JP': '購入確定', 'zh-TW': '已完成確認' },
  COMPLETED: { 'en-US': 'Confirmed', 'ja-JP': '購入確定', 'zh-TW': '已完成確認' },
  PURCHASE_CONFIRMED: { 'en-US': 'Confirmed', 'ja-JP': '購入確定', 'zh-TW': '已完成確認' },
  CANCEL_REQUESTED: { 'en-US': 'Cancel Requested', 'ja-JP': 'キャンセル要請', 'zh-TW': '取消申請中' },
  CANCELLED: { 'en-US': 'Cancelled', 'ja-JP': 'キャンセル済み', 'zh-TW': '已取消' },
  RETURN_REQUESTED: { 'en-US': 'Return Requested', 'ja-JP': '返品要請', 'zh-TW': '退貨申請中' },
  RETURNED: { 'en-US': 'Returned', 'ja-JP': '返品完了', 'zh-TW': '已退貨' },
  PARTIAL_REFUNDED: { 'en-US': 'Partially Refunded', 'ja-JP': '一部返金', 'zh-TW': '部分退款' },
  REFUNDED: { 'en-US': 'Refunded', 'ja-JP': '返金完了', 'zh-TW': '已退款' },
  EXPIRED: { 'en-US': 'Expired', 'ja-JP': '期限切れ', 'zh-TW': '已逾期' },
  FAILED: { 'en-US': 'Payment Failed', 'ja-JP': '決済失敗', 'zh-TW': '付款失敗' }
}

export const paymentStatusLabel = (s: string): string => {
  const loc = uiLocale.value
  if (loc !== 'ko-KR' && I18N_STATUS[s]?.[loc]) return I18N_STATUS[s][loc]
  return PAYMENT_STATUS_LABEL[s] || s
}
export const subOrderStatusLabel = (s: string): string => {
  const loc = uiLocale.value
  if (loc !== 'ko-KR' && I18N_STATUS[s]?.[loc]) return I18N_STATUS[s][loc]
  return SUBORDER_STATUS_LABEL[s] || s
}

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
