// apps/storefront/src/lib/quote.ts
// POST /api/v1/orders/quote — the server prices an order with the same code path as checkout (createOrder with
// dryRun), so the amounts it returns are the amounts that will be charged. Requires a signed-in customer.
import { API_BASE_URL, authHeader } from '../config'

export interface QuoteLine {
  sku_id: string
  title: string
  option_summary: string
  unit_price: number
  base_unit_price: number
  quantity: number
  line_total: number
  volume_discount_pct: number
}
export interface QuoteSubOrder {
  partner_id: string
  sales_model: string
  goods_amount: number
  shipping_fee: number
  items: QuoteLine[]
}
export interface Quote {
  total_goods_amount: number
  volume_discount_amount: number
  coupon_discount_amount: number
  credit_used_amount: number
  total_shipping_amount: number
  total_pay_amount: number
  currency: string
  sub_orders: QuoteSubOrder[]
}
export interface QuoteRequest {
  items: { product_id: string; sku_id: string; quantity: number }[]
  user_coupon_id?: string
  use_credit_amount?: number
}

export async function fetchQuote(body: QuoteRequest, signal?: AbortSignal): Promise<Quote> {
  const res = await fetch(`${API_BASE_URL}/api/v1/orders/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
    signal
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.success) throw new Error(json?.error || `주문 금액을 계산하지 못했습니다 (${res.status})`)
  return json.data as Quote
}

/** sku_id -> current sale price (before quantity tiers), from a quote. */
export function quotePrices(q: Quote): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of q.sub_orders) for (const it of s.items) out[it.sku_id] = Number(it.base_unit_price)
  return out
}
