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
const trackingInfo = ref<any>(null)
const loadingTracking = ref(false)

const showInvoiceModal = ref(false)
const invoiceData = ref<any>(null)
const invoiceLoading = ref(false)

const loadCommercialInvoice = async () => {
  if (!order.value) return
  invoiceLoading.value = true
  showInvoiceModal.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/orders/${order.value.id}/commercial-invoice`)
    const json = await res.json()
    if (json.success) {
      invoiceData.value = json.data
    }
  } catch (e) {
    console.error(e)
  } finally {
    invoiceLoading.value = false
  }
}

const loadMilestoneTracking = async (subOrderId: string) => {
  loadingTracking.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/logistics/tracking/${encodeURIComponent(subOrderId)}`)
    const json = await res.json()
    if (json.success) {
      trackingInfo.value = json.data
    }
  } catch (e) {
    console.error(e)
  } finally {
    loadingTracking.value = false
  }
}

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

const handleLateDeliveryClaim = async () => {
  if (!order.value) return
  const cid = auth.user?.id || 'cust_demo_001'
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/orders/${order.value.id}/late-delivery-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Customer-Id': cid }
    })
    const json = await res.json()
    if (json.success) {
      statusBanner.value = '🎉 테무형 안심 배송 약속: ₩5,300 지연 보상 적립금이 고객님 계정으로 즉시 입금되었습니다!'
      await loadOrderDetail()
    } else {
      statusBanner.value = `⚠️ ${json.error}`
    }
  } catch (e) {
    console.error(e)
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
            @click="handleLateDeliveryClaim"
            class="px-4 py-2 rounded-full bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 text-xs font-black cursor-pointer"
          >
            ⚡ 배송 지연 보상 (₩5,300 즉시 지급)
          </button>
          <button
            @click="claimType = 'RETURN'; showClaimModal = true"
            class="px-4 py-2 rounded-full bg-gray-100 text-gray-800 hover:bg-gray-200 text-xs font-bold cursor-pointer"
          >
            ↩ 90일 무료 반품 / 무회수 환불
          </button>
          <button
            @click="loadCommercialInvoice"
            class="px-4 py-2 rounded-full bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 text-xs font-black cursor-pointer flex items-center gap-1.5"
            title="관세청 제출용 국제 상업 송장(Commercial Invoice) 및 패킹 리스트 보기"
          >
            <i class="fa-solid fa-file-invoice text-xs"></i>
            <span>📄 전자 통관 인보이스</span>
          </button>
        </div>
      </div>

      <!-- Commercial Invoice Modal (Step 29) -->
      <div v-if="showInvoiceModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
        <div class="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 sm:p-8 shadow-2xl border border-gray-200 space-y-6">
          <div class="flex items-center justify-between border-b pb-4">
            <div class="flex items-center gap-2">
              <span class="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-sm">
                <i class="fa-solid fa-plane-departure"></i>
              </span>
              <div>
                <h3 class="text-base font-black text-gray-900">국제 크로스보더 상업송장 (Commercial Invoice)</h3>
                <p class="text-[11px] text-gray-500 font-mono">Customs Declaration &amp; Packing List Manifest</p>
              </div>
            </div>
            <button @click="showInvoiceModal = false" class="text-xs text-gray-400 hover:text-gray-700 font-bold p-1 cursor-pointer">✕ 닫기</button>
          </div>

          <div v-if="invoiceLoading" class="py-12 text-center text-xs text-gray-400 animate-pulse">
            관세청 제출용 전자 인보이스 데이터 불러오는 중...
          </div>
          <div v-else-if="invoiceData" class="space-y-5 text-xs">
            <!-- Header Info -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-2xl bg-gray-50 border border-gray-200">
              <div>
                <span class="text-gray-400 text-[10px] block font-bold">Invoice No.</span>
                <span class="font-mono font-black text-gray-900">{{ invoiceData.invoice_number }}</span>
              </div>
              <div>
                <span class="text-gray-400 text-[10px] block font-bold">Issue Date</span>
                <span class="font-semibold text-gray-800">{{ invoiceData.issue_date }}</span>
              </div>
              <div>
                <span class="text-gray-400 text-[10px] block font-bold">Incoterms</span>
                <span class="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-black text-[10px]">{{ invoiceData.incoterms }}</span>
              </div>
              <div>
                <span class="text-gray-400 text-[10px] block font-bold">Declaration FX</span>
                <span class="font-mono text-gray-700">1 USD = ₩{{ invoiceData.fx_rate_applied }}</span>
              </div>
            </div>

            <!-- Exporter / Consignee -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div class="p-4 rounded-xl border border-gray-200 bg-white">
                <div class="font-black text-gray-900 text-xs mb-1.5 flex items-center gap-1.5">
                  <span class="text-blue-600">●</span> Exporter (발송인/수출자)
                </div>
                <div class="font-bold text-gray-800">{{ invoiceData.exporter.company_name }}</div>
                <div class="text-[11px] text-gray-500 mt-1">{{ invoiceData.exporter.address }}</div>
                <div class="text-[11px] text-gray-500 font-mono mt-0.5">Biz Reg: {{ invoiceData.exporter.business_number }}</div>
              </div>
              <div class="p-4 rounded-xl border border-gray-200 bg-white">
                <div class="font-black text-gray-900 text-xs mb-1.5 flex items-center gap-1.5">
                  <span class="text-emerald-600">●</span> Consignee (수하인/수입자)
                </div>
                <div class="font-bold text-gray-800">{{ invoiceData.consignee.name }}</div>
                <div class="text-[11px] text-gray-500 mt-1">{{ invoiceData.consignee.address }}</div>
                <div class="text-[11px] font-mono text-emerald-700 font-bold mt-0.5">PCCC: {{ invoiceData.consignee.pccc }}</div>
              </div>
            </div>

            <!-- Manifest Items Table -->
            <div class="rounded-xl border border-gray-200 overflow-hidden">
              <table class="w-full text-left border-collapse text-[11px]">
                <thead class="bg-gray-100 text-gray-600 font-bold border-b">
                  <tr>
                    <th class="py-2.5 px-3">No</th>
                    <th class="py-2.5 px-3">Item Description</th>
                    <th class="py-2.5 px-3">HS Code</th>
                    <th class="py-2.5 px-3 text-center">Qty</th>
                    <th class="py-2.5 px-3 text-right">Unit (USD)</th>
                    <th class="py-2.5 px-3 text-right">Total (USD)</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  <tr v-for="it in invoiceData.line_items" :key="it.item_no">
                    <td class="py-2 px-3 font-mono text-gray-400">{{ it.item_no }}</td>
                    <td class="py-2 px-3 font-bold text-gray-900">{{ it.description }}</td>
                    <td class="py-2 px-3 font-mono text-blue-600 font-semibold">{{ it.hs_code }}</td>
                    <td class="py-2 px-3 text-center font-bold">{{ it.quantity }}</td>
                    <td class="py-2 px-3 text-right font-mono">${{ it.unit_price_usd.toFixed(2) }}</td>
                    <td class="py-2 px-3 text-right font-mono font-bold text-gray-900">${{ it.total_amount_usd.toFixed(2) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Customs Declaration Legal Statement -->
            <div class="p-3 bg-gray-50 rounded-xl text-[10px] text-gray-500 leading-relaxed font-mono border border-gray-200">
              {{ invoiceData.customs_declaration_statement }}
            </div>

            <div class="flex justify-end pt-2">
              <button
                @click="showInvoiceModal = false"
                class="px-5 py-2.5 rounded-xl bg-gray-900 hover:bg-black text-white font-black text-xs cursor-pointer shadow-xs"
              >
                확인 및 닫기
              </button>
            </div>
          </div>
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
        <div v-if="claimType === 'RETURN'" class="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-800 font-medium">
          💡 <strong>테무형 안심 무회수 환불(Returnless Refund):</strong> 결제 금액이 ₩15,000 이하인 경우 택배 기사 수거 대기 없이 즉시 전액 적립금 환급이 완료됩니다.
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
