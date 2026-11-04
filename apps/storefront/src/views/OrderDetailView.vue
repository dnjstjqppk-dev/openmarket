<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL, authHeader } from '../config'

const route = useRoute()
const locale = useLocaleStore()
const order = ref<any>(null)
const claims = ref<any[]>([])
const loading = ref(true)
const statusBanner = ref('')
const bannerTone = ref<'ok' | 'warn'>('ok')
const copyToast = ref('')
const busy = ref(false)

const showClaimModal = ref(false)
const claimType = ref<'RETURN' | 'EXCHANGE'>('RETURN')
const claimSubOrderId = ref('')
const claimReason = ref('')
const trackingInfo = ref<any>(null)
const loadingTracking = ref(false)

const showInvoiceModal = ref(false)
const invoiceData = ref<any>(null)
const invoiceLoading = ref(false)
const invoiceError = ref<string>('')
const invoiceMissingFields = ref<string[]>([])

const STATUS_LABEL: Record<string, string> = {
  READY: '결제 대기', PAID: '결제 완료', PARTIAL_REFUNDED: '부분 환불', REFUNDED: '환불 완료', CANCELLED: '주문 취소', EXPIRED: '결제 시간 만료', FAILED: '결제 실패',
  PAYMENT_PENDING: '결제 대기', PAYMENT_CONFIRMED: '결제 완료 · 출고 준비', PREPARING: '상품 준비중', SHIPPED: '출고 완료', IN_TRANSIT: '배송중', DELIVERED: '배송 완료',
  PURCHASE_CONFIRMED: '구매 확정', RETURN_REQUESTED: '반품 요청', RETURNED: '반품 완료'
}
const label = (s: string) => STATUS_LABEL[s] || s
const won = (n: number) => `${Number(n || 0).toLocaleString('ko-KR')}원`

const subs = computed<any[]>(() => order.value?.sub_orders || [])
const canCancelWhole = computed(() => order.value && (order.value.payment_status === 'READY'
  || (['PAID', 'PARTIAL_REFUNDED'].includes(order.value.payment_status) && subs.value.every((s) => ['PAYMENT_CONFIRMED', 'PREPARING', 'CANCELLED'].includes(s.status)))))
const deliveredSubs = computed(() => subs.value.filter((s) => s.status === 'DELIVERED'))
const canPriceAdjust = computed(() => order.value && ['PAID', 'PARTIAL_REFUNDED'].includes(order.value.payment_status))

function say(msg: string, tone: 'ok' | 'warn' = 'ok') { statusBanner.value = msg; bannerTone.value = tone }

async function post(path: string, body?: any) {
  busy.value = true
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: body ? JSON.stringify(body) : undefined })
    const json = await res.json().catch(() => ({}))
    return { ok: res.ok && json.success !== false, json }
  } finally {
    busy.value = false
  }
}

const loadCommercialInvoice = async () => {
  if (!order.value) return
  invoiceLoading.value = true
  showInvoiceModal.value = true
  invoiceError.value = ''
  invoiceMissingFields.value = []
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/orders/${order.value.id}/commercial-invoice`, { headers: { ...authHeader() } })
    const json = await res.json()
    if (res.ok && json.success) invoiceData.value = json.data
    else {
      invoiceData.value = null
      invoiceError.value = json.error || '통관 인보이스를 불러올 수 없습니다.'
      if (json.missing_fields) invoiceMissingFields.value = json.missing_fields
    }
  } catch (e: any) {
    invoiceError.value = e.message || '인보이스 로딩 오류'
  } finally {
    invoiceLoading.value = false
  }
}

const loadMilestoneTracking = async (subOrderId: string) => {
  loadingTracking.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/logistics/tracking/${encodeURIComponent(subOrderId)}`, { headers: { ...authHeader() } })
    const json = await res.json()
    if (json.success) trackingInfo.value = json.data
  } finally {
    loadingTracking.value = false
  }
}

const copyTracking = (num: string) => {
  navigator.clipboard.writeText(num).then(() => {
    copyToast.value = num
    setTimeout(() => { copyToast.value = '' }, 2000)
  })
}

