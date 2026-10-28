<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const auth = useAuthStore()
const locale = useLocaleStore()

interface OrderItem {
  id: string
  sub_order_id: string
  sku_id: string
  product_id?: string
  product_title: string
  option_summary: string
  unit_price: number
  quantity: number
  total_price: number
  thumbnail_url?: string
  carrier?: string
  tracking_number?: string
  status?: string
  partner_name?: string
  partner_id?: string
}

interface Order {
  id: string
  order_no: string
  customer_id: string
  total_goods_amount: number
  total_shipping_amount: number
  total_discount_amount: number
  total_pay_amount: number
  total_amount?: number
  currency: string
  payment_status: string
  recipient_name: string
  recipient_phone: string
  shipping_address_line1: string
  shipping_address_line2?: string
  shipping_postal_code: string
  shipping_memo?: string
  created_at: string
  sub_orders?: any[]
  items?: OrderItem[]
}

const orders = ref<Order[]>([])
const loading = ref(true)
const actionMsg = ref('')
const copyToast = ref('')
const searchQuery = ref('')
const activeTab = ref<'ALL' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'>('ALL')

// Cancel Modal State
const showCancelModal = ref(false)
const orderToCancel = ref<Order | null>(null)
const cancelReason = ref('단순 변심 (다른 상품 재주문)')
const isCancelling = ref(false)

// Tracking Modal State
const showTrackingModal = ref(false)
const trackingItem = ref<{
  orderNo: string
  carrier: string
  trackingNumber: string
  productTitle: string
  status: string
} | null>(null)

const cancelReasons = [
  '단순 변심 (다른 상품 재주문)',
  '배송지 주소 또는 연락처 오입력',
  '상품 옵션 (색상/사이즈) 변경 희망',
  '배송 지연 예상으로 취소',
  '할인 쿠폰 또는 결제수단 변경 후 재주문',
  '기타 사유'
]

const loadOrders = async () => {
  loading.value = true
  try {
    const cid = auth.user?.id || 'cust_demo_001'
    const res = await fetch(`${API_BASE_URL}/api/v1/orders?customer_id=${encodeURIComponent(cid)}`, {
      headers: { 'X-Customer-Id': cid }
    })
    const json = await res.json()
    if (json.success && Array.isArray(json.data)) {
      orders.value = json.data
    }
  } catch (e) {
    console.error('Failed to load customer orders:', e)
  } finally {
    loading.value = false
  }
}

const filteredOrders = computed(() => {
  let list = orders.value

  // Status Tab Filtering
  if (activeTab.value === 'PROCESSING') {
    list = list.filter(o => ['PAID', 'PREPARING'].includes(o.payment_status))
  } else if (activeTab.value === 'SHIPPED') {
    list = list.filter(o => ['SHIPPED', 'IN_TRANSIT'].includes(o.payment_status))
  } else if (activeTab.value === 'DELIVERED') {
    list = list.filter(o => ['DELIVERED', 'CONFIRMED', 'COMPLETED', 'PURCHASE_CONFIRMED'].includes(o.payment_status))
  } else if (activeTab.value === 'CANCELLED') {
    list = list.filter(o => ['CANCELLED', 'RETURNED', 'REFUNDED'].includes(o.payment_status))
  }

  // Keyword Search
  const query = searchQuery.value.trim().toLowerCase()
  if (query) {
    list = list.filter(o => {
      const matchOrderNo = (o.order_no || o.id).toLowerCase().includes(query)
      const matchItems = (o.items || []).some(it =>
        (it.product_title || '').toLowerCase().includes(query) ||
        (it.option_summary || '').toLowerCase().includes(query)
      )
      return matchOrderNo || matchItems
    })
  }

  return list
})

const counts = computed(() => {
  return {
    ALL: orders.value.length,
    PROCESSING: orders.value.filter(o => ['PAID', 'PREPARING'].includes(o.payment_status)).length,
    SHIPPED: orders.value.filter(o => ['SHIPPED', 'IN_TRANSIT'].includes(o.payment_status)).length,
    DELIVERED: orders.value.filter(o => ['DELIVERED', 'CONFIRMED', 'COMPLETED', 'PURCHASE_CONFIRMED'].includes(o.payment_status)).length,
    CANCELLED: orders.value.filter(o => ['CANCELLED', 'RETURNED', 'REFUNDED'].includes(o.payment_status)).length
  }
})

