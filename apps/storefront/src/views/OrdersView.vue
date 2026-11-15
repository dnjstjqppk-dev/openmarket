<script setup lang="ts">
import { Check, ChevronRight, Coins, Copy, Pencil, Repeat, RotateCw, ShieldCheck, ShoppingCart, TriangleAlert, Truck } from 'lucide-vue-next'
import { ref, computed, onMounted, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useLocaleStore } from '../stores/locale'
import { useCartStore } from '../stores/cart'
import { API_BASE_URL, authHeader } from '../config'
import { paymentStatusLabel, subOrderStatusLabel } from '../utils/orderStatus'
import { userErrorMessage, OmEmptyState, OmImage, OmSkeleton } from '@olmoa/ui'

// 3-8: one card per order, three phase tabs. A whole-order cancel is routine
// admin paperwork (neutral button), not a warning — and only unpaid orders
// (every sub-order PAYMENT_PENDING) may cancel from this list.
const TERMINAL_SUB = ['PURCHASE_CONFIRMED', 'CANCELLED', 'RETURNED', 'EXPIRED']
const TABS = [
  { key: 'upcoming', label: '예정' },
  { key: 'purchasing', label: '구매중' },
  { key: 'completed', label: '완료' }
] as const
type TabKey = (typeof TABS)[number]['key']

const router = useRouter()
const route = useRoute()
const locale = useLocaleStore()
const cart = useCartStore()
const orders = ref<any[]>([])
const page = ref(0)
const totalPages = ref(1)
const loading = ref(true)
const loadingMore = ref(false)
const loadError = ref('')
// 3-9: the my-home pipeline deep-links with ?tab=; unknown values fall back
// to the default tab instead of rendering an empty list.
const tabFromQuery = (q: unknown): TabKey => (q === 'upcoming' || q === 'completed' ? q : 'purchasing')
const activeTab = ref<TabKey>(tabFromQuery(route.query.tab))
watch(() => route.query.tab, (q) => { activeTab.value = tabFromQuery(q) })
const actionMsg = ref('')
const copyToast = ref('')
const showCancelModal = ref(false)
const orderToCancel = ref<any>(null)
const isCancelling = ref(false)

const phaseOf = (o: any): TabKey => {
  const subs = o.sub_orders || []
  if (subs.length > 0 && subs.every((s: any) => s.status === 'PAYMENT_PENDING')) return 'upcoming'
  if (subs.length > 0 && subs.every((s: any) => TERMINAL_SUB.includes(s.status))) return 'completed'
  return 'purchasing'
}
const tabCount = (k: TabKey) => orders.value.filter((o) => phaseOf(o) === k).length
const filteredOrders = computed(() => orders.value.filter((o) => phaseOf(o) === activeTab.value))
const allUnpaid = (o: any) => (o.sub_orders || []).length > 0 && (o.sub_orders || []).every((s: any) => s.status === 'PAYMENT_PENDING')
const anyDelivered = (o: any) => (o.sub_orders || []).some((s: any) => s.status === 'DELIVERED')
const anyTracking = (o: any) => (o.sub_orders || []).some((s: any) => s.tracking_number)
const repurchasable = (o: any) => (o.sub_orders || []).some((s: any) => ['DELIVERED', 'PURCHASE_CONFIRMED'].includes(s.status))
const orderStatus = (o: any) => paymentStatusLabel(o.payment_status || '')
const subStatus = (s: string) => subOrderStatusLabel(s || '')

