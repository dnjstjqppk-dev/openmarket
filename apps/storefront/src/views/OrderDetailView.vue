<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const route = useRoute()
const auth = useAuthStore()
const locale = useLocaleStore()
const order = ref<any>(null)
const claims = ref<any[]>([])
const loading = ref(true)
const statusBanner = ref('')
const copyToast = ref('')

const showClaimModal = ref(false)
const claimType = ref<'RETURN' | 'EXCHANGE' | 'PRICE_MATCH'>('PRICE_MATCH')
const claimReason = ref('')
const claimCompetitorPrice = ref<number>(0)

const copyTracking = (num: string) => {
  navigator.clipboard.writeText(num).then(() => {
    copyToast.value = num
    setTimeout(() => {
      copyToast.value = ''
    }, 2000)
  })
}

const loadOrderDetail = async () => {
  loading.value = true
  try {
    const cid = auth.user?.id || 'cust_demo_001'
    const [res, claimRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/orders/${route.params.id}?customer_id=${encodeURIComponent(cid)}`, {
        headers: { 'X-Customer-Id': cid }
      }),
      fetch(`${API_BASE_URL}/api/v1/orders/${route.params.id}/claims`, {
        headers: { 'X-Customer-Id': cid }
      })
    ])
    const json = await res.json()
    const claimJson = await claimRes.json()
    if (json.success) order.value = json.data
    if (claimJson.success) claims.value = claimJson.data || []
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

const handleCancelOrder = async () => {
  if (!order.value) return
  const cid = auth.user?.id || 'cust_demo_001'
  const res = await fetch(`${API_BASE_URL}/api/v1/orders/${order.value.id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': cid },
    body: JSON.stringify({ reason: 'Customer self-service cancellation' })
  })
  const json = await res.json()
  if (json.success) {
    statusBanner.value = '✓ 주문이 취소되었으며 SKU 실재고가 원복되었습니다.'
    await loadOrderDetail()
  } else {
    statusBanner.value = `⚠️ ${json.error}`
  }
}

const handleConfirmOrder = async () => {
  if (!order.value) return
  const cid = auth.user?.id || 'cust_demo_001'
  const res = await fetch(`${API_BASE_URL}/api/v1/orders/${order.value.id}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': cid }
  })
  const json = await res.json()
  if (json.success) {
    statusBanner.value = `🎉 구매확정이 완료되었습니다! +₩${Number(json.data.reward_credit || 0).toLocaleString()} (1%) 올모아 적립금이 지급되었습니다.`
    await loadOrderDetail()
  }
}

const submitClaim = async () => {
  if (!order.value) return
  const cid = auth.user?.id || 'cust_demo_001'
  const diff = claimType.value === 'PRICE_MATCH'
    ? Math.max(1000, Math.min(15000, Number(order.value.total_amount) - Number(claimCompetitorPrice.value || 0)))
    : Number(order.value.total_amount)

  const res = await fetch(`${API_BASE_URL}/api/v1/orders/${order.value.id}/claims`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': cid },
    body: JSON.stringify({
      type: claimType.value,
      reason: claimReason.value || `${claimType.value} requested by customer`,
      refund_amount: diff
    })
  })
  const json = await res.json()
  if (json.success) {
    showClaimModal.value = false
    statusBanner.value = claimType.value === 'PRICE_MATCH'
      ? `✓ 30일 최저가 보상 신청 승인! +₩${Number(json.data.refund_amount).toLocaleString()} 적립금이 즉시 지급되었습니다.`
      : `✓ ${claimType.value} 신청 (${json.data.claim_id})이 완료되었습니다. 지정 택배사 무료 수거가 진행됩니다.`
    await loadOrderDetail()
  }
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
      <!-- Confirmation Header -->
      <div class="bg-gradient-to-r from-[#00A862] to-emerald-700 text-white rounded-2xl p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span class="px-2.5 py-0.5 bg-white/20 rounded-full text-[11px] font-black uppercase tracking-wider">
            STATUS: {{ order.payment_status || order.status }}
          </span>
          <h1 class="text-2xl font-black mt-2">주문 번호 #{{ order.order_no || order.id }}</h1>
          <p class="text-xs text-white/90 mt-1">OLMOA 30일 최저가 차액보상 및 90일 무조건 무료반품 안심 케어 적용</p>
        </div>
        <div class="text-left sm:text-right">
          <div class="text-xs text-white/80">최종 결제 금액</div>
          <div class="text-3xl font-black">{{ locale.formatPrice(order.total_pay_amount || order.total_amount) }}</div>
          <div class="text-[11px] text-white/80 mt-0.5 font-mono">결제수단: {{ order.payment_method }}</div>
        </div>
      </div>

      <!-- Self-Service Order Actions Bar -->
      <div class="bg-white rounded-2xl p-5 border border-gray-200/80 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div class="text-xs text-gray-600 font-medium">
          주문 변경이나 케어가 필요하신가요? 1초 셀프서비스로 즉시 처리됩니다:
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-if="['PAID', 'PREPARING'].includes(order.payment_status || order.status)"
            @click="handleCancelOrder"
            class="px-4 py-2 rounded-full border border-red-300 text-[#E60023] hover:bg-red-50 text-xs font-bold cursor-pointer"
          >
            주문 취소 및 즉시 환불
          </button>
          <button
            v-if="['PAID', 'SHIPPED', 'DELIVERED', 'COMPLETED'].includes(order.payment_status || order.status)"
            @click="handleConfirmOrder"
            class="px-4 py-2 rounded-full bg-[#00A862] text-white hover:opacity-95 text-xs font-black cursor-pointer shadow-xs"
          >
            ✓ 구매확정 (+1% 적립금)
          </button>
          <button
            @click="claimType = 'PRICE_MATCH'; claimCompetitorPrice = Math.round((order.total_pay_amount || order.total_amount) * 0.92); showClaimModal = true"
            class="px-4 py-2 rounded-full bg-orange-50 text-[#FF5000] border border-orange-200 hover:bg-orange-100 text-xs font-black cursor-pointer"
          >
            ⚡ 30일 최저가 차액 보상
          </button>
          <button
            @click="claimType = 'RETURN'; showClaimModal = true"
            class="px-4 py-2 rounded-full bg-gray-100 text-gray-800 hover:bg-gray-200 text-xs font-bold cursor-pointer"
          >
            ↩ 90일 무료 반품 / 교환
          </button>
        </div>
      </div>

      <!-- Claim Modal -->
      <div v-if="showClaimModal" class="bg-white rounded-2xl p-6 border-2 border-[#FF5000] shadow-lg space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-black text-gray-900">
            {{ claimType === 'PRICE_MATCH' ? '⚡ 30일 최저가 보상제 (즉시 적립금 환급)' : '↩ 90일 안심 무료 반품 / 교환 접수' }}
          </h3>
          <button @click="showClaimModal = false" class="text-xs text-gray-400 hover:text-gray-700">✕ 닫기</button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label class="block font-bold text-gray-700 mb-1">신청 유형</label>
            <select v-model="claimType" class="w-full h-10 px-3 rounded-lg border border-gray-300 font-bold">
              <option value="PRICE_MATCH">30일 최저가 보상 (타사 또는 올모아 내 인하 차액 즉시 적립)</option>
              <option value="RETURN">90일 무료 반품 (전액 환불 + 무료 수거)</option>
              <option value="EXCHANGE">90일 무료 교환 (사이즈/색상 교환)</option>
            </select>
          </div>
          <div v-if="claimType === 'PRICE_MATCH'">
            <label class="block font-bold text-gray-700 mb-1">확인된 인하 가격 (KRW)</label>
            <input v-model.number="claimCompetitorPrice" type="number" class="w-full h-10 px-3 rounded-lg border border-gray-300 font-bold" />
          </div>
          <div class="sm:col-span-2">
            <label class="block font-bold text-gray-700 mb-1">상세 사유 또는 수거 시 전달사항</label>
            <input v-model="claimReason" type="text" placeholder="더 저렴한 링크 또는 택배 기사님 수거 메모를 남겨주세요." class="w-full h-10 px-3 rounded-lg border border-gray-300" />
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button @click="showClaimModal = false" class="px-4 py-2 rounded-full border border-gray-300 text-xs font-bold">취소</button>
          <button @click="submitClaim" class="px-5 py-2 rounded-full bg-[#FF5000] text-white text-xs font-black cursor-pointer shadow-xs">
            신청서 제출하기
          </button>
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
            <span class="text-[11px] font-bold text-[#00A862]">전 품목 무료배송</span>
          </div>
          <div class="text-xs space-y-1.5 text-gray-700">
            <div class="flex justify-between">
              <span class="text-gray-400">받는 분:</span>
              <span class="font-bold text-gray-900">{{ order.recipient_name || auth.user?.name || 'Alex Kim' }}</span>
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
          </div>
        </div>

        <!-- Payment Breakdown Card -->
        <div class="bg-white rounded-2xl p-6 border border-gray-200/80 shadow-xs space-y-3">
          <div class="flex items-center justify-between border-b pb-3">
            <h2 class="text-sm font-black text-gray-900 flex items-center gap-2">
              <i class="fa-solid fa-credit-card text-[#FF5000]"></i>결제 내역 요약
            </h2>
            <span class="text-[11px] font-mono text-gray-500">{{ order.payment_method || '간편결제' }}</span>
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
                <div v-if="item.tracking_number" class="flex items-center gap-2 pt-1">
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[11px] font-bold">
                    🚚 {{ item.carrier || 'CJ대한통운' }} • {{ item.tracking_number }}
                  </span>
                  <button
                    @click="copyTracking(item.tracking_number)"
                    class="text-[11px] px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-gray-600 font-semibold cursor-pointer"
                  >
                    {{ copyToast === item.tracking_number ? '✓ 복사됨' : '송장 복사' }}
                  </button>
                </div>
                <div v-else class="pt-1 text-[11px] text-[#00A862] font-semibold flex items-center gap-1">
                  <span class="w-2 h-2 rounded-full bg-[#00A862] animate-pulse"></span>
                  판매자 출고 준비 중 ({{ item.status || 'PREPARING' }})
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