function openCancelModal(order: Order) {
  orderToCancel.value = order
  cancelReason.value = cancelReasons[0]
  showCancelModal.value = true
}

async function confirmCancel() {
  if (!orderToCancel.value) return
  isCancelling.value = true
  const cid = auth.user?.id || 'cust_demo_001'
  const ordId = orderToCancel.value.id

  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/orders/${ordId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Customer-Id': cid },
      body: JSON.stringify({ reason: cancelReason.value })
    })
    const json = await res.json()
    if (json.success) {
      actionMsg.value = `✓ 주문(#${orderToCancel.value.order_no || ordId})이 취소되었습니다. 환불 및 재고 원복이 완료되었습니다.`
      showCancelModal.value = false
      orderToCancel.value = null
      await loadOrders()
    } else {
      actionMsg.value = `⚠️ 취소 실패: ${json.error}`
    }
  } catch (e) {
    actionMsg.value = '⚠️ 취소 요청 중 네트워크 오류가 발생했습니다.'
  } finally {
    isCancelling.value = false
  }
}

const confirmPurchase = async (orderId: string) => {
  const cid = auth.user?.id || 'cust_demo_001'
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/orders/${orderId}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Customer-Id': cid }
    })
    const json = await res.json()
    if (json.success) {
      actionMsg.value = `🎉 구매확정이 완료되었습니다! +₩${Number(json.data.reward_credit || 0).toLocaleString()} (1%) 올모아 적립금이 지급되었습니다.`
      await loadOrders()
    }
  } catch (e) {
    console.error(e)
  }
}

function openTracking(order: Order, item?: OrderItem) {
  trackingItem.value = {
    orderNo: order.order_no || order.id,
    carrier: item?.carrier || 'CJ대한통운',
    trackingNumber: item?.tracking_number || '68492019342',
    productTitle: item?.product_title || '주문 상품',
    status: item?.status || order.payment_status
  }
  showTrackingModal.value = true
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    copyToast.value = text
    setTimeout(() => {
      copyToast.value = ''
    }, 2000)
  })
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'PAID':
    case 'PREPARING':
      return { label: '결제완료 (상품준비)', class: 'bg-amber-50 text-amber-700 border-amber-200' }
    case 'SHIPPED':
    case 'IN_TRANSIT':
      return { label: '배송중 (출고완료)', class: 'bg-sky-50 text-sky-700 border-sky-200' }
    case 'DELIVERED':
      return { label: '배송완료', class: 'bg-teal-50 text-teal-700 border-teal-200' }
    case 'CONFIRMED':
    case 'COMPLETED':
    case 'PURCHASE_CONFIRMED':
      return { label: '구매확정 (+1% 적립)', class: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    case 'CANCELLED':
      return { label: '주문취소 (환불완료)', class: 'bg-rose-50 text-rose-700 border-rose-200' }
    case 'RETURNED':
    case 'REFUNDED':
      return { label: '반품/환불완료', class: 'bg-purple-50 text-purple-700 border-purple-200' }
    default:
      return { label: status, class: 'bg-gray-50 text-gray-700 border-gray-200' }
  }
}

onMounted(loadOrders)
</script>