async function loadOrders() {
  loading.value = true
  loadError.value = ''
  page.value = 0
  orders.value = []
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/orders?per_page=20&page=1`, { headers: { ...authHeader() } })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.success === false) throw new Error(json.error || json.message || '주문 목록을 불러오지 못했습니다.')
    orders.value = Array.isArray(json.data) ? json.data : []
    page.value = 1
    totalPages.value = Number(json.pagination?.total_pages || 1)
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '주문 목록을 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loadingMore.value || page.value >= totalPages.value) return
  loadingMore.value = true
  try {
    const next = page.value + 1
    const res = await fetch(`${API_BASE_URL}/api/v1/orders?per_page=20&page=${next}`, { headers: { ...authHeader() } })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.success === false) throw new Error(json.error || json.message || '주문 목록을 불러오지 못했습니다.')
    orders.value = orders.value.concat(Array.isArray(json.data) ? json.data : [])
    page.value = next
    totalPages.value = Number(json.pagination?.total_pages || next)
  } catch (e: any) {
    actionMsg.value = userErrorMessage(e, '주문 목록을 불러오지 못했습니다.')
  } finally {
    loadingMore.value = false
  }
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    copyToast.value = text
    setTimeout(() => { copyToast.value = '' }, 2000)
  })
}

// SAME_OPTIONS: repurchase re-adds the exact ordered SKUs (same options, same
// quantities) through the cart store; checkout re-prices and re-checks stock.
function repurchase(order: any) {
  let added = 0
  for (const it of order.items || []) {
    if (!it.sku_id) continue
    const ok = cart.addItem(
      { id: it.product_id, partner_id: it.partner_id, title: it.product_title, thumbnail_url: it.thumbnail_url, lowest_sale_price: it.unit_price },
      { id: it.sku_id, sale_price: it.unit_price, stock_quantity: null },
      Number(it.quantity || 1)
    )
    if (ok) added += 1
  }
  if (added > 0) {
    actionMsg.value = `재구매 상품 ${added}건을 장바구니에 담았습니다.`
    router.push('/cart')
  } else {
    actionMsg.value = '재구매할 수 있는 상품이 없습니다.'
  }
}

function openCancelModal(order: any) {
  orderToCancel.value = order
  showCancelModal.value = true
}

async function confirmCancel() {
  if (!orderToCancel.value || isCancelling.value) return
  isCancelling.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/orders/${orderToCancel.value.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() }
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok && json.success !== false) {
      actionMsg.value = json.refund
        ? `주문이 취소되었습니다. 환불: 결제수단 ${locale.formatPrice(json.refund.pg_amount || 0)} · 적립금 ${locale.formatPrice(json.refund.credit_amount || 0)}`
        : '결제 전 주문이 취소되었습니다.'
      showCancelModal.value = false
      orderToCancel.value = null
      await loadOrders()
    } else {
      actionMsg.value = json.error || json.message || '취소하지 못했습니다.'
    }
  } catch (e: any) {
    actionMsg.value = userErrorMessage(e, '취소하지 못했습니다.')
  } finally {
    isCancelling.value = false
  }
}

const confirmPurchase = async (orderId: string) => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/orders/${orderId}/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeader()
      }
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok && json.success) {
      actionMsg.value = `구매확정 완료 · 적립금 ${locale.formatPrice(json.reward_credit || 0)} 지급`
      await loadOrders()
    } else {
      actionMsg.value = json.error || '구매확정하지 못했습니다.'
    }
  } catch (e: any) {
    actionMsg.value = userErrorMessage(e, '구매확정하지 못했습니다.')
  }
}

function openTracking(order: any) {
  router.push(`/orders/${order.id}`)
}

onMounted(loadOrders)
</script>

<template>
  <div class="max-w-[1080px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
    <div>
      <h1 class="text-xl font-black text-gray-900">주문 내역</h1>
      <p class="text-xs text-gray-500 mt-1">결제 후 30일 내 판매가 인하 시 차액 적립 · 수령 후 7일 내 반품 신청</p>
    </div>

    <div v-if="actionMsg" role="status" class="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center justify-between">
      <span>{{ actionMsg }}</span>
      <button @click="actionMsg = ''" class="text-emerald-600 hover:text-emerald-800">✕</button>
    </div>

    <div class="flex items-center gap-2" role="tablist" aria-label="주문 단계">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        role="tab"
        :aria-selected="activeTab === tab.key"
        @click="activeTab = tab.key"
        :class="[
          'px-4 py-2 rounded-full text-xs font-black transition',
          activeTab === tab.key ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-400'
        ]"
      >
        {{ tab.label }} {{ tabCount(tab.key) }}
      </button>
    </div>

    <div v-if="loading" class="bg-white rounded-2xl border border-gray-200 p-8"><OmSkeleton variant="rect" height="h-64" /></div>

    <div v-else-if="loadError" class="bg-white rounded-2xl border border-gray-200 p-8 text-center">
      <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center text-red-500 text-2xl">
        <TriangleAlert class="h-4 w-4" aria-hidden="true" />
      </div>
      <h3 class="text-base font-black text-gray-900 mb-1">문제가 발생했습니다. 잠시 후 다시 시도해주세요.</h3>
      <p class="text-xs text-gray-500 mb-5">{{ loadError }}</p>
      <button
        @click="loadOrders"
        class="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gray-900 hover:bg-[#FF5000] text-white text-xs font-black shadow-md transition"
      >
        <RotateCw class="h-4 w-4" aria-hidden="true" />
        <span>다시 시도</span>
      </button>
    </div>

    <div v-else-if="filteredOrders.length > 0" class="space-y-5">
      <div
        v-for="order in filteredOrders"
        :key="order.id"
        class="bg-white rounded-2xl border border-gray-200 overflow-hidden"
      >
        <div class="bg-gray-50 px-5 py-3 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="px-2.5 py-0.5 text-[11px] font-black rounded-full bg-slate-100 text-slate-700">
              {{ orderStatus(order) }}
            </span>
            <span class="font-mono font-bold text-xs text-gray-900">#{{ order.order_no || order.id }}</span>
            <button @click="copyText(order.order_no || order.id)" title="주문번호 복사" class="text-gray-400 hover:text-[#FF5000]">
              <Check v-if="copyToast === (order.order_no || order.id)" class="h-4 w-4 text-emerald-600" aria-hidden="true" /><Copy v-else class="h-4 w-4" aria-hidden="true" />
            </button>
            <span class="text-xs text-gray-400 hidden sm:inline">{{ order.created_at }}</span>
          </div>
          <div class="text-sm font-black text-gray-900">
            {{ locale.formatPrice(order.total_pay_amount || order.total_amount || 0) }}
          </div>
        </div>

        <div class="p-5 divide-y divide-gray-100">
          <div
            v-for="(item, idx) in (order.items || [])"
            :key="item.id || idx"
            class="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div class="flex items-start gap-3 flex-1 min-w-0">
              <OmImage
                :src="item.thumbnail_url"
                :alt="item.product_title"
                ratio="w-16 h-16 shrink-0 rounded-xl border border-gray-200"
              />
              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex items-center gap-2">
                  <span v-if="item.partner_name" class="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    {{ item.partner_name }}
                  </span>
                  <span v-if="item.status" class="text-[11px] font-bold text-slate-600">
                    {{ subStatus(item.status) }}
                  </span>
                </div>
                <RouterLink
                  :to="item.product_id ? `/product/${item.product_id}` : `/orders/${order.id}`"
                  class="font-black text-xs sm:text-sm text-gray-900 hover:text-[#FF5000] line-clamp-2 transition"
                >
                  {{ item.product_title }}
                </RouterLink>
                <div class="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span class="bg-orange-50 text-[#FF5000] px-2 py-0.5 rounded text-[11px] font-medium">
                    옵션: {{ item.option_summary || '기본 표준형' }}
                  </span>
                  <span class="font-bold text-gray-700">x {{ item.quantity }}개</span>
                  <span class="font-bold text-gray-900">{{ locale.formatPrice(item.unit_price) }}</span>
                </div>
                <div v-if="item.tracking_number" class="pt-1 flex items-center gap-2 text-xs">
                  <span class="text-sky-700 font-bold bg-sky-50 px-2 py-0.5 rounded border border-sky-100 text-[11px]">
                    {{ item.carrier || '택배사 미정' }} {{ item.tracking_number }}
                  </span>
                  <button
                    @click="openTracking(order)"
                    class="text-[11px] font-bold text-sky-600 hover:underline cursor-pointer"
                  >
                    배송추적 →
                  </button>
                </div>
              </div>
            </div>

            <div
              v-if="['CONFIRMED', 'DELIVERED', 'COMPLETED'].includes(order.payment_status) && item.product_id"
              class="self-start sm:self-center shrink-0"
            >
              <RouterLink
                :to="`/product/${item.product_id}#reviews`"
                class="px-3 py-1.5 rounded-xl border border-gray-300 hover:border-[#FF5000] text-gray-700 hover:text-[#FF5000] text-xs font-bold transition inline-flex items-center gap-1"
              >
                <Pencil class="h-4 w-4 text-[#FF5000]" aria-hidden="true" />
                <span>리뷰 쓰기</span>
              </RouterLink>
            </div>
          </div>

          <div v-if="!order.items || order.items.length === 0" class="py-3 text-xs text-gray-500">
            주문 품목 세부 정보는 상세 조회 페이지에서 확인할 수 있습니다.
          </div>
        </div>

        <div class="bg-gray-50 px-5 py-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <div class="text-[11px] text-gray-500 flex items-center gap-1.5">
            <ShieldCheck class="h-4 w-4 text-[#00A862]" aria-hidden="true" />
            <span>결제 후 30일 내 판매가 인하 시 차액 적립 · 수령 후 7일 내 반품 신청</span>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button
              v-if="allUnpaid(order)"
              @click="openCancelModal(order)"
              class="px-3.5 py-1.5 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-100 text-xs font-bold transition cursor-pointer"
            >
              주문 취소
            </button>

            <button
              v-if="anyDelivered(order)"
              @click="confirmPurchase(order.id)"
              class="px-4 py-1.5 rounded-full bg-orange-50 text-[#FF5000] hover:bg-[#FF5000] hover:text-white border border-orange-200 text-xs font-black transition cursor-pointer inline-flex items-center gap-1"
            >
              <Coins class="h-4 w-4" aria-hidden="true" />
              <span>구매확정 (+1% 적립)</span>
            </button>

            <button
              v-if="anyTracking(order)"
              @click="openTracking(order)"
              class="px-3.5 py-1.5 rounded-full bg-sky-50 text-sky-700 hover:bg-sky-600 hover:text-white border border-sky-200 text-xs font-bold transition cursor-pointer inline-flex items-center gap-1"
            >
              <Truck class="h-4 w-4" aria-hidden="true" />
              <span>배송 조회</span>
            </button>

            <button
              v-if="repurchasable(order)"
              @click="repurchase(order)"
              class="px-3.5 py-1.5 rounded-full border border-gray-300 text-gray-700 hover:border-[#FF5000] hover:text-[#FF5000] text-xs font-bold transition cursor-pointer inline-flex items-center gap-1"
            >
              <Repeat class="h-4 w-4" aria-hidden="true" />
              <span>재구매</span>
            </button>

            <RouterLink
              :to="`/orders/${order.id}`"
              class="px-4 py-1.5 rounded-full bg-gray-900 hover:bg-[#FF5000] text-white text-xs font-bold transition text-center inline-flex items-center gap-1"
            >
              <span>상세 조회 / 보상·반품 신청</span>
              <ChevronRight class="h-3 w-3" aria-hidden="true" />
            </RouterLink>
          </div>
        </div>
      </div>

      <div v-if="page < totalPages" class="text-center">
        <button
          @click="loadMore"
          :disabled="loadingMore"
          class="px-6 py-2.5 rounded-full border border-gray-300 text-gray-700 hover:border-gray-500 text-xs font-bold transition disabled:opacity-50"
        >
          {{ loadingMore ? '불러오는 중...' : '더보기 (20개씩)' }}
        </button>
      </div>
    </div>

    <div
      v-if="showCancelModal && orderToCancel"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-label="주문 취소 신청"
    >
      <div class="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 border border-gray-100">
        <div class="flex items-center justify-between border-b border-gray-100 pb-3">
          <h3 class="font-black text-base text-gray-900">주문 취소 신청</h3>
          <button @click="showCancelModal = false" class="text-gray-400 hover:text-gray-600 p-1">✕</button>
        </div>

        <div class="space-y-3 text-xs">
          <p class="text-gray-600">
            주문번호 <span class="font-mono font-bold text-gray-900">#{{ orderToCancel.order_no || orderToCancel.id }}</span> 취소를 진행하시겠습니까?
          </p>

          <div class="p-3.5 bg-gray-50 rounded-xl border border-gray-200 space-y-1.5">
            <div class="flex justify-between text-gray-500">
              <span>상품 금액</span>
              <span>{{ locale.formatPrice(orderToCancel.total_goods_amount || 0) }}</span>
            </div>
            <div class="flex justify-between text-gray-500">
              <span>배송비</span>
              <span>{{ locale.formatPrice(orderToCancel.total_shipping_amount || 0) }}</span>
            </div>
            <div v-if="orderToCancel.total_discount_amount" class="flex justify-between text-[#FF5000]">
              <span>할인 적용액</span>
              <span>-{{ locale.formatPrice(orderToCancel.total_discount_amount) }}</span>
            </div>
            <div class="flex justify-between font-black text-sm text-gray-900 pt-2 border-t border-gray-200">
              <span>최종 환불 예정액</span>
              <span class="text-[#FF5000]">{{ locale.formatPrice(orderToCancel.total_pay_amount || 0) }}</span>
            </div>
          </div>

          <p class="text-[11px] text-gray-400">
            * 결제 전 주문은 즉시 취소되며, 예약된 재고가 자동 원복됩니다.
          </p>
        </div>

        <div class="flex items-center gap-2 pt-2 border-t border-gray-100">
          <button
            @click="showCancelModal = false"
            class="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-bold text-xs hover:bg-gray-50 cursor-pointer"
          >
            돌아가기
          </button>
          <button
            @click="confirmCancel"
            :disabled="isCancelling"
            class="flex-1 py-2.5 rounded-xl bg-gray-900 hover:bg-black text-white font-bold text-xs disabled:opacity-50 cursor-pointer"
          >
            {{ isCancelling ? '취소 처리 중...' : '확인 (주문 취소)' }}
          </button>
        </div>
      </div>
    </div>

    <OmEmptyState
      v-else-if="filteredOrders.length === 0"
      title="해당 탭에 표시할 주문 내역이 없습니다."
      description="올모아 초특가 상품을 둘러보고 첫 주문을 시작해 보세요."
    >
      <RouterLink
        to="/"
        class="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#FF5000] hover:bg-[#e04700] text-white text-xs font-black shadow-md transition transform active:scale-95"
      >
        <ShoppingCart class="h-4 w-4" aria-hidden="true" />
        <span>인기 특가 쇼핑하러 가기</span>
      </RouterLink>
    </OmEmptyState>
  </div>
</template>
