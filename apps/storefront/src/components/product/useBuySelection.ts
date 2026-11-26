// Shared buy state for the desktop panel and the mobile sheet (3-4): stepped
// option picking, multi-line selection, totals, wishlist, restock and the
// fake-discount guard. One instance per product view; both panels read it.
import { ref, computed, watch, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast, userErrorMessage } from '@olmoa/ui'
import { useCartStore } from '../../stores/cart'
import { useAuthStore } from '../../stores/auth'
import { useWishlistStore } from '../../stores/wishlist'
import { API_BASE_URL } from '../../config'
import { volumeUnitPrice, volumeDiscountPct } from '../../lib/pricing'

// 20-day fake-discount lookback (Q-3-4: operator confirms the window).
export const PRICE_SURGE_LOOKBACK_DAYS = 20

export interface BuyLine {
  sku: any
  qty: number
}

export function useBuySelection(productRef: any, skusRef: any) {
  const route = useRoute()
  const router = useRouter()
  const toast = useToast()
  const cart = useCartStore()
  const auth = useAuthStore()
  const wishlist = useWishlistStore()

  const selection = ref<Record<string, string>>({})
  const lines = ref<BuyLine[]>([])
  const comboHint = ref<string | null>(null)
  const surgeHidden = ref(false)

  const product = computed(() => productRef.value)
  const skus = computed<any[]>(() => skusRef.value || [])
  const attributes = computed<{ name: string; values: string[] }[]>(() => product.value?.attributes || [])
  const onSale = computed(() => !!product.value && product.value.status === 'ACTIVE' && (product.value.review_status == null || product.value.review_status === 'APPROVED'))
  const baseMin = computed(() => Math.min(...skus.value.map((s) => Number(s.sale_price)), Number(product.value?.lowest_sale_price || 0)) || 0)

  function reset() {
    selection.value = {}
    lines.value = []
    comboHint.value = null
    surgeHidden.value = false
    // No-option products start with their single default line.
    if (skus.value.length && attributes.value.length === 0) {
      const first = skus.value.find((s) => Number(s.stock_quantity) > 0) || skus.value[0]
      lines.value = [{ sku: first, qty: 1 }]
    }
  }
  watch(() => product.value?.id, reset)

  /** Step i unlocks once every earlier attribute is picked. */
  function stepUnlocked(i: number): boolean {
    return attributes.value.slice(0, i).every((a) => !!selection.value[a.name])
  }

  function matchingSkus(attr: string, value: string) {
    return skus.value.filter(
      (s) =>
        String(s.options?.[attr]) === value &&
        attributes.value.every((a) => a.name === attr || !selection.value[a.name] || String(s.options?.[a.name]) === selection.value[a.name])
    )
  }

  function valueState(attr: string, value: string): 'ok' | 'soldout' | 'none' {
    const matches = matchingSkus(attr, value)
    if (!matches.length) return 'none'
    return matches.some((s) => Number(s.stock_quantity) > 0) ? 'ok' : 'soldout'
  }

  /** Surcharge of a value over the product base (min ticket), or 0. */
  function valueExtra(attr: string, value: string): number {
    const matches = matchingSkus(attr, value)
    if (!matches.length) return 0
    return Math.max(0, Math.min(...matches.map((s) => Number(s.sale_price))) - baseMin.value)
  }

  function choose(attr: string, value: string) {
    comboHint.value = null
    const next = { ...selection.value }
    if (next[attr] === value) {
      // Unpicking a step also clears every later step (they depended on it).
      const idx = attributes.value.findIndex((a) => a.name === attr)
      for (const a of attributes.value.slice(idx)) delete next[a.name]
    } else {
      next[attr] = value
    }
    selection.value = next
    if (attributes.value.length && attributes.value.every((a) => next[a.name])) {
      const sku = skus.value.find((s) => attributes.value.every((a) => String(s.options?.[a.name]) === next[a.name])) || null
      if (!sku) {
        comboHint.value = '선택한 조합의 옵션이 없습니다'
        return
      }
      addLine(sku)
      selection.value = {}
    }
  }

  function addLine(sku: any) {
    const line = lines.value.find((l) => l.sku.id === sku.id)
    const stock = Number(sku.stock_quantity) || 0
    if (line) {
      line.qty = stock > 0 ? Math.min(line.qty + 1, stock, 99) : 1
    } else {
      lines.value.push({ sku, qty: 1 })
    }
  }

  function setQty(skuId: string, qty: number) {
    const line = lines.value.find((l) => l.sku.id === skuId)
    if (!line) return
    const stock = Number(line.sku.stock_quantity) || 0
    line.qty = stock > 0 ? Math.max(1, Math.min(Math.floor(qty) || 1, stock, 99)) : 1
  }

  function removeLine(skuId: string) {
    lines.value = lines.value.filter((l) => l.sku.id !== skuId)
  }

  const buyableLines = computed(() => lines.value.filter((l) => Number(l.sku.stock_quantity) > 0))
  const lineTotalOf = (l: BuyLine) => volumeUnitPrice(Number(l.sku.sale_price), l.qty) * l.qty
  const total = computed(() => buyableLines.value.reduce((a, l) => a + lineTotalOf(l), 0))
  const totalQty = computed(() => buyableLines.value.reduce((a, l) => a + l.qty, 0))
  const tierPctOf = (l: BuyLine) => volumeDiscountPct(l.qty)

  const wished = computed(() => !!product.value && wishlist.ids.has(product.value.id))
  async function toggleWish() {
    if (!product.value) return
    if (!(await auth.ensureSession())) {
      router.push(`/login?redirect=${encodeURIComponent(route.fullPath)}`)
      return
    }
    const next = await wishlist.toggle(product.value.id)
    if (next === null) toast.error('찜하지 못했습니다')
    else toast.success(next ? '찜 목록에 저장했습니다.' : '찜 목록에서 삭제했습니다.')
  }

  function addAllToCart(): boolean {
    if (!buyableLines.value.length) {
      toast.error('담을 수 있는 옵션이 없습니다')
      return false
    }
    for (const l of buyableLines.value) {
      if (!cart.addItem(product.value, l.sku, l.qty)) {
        toast.error('장바구니에 담지 못했습니다. 품절 여부를 확인해 주세요.')
        return false
      }
    }
    toast.success(`장바구니에 담았습니다 (${totalQty.value}개)`, { title: product.value.title })
    return true
  }

  function buyNow() {
    if (!addAllToCart()) return
    cart.selectOnly(buyableLines.value.map((l) => l.sku.id))
    router.push('/checkout')
  }

  const restocked = ref<Set<string>>(new Set())
  async function subscribeRestock(skuId: string) {
    if (!(await auth.ensureSession())) {
      router.push(`/login?redirect=${encodeURIComponent(route.fullPath)}`)
      return
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/restock-subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku_id: skuId })
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(json?.error || '신청하지 못했습니다')
      restocked.value = new Set(restocked.value).add(skuId)
      toast.success(json.idempotent_replay ? '이미 신청한 옵션입니다' : '재입고 알림을 신청했습니다')
    } catch (e: any) {
      toast.error(userErrorMessage(e, '신청하지 못했습니다'))
    }
  }

  /** Fake-discount guard: an original-price hike inside the lookback hides the %. */
  async function checkSurge(productId: string) {
    surgeHidden.value = false
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/products/${encodeURIComponent(productId)}/price-history`)
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success || !Array.isArray(json.data)) return
      const cutoff = Date.now() - PRICE_SURGE_LOOKBACK_DAYS * 86400000
      const bySku = new Map<string, { orig: number; at: number }[]>()
      for (const h of json.data) {
        const t = Date.parse(String(h.changed_at).replace(' ', 'T') + 'Z')
        if (Number.isNaN(t)) continue
        const list = bySku.get(h.sku_id) || []
        list.push({ orig: Number(h.original_price), at: t })
        bySku.set(h.sku_id, list)
      }
      for (const list of bySku.values()) {
        list.sort((a, b) => a.at - b.at)
        for (let i = 1; i < list.length; i++) {
          if (list[i].at >= cutoff && list[i].orig > list[i - 1].orig) {
            surgeHidden.value = true
            return
          }
        }
      }
    } catch {
      // History unreadable: show the computed rate (fail-open, server truth kept).
    }
  }

  // Reactive shell so templates read plain values (sel.lines, sel.total).
  return reactive({
    selection, lines, comboHint, surgeHidden, attributes, onSale, baseMin,
    stepUnlocked, valueState, valueExtra, choose, addLine, setQty, removeLine,
    buyableLines, lineTotalOf, total, totalQty, tierPctOf,
    wished, toggleWish, addAllToCart, buyNow, restocked, subscribeRestock, checkSurge, reset
  })
}

export type BuySelection = ReturnType<typeof useBuySelection>