<template>
  <div class="max-w-[1100px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
    <!-- Header Title & Quick Access -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 pb-5">
      <div>
        <h1 class="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight flex items-center gap-2">
          <span>📦 나의 주문 내역</span>
          <span class="text-xs px-2.5 py-1 rounded-full bg-orange-100 text-[#FF5000] font-black">
            30일 최저가 보상 & 90일 안심반품
          </span>
        </h1>
        <p class="text-xs sm:text-sm text-gray-500 mt-1">
          실시간 배송 조회, 구매확정(+1% 올모아 적립금 지급), 1초 원클릭 주문취소 및 반품 신청을 이용하실 수 있습니다.
        </p>
      </div>
      <div class="flex items-center gap-2 self-start sm:self-auto">
        <RouterLink
          to="/addresses"
          class="text-xs font-bold text-gray-700 hover:text-[#FF5000] px-3.5 py-2 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 shadow-xs transition inline-flex items-center gap-1.5"
        >
          <i class="fa-solid fa-location-dot text-[#FF5000]"></i>
          <span>배송지 관리</span>
        </RouterLink>
        <RouterLink
          to="/coupons"
          class="text-xs font-bold text-[#FF5000] hover:text-white hover:bg-[#FF5000] px-3.5 py-2 rounded-xl border border-orange-300 bg-orange-50 shadow-xs transition inline-flex items-center gap-1.5"
        >
          <i class="fa-solid fa-ticket"></i>
          <span>쿠폰·적립금</span>
        </RouterLink>
      </div>
    </div>

    <!-- Alert / Action Toast -->
    <div
      v-if="actionMsg"
      class="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-[#00A862] flex items-center justify-between shadow-xs animate-fade-in"
    >
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-circle-check text-base"></i>
        <span>{{ actionMsg }}</span>
      </div>
      <button @click="actionMsg = ''" class="text-emerald-700 hover:text-emerald-900 font-bold p-1">✕</button>
    </div>

    <!-- Filter Tabs & Search Bar -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-gray-200/90 shadow-xs">
      <!-- Horizontal Scrollable Tabs -->
      <div class="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
        <button
          @click="activeTab = 'ALL'"
          :class="[
            'px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer shrink-0',
            activeTab === 'ALL'
              ? 'bg-[#FF5000] text-white shadow-xs'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          ]"
        >
          전체 ({{ counts.ALL }})
        </button>
        <button
          @click="activeTab = 'PROCESSING'"
          :class="[
            'px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer shrink-0',
            activeTab === 'PROCESSING'
              ? 'bg-[#FF5000] text-white shadow-xs'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          ]"
        >
          결제완료/준비 ({{ counts.PROCESSING }})
        </button>
        <button
          @click="activeTab = 'SHIPPED'"
          :class="[
            'px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer shrink-0',
            activeTab === 'SHIPPED'
              ? 'bg-[#FF5000] text-white shadow-xs'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          ]"
        >
          배송중 ({{ counts.SHIPPED }})
        </button>
        <button
          @click="activeTab = 'DELIVERED'"
          :class="[
            'px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer shrink-0',
            activeTab === 'DELIVERED'
              ? 'bg-[#FF5000] text-white shadow-xs'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          ]"
        >
          배송완료/구매확정 ({{ counts.DELIVERED }})
        </button>
        <button
          @click="activeTab = 'CANCELLED'"
          :class="[
            'px-3.5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap cursor-pointer shrink-0',
            activeTab === 'CANCELLED'
              ? 'bg-[#FF5000] text-white shadow-xs'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          ]"
        >
          취소/반품/환불 ({{ counts.CANCELLED }})
        </button>
      </div>

      <!-- Instant Search Filter Input -->
      <div class="relative w-full md:w-72">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="주문번호 또는 상품명 검색..."
          class="w-full pl-9 pr-8 py-2 rounded-xl border border-gray-300 text-xs focus:ring-2 focus:ring-[#FF5000] focus:border-[#FF5000] outline-none"
        />
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-gray-400 text-xs"></i>
        <button
          v-if="searchQuery"
          @click="searchQuery = ''"
          class="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600 text-xs"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- Loading Skeleton -->
    <div v-if="loading" class="space-y-4">
      <div v-for="n in 3" :key="n" class="h-44 bg-white rounded-2xl border border-gray-200 animate-pulse p-6"></div>
    </div>

    <!-- Empty State -->
    <div v-else-if="filteredOrders.length === 0" class="bg-white rounded-3xl p-12 text-center border border-gray-200 shadow-xs">
      <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-orange-50 flex items-center justify-center text-[#FF5000] text-2xl">
        <i class="fa-solid fa-box-open"></i>
      </div>
      <h3 class="text-base font-black text-gray-900 mb-1">
        {{ searchQuery ? `'${searchQuery}' 검색 조건에 맞는 주문이 없습니다.` : '해당 탭에 표시할 주문 내역이 없습니다.' }}
      </h3>
      <p class="text-xs text-gray-500 mb-5">올모아 공장 직발송 초특가 상품을 둘러보고 첫 주문을 시작해 보세요.</p>
      <RouterLink
        to="/"
        class="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#FF5000] hover:bg-[#e04700] text-white text-xs font-black shadow-md transition transform active:scale-95"
      >
        <i class="fa-solid fa-cart-shopping"></i>
        <span>인기 특가 쇼핑하러 가기</span>
      </RouterLink>
    </div>

    <!-- Orders Cards List -->
    <div v-else class="space-y-5">
      <div
        v-for="order in filteredOrders"
        :key="order.id"
        class="bg-white rounded-3xl border border-gray-200/90 hover:border-[#FF5000] transition-all shadow-xs overflow-hidden"
      >
        <!-- Card Header -->
        <div class="bg-gray-50/80 px-5 py-3.5 border-b border-gray-200/80 flex flex-wrap items-center justify-between gap-2.5">
          <div class="flex items-center gap-3">
            <span
              :class="[
                'px-2.5 py-0.5 text-[11px] font-black rounded-full border',
                getStatusBadge(order.payment_status).class
              ]"
            >
              {{ getStatusBadge(order.payment_status).label }}
            </span>
            <div class="flex items-center gap-1.5 text-xs text-gray-600 font-mono">
              <span class="font-bold text-gray-900">#{{ order.order_no || order.id }}</span>
              <button
                @click="copyText(order.order_no || order.id)"
                title="주문번호 복사"
                class="text-gray-400 hover:text-[#FF5000] text-[11px]"
              >
                <i :class="copyToast === (order.order_no || order.id) ? 'fa-solid fa-check text-emerald-600' : 'fa-regular fa-copy'"></i>
              </button>
            </div>
            <span class="text-xs text-gray-400 hidden sm:inline">•</span>
            <span class="text-xs text-gray-400 hidden sm:inline">{{ new Date(order.created_at).toLocaleString() }}</span>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-xs text-gray-500">결제금액:</span>
            <span class="text-base font-black text-gray-900">
              {{ locale.formatPrice(order.total_pay_amount || order.total_amount || 0) }}
            </span>
            <span class="text-[11px] px-2 py-0.5 rounded bg-gray-200/60 text-gray-600 font-medium">
              {{ order.currency || 'KRW' }}
            </span>
          </div>
        </div>

        <!-- Card Body: Items List -->
        <div class="p-5 divide-y divide-gray-100">
          <!-- When items exist -->
          <div
            v-for="(item, idx) in (order.items || [])"
            :key="item.id || idx"
            class="py-3.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <!-- Product Thumbnail & Details -->
            <div class="flex items-start gap-3.5 flex-1 min-w-0">
              <img
                :src="item.thumbnail_url || 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=160'"
                :alt="item.product_title"
                class="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover bg-gray-100 shrink-0 border border-gray-200"
                loading="lazy"
              />
              <div class="min-w-0 flex-1 space-y-1">
                <div class="flex items-center gap-2">
                  <span v-if="item.partner_name" class="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                    {{ item.partner_name }}
                  </span>
                  <span
                    v-if="item.status"
                    class="text-[10px] font-black uppercase text-[#00A862]"
                  >
                    {{ item.status === 'SHIPPED' ? '배송중' : '' }}
                  </span>
                </div>
                <RouterLink
                  :to="item.product_id ? `/product/${item.product_id}` : `/orders/${order.id}`"
                  class="font-black text-xs sm:text-sm text-gray-900 hover:text-[#FF5000] line-clamp-2 transition"
                >
                  {{ item.product_title }}
                </RouterLink>
                <div class="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span class="bg-orange-50/80 text-[#FF5000] px-2 py-0.5 rounded text-[11px] font-medium">
                    옵션: {{ item.option_summary || '기본 표준형' }}
                  </span>
                  <span class="font-bold text-gray-700">x {{ item.quantity }}개</span>
                  <span class="font-bold text-gray-900">{{ locale.formatPrice(item.unit_price) }}</span>
                </div>

                <!-- If tracking number exists for this item -->
                <div v-if="item.tracking_number" class="pt-1 flex items-center gap-2 text-xs">
                  <span class="text-sky-700 font-bold bg-sky-50 px-2 py-0.5 rounded border border-sky-100 text-[11px]">
                    🚚 {{ item.carrier || 'CJ대한통운' }} {{ item.tracking_number }}
                  </span>
                  <button
                    @click="openTracking(order, item)"
                    class="text-[11px] font-bold text-sky-600 hover:underline cursor-pointer"
                  >
                    배송추적 →
                  </button>
                </div>
              </div>
            </div>

            <!-- Single Item Review Link if Order Confirmed -->
            <div
              v-if="['CONFIRMED', 'DELIVERED', 'COMPLETED'].includes(order.payment_status) && item.product_id"
              class="self-start sm:self-center shrink-0"
            >
              <RouterLink
                :to="`/product/${item.product_id}#reviews`"
                class="px-3 py-1.5 rounded-xl border border-gray-300 hover:border-[#FF5000] text-gray-700 hover:text-[#FF5000] text-xs font-bold transition inline-flex items-center gap-1"
              >
                <i class="fa-solid fa-pen-to-square text-[#FF5000]"></i>
                <span>리뷰 쓰기 (+100P)</span>
              </RouterLink>
            </div>
          </div>

          <!-- Fallback when items array is empty -->
          <div v-if="!order.items || order.items.length === 0" class="py-3 text-xs text-gray-500 flex items-center justify-between">
            <div>
              <p class="font-bold text-gray-800">주문 품목 세부 정보</p>
              <p class="text-[11px] text-gray-400 mt-0.5">상세 조회 페이지에서 전체 패킹 내역을 확인하실 수 있습니다.</p>
            </div>
            <div class="text-sm font-black text-gray-900">
              {{ locale.formatPrice(order.total_pay_amount || order.total_amount || 0) }}
            </div>
          </div>
        </div>

        <!-- Card Footer Actions Bar -->
        <div class="bg-gray-50/60 px-5 py-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <div class="text-[11px] text-gray-500 flex items-center gap-1.5">
            <i class="fa-solid fa-shield-halved text-[#00A862]"></i>
            <span>30일 최저가 차액 자동보상 & 90일 무조건 무료반품 보장</span>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <!-- Order Cancel Button (Paid or Preparing) -->
            <button
              v-if="['PAID', 'PREPARING'].includes(order.payment_status)"
              @click="openCancelModal(order)"
              class="px-3.5 py-1.5 rounded-full border border-red-200 text-[#E60023] hover:bg-red-50 text-xs font-bold transition cursor-pointer"
            >
              주문 취소
            </button>

            <!-- Confirm Purchase Button (+1% Credit) -->
            <button
              v-if="['PAID', 'SHIPPED', 'DELIVERED'].includes(order.payment_status)"
              @click="confirmPurchase(order.id)"
              class="px-4 py-1.5 rounded-full bg-orange-50 text-[#FF5000] hover:bg-[#FF5000] hover:text-white border border-orange-200 text-xs font-black transition cursor-pointer inline-flex items-center gap-1"
            >
              <i class="fa-solid fa-coins"></i>
              <span>구매확정 (+1% 적립)</span>
            </button>

            <!-- Quick Tracking Button -->
            <button
              v-if="['SHIPPED', 'IN_TRANSIT', 'DELIVERED'].includes(order.payment_status)"
              @click="openTracking(order)"
              class="px-3.5 py-1.5 rounded-full bg-sky-50 text-sky-700 hover:bg-sky-600 hover:text-white border border-sky-200 text-xs font-bold transition cursor-pointer inline-flex items-center gap-1"
            >
              <i class="fa-solid fa-truck"></i>
              <span>배송 조회</span>
            </button>

            <!-- Detail / Claims / Return Portal Link -->
            <RouterLink
              :to="`/orders/${order.id}`"
              class="px-4 py-1.5 rounded-full bg-gray-900 hover:bg-[#FF5000] text-white text-xs font-bold transition text-center shadow-xs inline-flex items-center gap-1"
            >
              <span>상세 조회 / 보상·반품 신청</span>
              <i class="fa-solid fa-chevron-right text-[10px]"></i>
            </RouterLink>
          </div>
        </div>
      </div>
    </div>

    <!-- 1. Cancel Order Confirmation Modal -->
    <div
      v-if="showCancelModal && orderToCancel"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in"
    >
      <div class="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-gray-100">
        <div class="flex items-center justify-between border-b border-gray-100 pb-3">
          <div class="flex items-center gap-2 text-rose-600 font-black text-lg">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <h3>주문 취소 신청</h3>
          </div>
          <button @click="showCancelModal = false" class="text-gray-400 hover:text-gray-600 p-1">✕</button>
        </div>

        <div class="space-y-3 text-xs">
          <p class="text-gray-600">
            주문번호 <span class="font-mono font-bold text-gray-900">#{{ orderToCancel.order_no || orderToCancel.id }}</span> 취소를 진행하시겠습니까?
          </p>

          <div class="p-3.5 bg-gray-50 rounded-2xl border border-gray-200/80 space-y-1.5">
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

          <div>
            <label class="block font-bold text-gray-700 mb-1.5">취소 사유 선택</label>
            <select
              v-model="cancelReason"
              class="w-full border border-gray-300 rounded-xl px-3 py-2 text-xs bg-white focus:ring-2 focus:ring-[#FF5000] outline-none"
            >
              <option v-for="r in cancelReasons" :key="r" :value="r">{{ r }}</option>
            </select>
          </div>

          <p class="text-[11px] text-gray-400">
            * 즉시 주문 취소 처리되며 결제하신 수단으로 자동 환불 및 예약된 재고가 자동 원복됩니다.
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
            class="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md disabled:opacity-50 cursor-pointer"
          >
            {{ isCancelling ? '취소 처리 중...' : '확인 (주문 취소)' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 2. Delivery Tracking Modal -->
    <div
      v-if="showTrackingModal && trackingItem"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in"
    >
      <div class="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-gray-100">
        <div class="flex items-center justify-between border-b border-gray-100 pb-3">
          <div class="flex items-center gap-2 text-sky-700 font-black text-lg">
            <i class="fa-solid fa-truck-fast"></i>
            <h3>실시간 배송 조회</h3>
          </div>
          <button @click="showTrackingModal = false" class="text-gray-400 hover:text-gray-600 p-1">✕</button>
        </div>

        <div class="space-y-4 text-xs">
          <div class="p-3 bg-sky-50 rounded-2xl border border-sky-100 space-y-1">
            <div class="flex items-center justify-between font-mono font-bold text-sky-950">
              <span>{{ trackingItem.carrier }}</span>
              <div class="flex items-center gap-1.5">
                <span>{{ trackingItem.trackingNumber }}</span>
                <button
                  @click="copyText(trackingItem.trackingNumber)"
                  class="px-1.5 py-0.5 rounded bg-white border border-sky-200 text-[10px] text-sky-800 hover:bg-sky-100"
                >
                  {{ copyToast === trackingItem.trackingNumber ? '✓ 복사완료' : '복사' }}
                </button>
              </div>
            </div>
            <p class="text-slate-600 text-[11px] truncate">품목: {{ trackingItem.productTitle }}</p>
          </div>

          <!-- Tracking Timeline Steps -->
          <div class="space-y-3 py-2">
            <div class="flex items-center gap-3">
              <span class="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs">✓</span>
              <div>
                <p class="font-bold text-gray-900">결제 완료 및 판매자 주문 접수</p>
                <p class="text-[10px] text-gray-400">D1 실시간 원장 트랜잭션 동기화 완료</p>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span class="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs">✓</span>
              <div>
                <p class="font-bold text-gray-900">물류센터 상품 검수 및 패킹 완료</p>
                <p class="text-[10px] text-gray-400">OLMOA 직발송 안전 패킹</p>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span class="w-6 h-6 rounded-full bg-sky-500 text-white flex items-center justify-center text-xs animate-pulse">🚚</span>
              <div>
                <p class="font-bold text-sky-700">택배사 집하 및 간선 수송 중</p>
                <p class="text-[10px] text-gray-500">{{ trackingItem.carrier }} 허브 터미널 입고</p>
              </div>
            </div>
            <div class="flex items-center gap-3 opacity-60">
              <span class="w-6 h-6 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-xs">○</span>
              <div>
                <p class="font-bold text-gray-700">고객 배송지 도착 예정</p>
                <p class="text-[10px] text-gray-400">영업일 기준 1~2일 내 문 앞 배송</p>
              </div>
            </div>
          </div>
        </div>

        <div class="pt-2 border-t border-gray-100">
          <button
            @click="showTrackingModal = false"
            class="w-full py-2.5 rounded-xl bg-gray-900 hover:bg-[#FF5000] text-white font-bold text-xs shadow-md transition cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