const loadOrderDetail = async () => {
  loading.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/orders/${route.params.id}`, { headers: { ...authHeader() } })
    const json = await res.json()
    if (json.success) {
      order.value = json.data
      claims.value = json.data.claims || []
    } else {
      say(json.error || '주문을 불러오지 못했습니다.', 'warn')
    }
  } finally {
    loading.value = false
  }
}

async function handleCancelOrder() {
  if (!order.value || !confirm('주문 전체를 취소하시겠습니까? 결제 금액은 원결제 수단으로, 사용한 적립금은 적립금으로 환불됩니다.')) return
  const { ok, json } = await post(`/api/v1/orders/${order.value.id}/cancel`)
  say(ok ? (json.refund ? `주문이 취소되었습니다. 환불: 결제수단 ${won(json.refund.pg_amount)} · 적립금 ${won(json.refund.credit_amount)}` : '결제 전 주문이 취소되었습니다.') : (json.error || '취소하지 못했습니다.'), ok ? 'ok' : 'warn')
  await loadOrderDetail()
}

async function handleCancelSub(sub: any) {
  if (!confirm(`${sub.business_name || '판매자'} 상품만 취소하시겠습니까?`)) return
  const { ok, json } = await post(`/api/v1/orders/${order.value.id}/sub-orders/${sub.id}/cancel`)
  say(ok ? `부분 취소 완료 · 환불 ${won((json.refund?.pg_amount || 0) + (json.refund?.credit_amount || 0))}` : (json.error || '취소하지 못했습니다.'), ok ? 'ok' : 'warn')
  await loadOrderDetail()
}

async function handleConfirmOrder() {
  const { ok, json } = await post(`/api/v1/orders/${order.value.id}/confirm`)
  say(ok ? (json.reward_credit > 0 ? `구매확정 완료 · 적립금 ${won(json.reward_credit)} 지급` : '구매확정이 완료되었습니다.') : (json.error || '구매확정하지 못했습니다.'), ok ? 'ok' : 'warn')
  await loadOrderDetail()
}

async function handlePriceAdjust() {
  const { ok, json } = await post(`/api/v1/orders/${order.value.id}/claims`, { type: 'PRICE_ADJUSTMENT' })
  say(ok ? `판매가 인하 차액 ${won(json.refund_amount)}이 적립금으로 지급되었습니다.` : (json.error || '보상 대상이 아닙니다.'), ok ? 'ok' : 'warn')
  await loadOrderDetail()
}

async function handleLateDeliveryClaim() {
  const { ok, json } = await post(`/api/v1/orders/${order.value.id}/late-delivery-claim`)
  say(ok ? `배송 지연 보상 ${won(json.data.compensation_amount)}이 적립금으로 지급되었습니다.` : (json.error || '보상 대상이 아닙니다.'), ok ? 'ok' : 'warn')
  await loadOrderDetail()
}

function openClaim(sub: any) {
  claimSubOrderId.value = sub.id
  claimType.value = 'RETURN'
  claimReason.value = ''
  showClaimModal.value = true
}

async function submitClaim() {
  const { ok, json } = await post(`/api/v1/orders/${order.value.id}/claims`, { type: claimType.value, sub_order_id: claimSubOrderId.value, reason: claimReason.value })
  if (ok) {
    showClaimModal.value = false
    say(claimType.value === 'RETURN' ? `반품 신청이 접수되었습니다. 예상 환불액 ${won(json.estimated_refund_amount)} (판매자 확인 후 환불)` : '교환 신청이 접수되었습니다.')
  } else {
    say(json.error || '신청하지 못했습니다.', 'warn')
  }
  await loadOrderDetail()
}

onMounted(loadOrderDetail)
</script>

<template>
  <div class="max-w-[960px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
    <RouterLink to="/orders" class="text-xs font-bold text-[#FF5000] hover:underline inline-flex items-center gap-1">
      <i class="fa-solid fa-arrow-left"></i>전체 주문 내역으로 돌아가기
    </RouterLink>

    <div v-if="statusBanner" class="p-4 rounded-xl bg-green-50 border border-green-200 text-xs font-bold text-[#00A862] flex items-center justify-between">
      <span>{{ statusBanner }}</span>
      <button @click="statusBanner = ''" class="text-green-600 hover:text-green-800">✕</button>
    </div>

    <div v-if="loading" class="bg-white rounded-2xl p-8 animate-pulse h-64"></div>

    <div v-else-if="order" class="space-y-6">
      <!-- Order header -->
      <div class="bg-white rounded-2xl p-6 border border-gray-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span class="px-2.5 py-0.5 rounded-full text-[11px] font-black" data-testid="order-status"
            :class="['PAID','PARTIAL_REFUNDED'].includes(order.payment_status) ? 'bg-emerald-50 text-emerald-700' : order.payment_status === 'READY' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'">
            {{ label(order.payment_status) }}
          </span>
          <span v-if="Number(order.is_sandbox) === 1" class="ml-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">테스트 결제</span>
          <h1 class="text-xl font-black mt-2 text-gray-900">주문번호 {{ order.order_no }}</h1>
          <p class="text-xs text-gray-500 mt-1">주문일시 {{ order.created_at }}</p>
        </div>
        <div class="text-left sm:text-right text-xs text-gray-600 space-y-0.5">
          <div>결제수단 결제액 <strong class="text-lg text-gray-900">{{ won(order.total_pay_amount) }}</strong></div>
          <div v-if="order.credit_used_amount">적립금 사용 {{ won(order.credit_used_amount) }}</div>
          <div v-if="order.refunded_pg_amount || order.refunded_credit_amount" class="text-[#E60023] font-bold">환불 {{ won(order.refunded_pg_amount) }} · 적립금 {{ won(order.refunded_credit_amount) }}</div>
          <div v-if="order.payment_status === 'READY'" class="text-amber-700 font-bold">결제 기한 {{ order.payment_expires_at }} (UTC)</div>
        </div>
      </div>

      <div v-if="statusBanner" role="status" class="p-3 rounded-xl text-xs font-bold" :class="bannerTone === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'">{{ statusBanner }}</div>

      <!-- Per-seller shipments with their own actions -->
      <div class="space-y-3">
        <div v-for="sub in subs" :key="sub.id" class="bg-white rounded-2xl p-5 border border-gray-200/80" :data-testid="`sub-${sub.sales_model}`">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 mb-3">
            <div class="text-sm font-black text-gray-900">{{ sub.business_name || '판매자' }}
              <span class="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded" :class="sub.sales_model === 'DIRECT' ? 'bg-orange-50 text-[#FF5000]' : 'bg-slate-100 text-slate-600'">{{ sub.sales_model === 'DIRECT' ? '올모아 직영' : '입점 판매자' }}</span>
            </div>
            <span class="text-xs font-bold text-slate-700">{{ label(sub.status) }}</span>
          </div>
          <ul class="text-xs space-y-1.5 mb-3">
            <li v-for="it in sub.items" :key="it.id" class="flex justify-between gap-3">
              <span class="text-gray-700">{{ it.product_title }} <span class="text-slate-400">· {{ it.option_summary }} × {{ it.quantity }}</span>
                <span v-if="it.refunded_quantity" class="ml-1 text-[#E60023]">({{ it.refunded_quantity }}개 환불)</span></span>
              <span class="font-bold whitespace-nowrap">{{ won(it.total_price) }}</span>
            </li>
            <li class="flex justify-between text-slate-500"><span>배송비</span><span>{{ sub.shipping_fee ? won(sub.shipping_fee) : '무료' }}</span></li>
          </ul>
          <div v-if="sub.tracking_number" class="text-[11px] text-slate-600 mb-3">{{ sub.carrier_code }} · <button class="underline" @click="copyTracking(sub.tracking_number)">{{ sub.tracking_number }}</button>
            <button class="ml-2 text-[#FF5000] font-bold" @click="loadMilestoneTracking(sub.id)">배송 조회</button></div>
          <div class="flex flex-wrap gap-2">
            <button v-if="['PAYMENT_CONFIRMED','PREPARING'].includes(sub.status) && subs.filter(s => s.status !== 'CANCELLED').length > 1" :disabled="busy" @click="handleCancelSub(sub)"
              class="px-3 py-1.5 rounded-full border border-red-300 text-[#E60023] text-xs font-bold">이 판매자 상품만 취소</button>
            <button v-if="sub.status === 'DELIVERED'" :disabled="busy" @click="openClaim(sub)" class="px-3 py-1.5 rounded-full border border-slate-300 text-xs font-bold">반품 · 교환 신청</button>
          </div>
        </div>
      </div>

      <!-- Order-level actions (only the ones valid for the current state are shown) -->
      <div class="bg-white rounded-2xl p-4 border border-gray-200/80 flex flex-wrap gap-2">
        <button v-if="canCancelWhole" :disabled="busy" @click="handleCancelOrder" data-testid="cancel-order"
          class="px-4 py-2 rounded-full border border-red-300 text-[#E60023] hover:bg-red-50 text-xs font-bold">{{ order.payment_status === 'READY' ? '주문 취소' : '주문 전체 취소 · 환불' }}</button>
        <button v-if="deliveredSubs.length" :disabled="busy" @click="handleConfirmOrder" data-testid="confirm-order"
          class="px-4 py-2 rounded-full bg-[#00A862] text-white text-xs font-black">구매확정 ({{ deliveredSubs.length }}건)</button>
        <button v-if="canPriceAdjust" :disabled="busy" @click="handlePriceAdjust" class="px-4 py-2 rounded-full bg-orange-50 text-[#FF5000] border border-orange-200 text-xs font-bold">판매가 인하 차액 보상 신청</button>
        <button v-if="canPriceAdjust" :disabled="busy" @click="handleLateDeliveryClaim" class="px-4 py-2 rounded-full bg-amber-50 text-amber-800 border border-amber-300 text-xs font-bold">배송 지연 보상 신청</button>
        <button v-if="order.pccc" @click="loadCommercialInvoice" class="px-4 py-2 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold">통관 인보이스</button>
        <span v-if="order.payment_status === 'READY'" class="text-[11px] text-amber-700 self-center">결제가 완료되지 않은 주문입니다. 결제 기한이 지나면 자동 취소됩니다.</span>
      </div>

      <!-- Claim Modal -->
      <div v-if="showClaimModal" class="bg-white rounded-2xl p-6 border-2 border-[#FF5000] space-y-4" role="dialog" aria-labelledby="claim-title">
        <div class="flex items-center justify-between">
          <h3 id="claim-title" class="text-base font-black text-gray-900">반품 · 교환 신청</h3>
          <button @click="showClaimModal = false" class="text-xs text-gray-400 hover:text-gray-700">닫기</button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <label class="block"><span class="block font-bold text-gray-700 mb-1">신청 유형</span>
            <select v-model="claimType" class="w-full h-10 px-3 rounded-lg border border-gray-300 font-bold">
              <option value="RETURN">반품 (환불)</option>
              <option value="EXCHANGE">교환</option>
            </select></label>
          <label class="block sm:col-span-2"><span class="block font-bold text-gray-700 mb-1">사유</span>
            <input v-model="claimReason" type="text" maxlength="500" placeholder="예: 사이즈가 맞지 않음" class="w-full h-10 px-3 rounded-lg border border-gray-300" /></label>
        </div>
        <p class="text-[11px] text-slate-500">환불 금액은 실제 결제 금액(쿠폰·적립금 배분 반영)을 기준으로 판매자 확인 후 확정됩니다. 단순 변심 반품 시 반품 배송비가 부과될 수 있습니다.</p>
        <div class="flex justify-end gap-2 pt-2">
          <button @click="showClaimModal = false" class="px-4 py-2 rounded-full border border-gray-300 text-xs font-bold">취소</button>
          <button @click="submitClaim" :disabled="busy" class="px-5 py-2 rounded-full bg-[#FF5000] text-white text-xs font-black">신청하기</button>
        </div>
      </div>

      <!-- Shipping Destination & Payment Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Delivery Destination Card -->
        <div class="bg-white rounded-2xl p-6 border border-gray-200/80 shadow-xs space-y-3">
          <div class="flex items-center justify-between border-b pb-3">
            <h2 class="text-sm font-black text-gray-900 flex items-center gap-2">
              <i class="fa-solid fa-location-dot text-[#FF5000]"></i>배송지 정보
            </h2>
            
          </div>
          <div class="text-xs space-y-1.5 text-gray-700">
            <div class="flex justify-between">
              <span class="text-gray-400">받는 분:</span>
              <span class="font-bold text-gray-900">{{ order.recipient_name }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-400">연락처:</span>
              <span class="font-mono text-gray-900">{{ order.recipient_phone || '010-8282-5959' }}</span>
            </div>
            <div class="pt-1">
              <span class="text-gray-400 block mb-0.5">배송 주소:</span>
              <div class="font-medium text-gray-900 bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                <span class="font-mono font-bold text-[#FF5000]">[{{ order.shipping_postal_code || '06236' }}]</span>
                {{ order.shipping_address_line1 || '서울특별시 강남구 테헤란로 427' }}
                {{ order.shipping_address_line2 || '1502호 (올모아 타워)' }}
              </div>
            </div>
            <div v-if="order.shipping_memo" class="pt-1 text-[11px] text-gray-500">
              <span class="text-gray-400">배송 요청사항:</span> {{ order.shipping_memo }}
            </div>
            <div v-if="order.pccc" class="flex justify-between items-center pt-2 mt-1 border-t border-gray-100 text-[11px]">
              <span class="text-gray-500 font-bold">개인통관고유부호 (PCCC):</span>
              <span class="font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                {{ order.pccc }} (관세청 검증)
              </span>
            </div>
            <div v-if="order.customs_duty_type" class="flex justify-between items-center text-[11px]">
              <span class="text-gray-500 font-bold">통관 관세 구분:</span>
              <span class="font-bold text-gray-800">
                {{ order.customs_duty_type === 'DDP' ? 'DDP (관부가세 선납)' : 'DDU (통관 시 후납)' }}
              </span>
            </div>
          </div>
        </div>

        <!-- Payment Breakdown Card -->
        <div class="bg-white rounded-2xl p-6 border border-gray-200/80 shadow-xs space-y-3">
          <div class="flex items-center justify-between border-b pb-3">
            <h2 class="text-sm font-black text-gray-900 flex items-center gap-2">
              <i class="fa-solid fa-credit-card text-[#FF5000]"></i>결제 내역 요약
            </h2>
            <span class="text-[11px] font-mono text-gray-500">{{ order.pg_provider === 'SANDBOX' ? '결제 시뮬레이터' : (order.pg_provider || '-') }}</span>
          </div>
          <div class="text-xs space-y-2 text-gray-600">
            <div class="flex justify-between">
              <span>상품 총 금액</span>
              <span class="font-bold text-gray-900">{{ locale.formatPrice(order.total_goods_amount || order.total_amount) }}</span>
            </div>
            <div class="flex justify-between">
              <span>배송비</span>
              <span class="font-bold text-[#00A862]">0원 (올모아 무료직배송)</span>
            </div>
            <div v-if="order.total_discount_amount && order.total_discount_amount > 0" class="flex justify-between text-[#FF5000]">
              <span>할인 및 적립금 적용</span>
              <span class="font-bold">- {{ locale.formatPrice(order.total_discount_amount) }}</span>
            </div>
            <div class="pt-2 border-t border-gray-100 flex justify-between items-center text-sm">
              <span class="font-black text-gray-900">최종 결제 금액</span>
              <span class="text-lg font-black text-[#FF5000]">
                {{ locale.formatPrice(order.total_pay_amount || order.total_amount) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Ordered Items & Partner Fulfillment -->
      <div class="bg-white rounded-2xl p-6 border border-gray-200/80 shadow-xs">
        <h2 class="text-base font-black text-gray-900 mb-4 flex items-center gap-2">
          <i class="fa-solid fa-box-open text-gray-600"></i>주문 상품 및 배송 현황
        </h2>
        <div class="divide-y divide-gray-100">
          <div
            v-for="item in (order.items || [])"
            :key="item.id"
            class="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div class="flex items-center gap-4">
              <img
                v-if="item.thumbnail_url"
                :src="item.thumbnail_url"
                class="w-16 h-16 rounded-xl object-cover bg-gray-100 shrink-0 border border-gray-100"
              />
              <div v-else class="w-16 h-16 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-500 shrink-0">
                <i class="fa-solid fa-bag-shopping text-xl"></i>
              </div>
              <div class="space-y-1">
                <div class="text-sm font-bold text-gray-900">{{ item.title || item.product_id }}</div>
                <div class="text-xs text-gray-500">
                  <span v-if="item.partner_name" class="font-semibold text-indigo-700 mr-2">[{{ item.partner_name }}]</span>
                  SKU: {{ item.sku_id }} • 수량: {{ item.quantity }}개
                </div>
                <!-- Tracking Number & Carrier Badge -->
                <div v-if="item.tracking_number" class="flex flex-wrap items-center gap-2 pt-1">
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[11px] font-bold">
                    🚚 {{ item.carrier || 'CJ대한통운' }} • {{ item.tracking_number }}
                  </span>
                  <button
                    @click="copyTracking(item.tracking_number)"
                    class="text-[11px] px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-gray-600 font-semibold cursor-pointer"
                  >
                    {{ copyToast === item.tracking_number ? '✓ 복사됨' : '송장 복사' }}
                  </button>
                  <button
                    @click="loadMilestoneTracking(item.sub_order_id || order.id)"
                    class="text-[11px] px-2.5 py-0.5 bg-[#111827] hover:bg-gray-800 text-white rounded font-bold cursor-pointer"
                  >
                    🌐 7단계 글로벌 통관/배송 추적
                  </button>
                </div>
                <div v-else class="pt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#00A862] font-semibold">
                  <span class="inline-flex items-center gap-1">
                    <span class="w-2 h-2 rounded-full bg-[#00A862] animate-pulse"></span>
                    판매자 출고 준비 중 ({{ item.status || 'PREPARING' }})
                  </span>
                  <button
                    @click="loadMilestoneTracking(item.sub_order_id || order.id)"
                    class="text-[11px] px-2.5 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded font-bold cursor-pointer"
                  >
                    🌐 배송 단계 보기
                  </button>
                </div>
              </div>
            </div>
            <div class="text-right sm:text-right shrink-0">
              <div class="text-base font-black text-gray-900">
                {{ locale.formatPrice(item.total_price || (item.unit_price * item.quantity)) }}
              </div>
              <div class="text-[11px] text-gray-400">단가: {{ locale.formatPrice(item.unit_price) }}</div>
            </div>
          </div>
        </div>

        <!-- 7-Stage Global Milestone Timeline Drawer -->
        <div v-if="trackingInfo" class="mt-5 pt-5 border-t border-gray-200 bg-slate-50 rounded-xl p-4 space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-black text-gray-900 flex items-center gap-1.5">
                <span>🌐 실시간 글로벌 7단계 통관·배송 타임라인</span>
                <span class="px-2 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-mono">{{ trackingInfo.current_milestone }}</span>
              </h3>
              <p class="text-[11px] text-gray-500 mt-0.5">
                특송사: {{ trackingInfo.carrier || '지정 특송사' }} | 송장번호: {{ trackingInfo.tracking_number || '발급 준비중' }}
                <span v-if="trackingInfo.customs_clearance_no"> | 통관번호: {{ trackingInfo.customs_clearance_no }}</span>
              </p>
            </div>
            <button @click="trackingInfo = null" class="text-xs text-gray-400 hover:text-gray-700 font-bold">✕ 닫기</button>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-7 gap-2">
            <div
              v-for="m in trackingInfo.milestones"
              :key="m.code"
              :class="[
                'p-2.5 rounded-lg border text-left transition-all',
                m.current ? 'bg-orange-50 border-[#FF5000] ring-1 ring-[#FF5000]' :
                m.completed ? 'bg-white border-emerald-200' : 'bg-gray-100/70 border-gray-200 opacity-60'
              ]"
            >
              <div class="flex items-center justify-between mb-1">
                <span class="text-[10px] font-black font-mono" :class="m.completed ? 'text-emerald-600' : 'text-gray-400'">STEP {{ m.step }}</span>
                <span v-if="m.completed" class="text-emerald-600 text-xs font-black">✓</span>
              </div>
              <div class="text-xs font-bold text-gray-900 leading-tight">{{ m.label }}</div>
              <div class="text-[10px] text-gray-500 mt-1 leading-snug">{{ m.desc }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Submitted Claims History -->
      <div v-if="claims.length > 0" class="bg-white rounded-2xl p-6 border border-gray-200/80 shadow-xs">
        <h2 class="text-base font-black text-gray-900 mb-3">고객 안심 케어 신청 내역</h2>
        <div class="space-y-2">
          <div v-for="cl in claims" :key="cl.id" class="p-3.5 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-between text-xs">
            <div>
              <span class="font-black text-[#FF5000] mr-2">[{{ cl.claim_type || cl.type }}]</span>
              <span class="text-gray-700">{{ cl.reason }}</span>
              <span class="text-gray-400 ml-2 font-mono text-[11px]">#{{ cl.id }}</span>
            </div>
            <div class="font-bold text-[#00A862]">
              {{ cl.status }} ({{ locale.formatPrice(cl.refund_amount || 0) }})
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
