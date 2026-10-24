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

const showClaimModal = ref(false)
const claimType = ref<'RETURN' | 'EXCHANGE' | 'PRICE_MATCH'>('PRICE_MATCH')
const claimReason = ref('')
const claimCompetitorPrice = ref<number>(0)

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
    statusBanner.value = '✓ Order cancelled and SKU inventory atomically restored.'
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
    statusBanner.value = `🎉 Purchase confirmed! Earned +₩${Number(json.data.reward_credit || 0).toLocaleString()} (1%) Olmoa Credit.`
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
      ? `✓ 30-Day Price-Match approved! +₩${Number(json.data.refund_amount).toLocaleString()} credited to your Olmoa Wallet.`
      : `✓ ${claimType.value} request (${json.data.claim_id}) submitted for free pickup.`
    await loadOrderDetail()
  }
}

onMounted(loadOrderDetail)
</script>

<template>
  <div class="max-w-[960px] mx-auto px-4 sm:px-6 py-8">
    <RouterLink to="/orders" class="text-xs font-bold text-[#FF5000] hover:underline mb-4 inline-block">
      ← Back to All Orders
    </RouterLink>

    <div v-if="statusBanner" class="mb-4 p-4 rounded-xl bg-green-50 border border-green-200 text-xs font-bold text-[#00A862]">
      {{ statusBanner }}
    </div>

    <div v-if="loading" class="bg-white rounded-2xl p-8 animate-pulse h-64"></div>

    <div v-else-if="order" class="space-y-6">
      <!-- Confirmation Header -->
      <div class="bg-gradient-to-r from-[#00A862] to-emerald-700 text-white rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span class="px-2.5 py-0.5 bg-white/20 rounded-full text-[11px] font-black uppercase">
            STATUS: {{ order.status }}
          </span>
          <h1 class="text-2xl font-black mt-2">Order #{{ order.id }}</h1>
          <p class="text-xs text-white/90 mt-1">Protected by Olmoa 30-Day Price Match & 90-Day Free Return Guarantee</p>
        </div>
        <div class="text-left sm:text-right">
          <div class="text-xs text-white/80">Total Paid</div>
          <div class="text-3xl font-black">{{ locale.formatPrice(order.total_amount) }}</div>
        </div>
      </div>

      <!-- Self-Service Order Actions Bar -->
      <div class="bg-white rounded-2xl p-5 border border-gray-200/80 flex flex-wrap items-center justify-between gap-3">
        <div class="text-xs text-gray-600 font-medium">
          Need to adjust your order? Use instant self-service protection:
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-if="['PAID', 'PREPARING'].includes(order.status)"
            @click="handleCancelOrder"
            class="px-4 py-2 rounded-full border border-red-300 text-[#E60023] hover:bg-red-50 text-xs font-bold cursor-pointer"
          >
            Cancel Order & Refund
          </button>
          <button
            v-if="['PAID', 'SHIPPED', 'DELIVERED'].includes(order.status)"
            @click="handleConfirmOrder"
            class="px-4 py-2 rounded-full bg-[#00A862] text-white hover:opacity-95 text-xs font-black cursor-pointer"
          >
            ✓ Confirm Purchase (+1% Credit)
          </button>
          <button
            @click="claimType = 'PRICE_MATCH'; claimCompetitorPrice = Math.round(order.total_amount * 0.92); showClaimModal = true"
            class="px-4 py-2 rounded-full bg-orange-50 text-[#FF5000] border border-orange-200 hover:bg-orange-100 text-xs font-black cursor-pointer"
          >
            ⚡ 30-Day Price-Match Claim
          </button>
          <button
            @click="claimType = 'RETURN'; showClaimModal = true"
            class="px-4 py-2 rounded-full bg-gray-100 text-gray-800 hover:bg-gray-200 text-xs font-bold cursor-pointer"
          >
            ↩ 90-Day Free Return / Exchange
          </button>
        </div>
      </div>

      <!-- Claim Modal -->
      <div v-if="showClaimModal" class="bg-white rounded-2xl p-6 border-2 border-[#FF5000] shadow-lg space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-black text-gray-900">
            {{ claimType === 'PRICE_MATCH' ? '⚡ 30-Day Price-Match Instant Credit Claim' : '↩ 90-Day Free Return / Exchange Request' }}
          </h3>
          <button @click="showClaimModal = false" class="text-xs text-gray-400 hover:text-gray-700">Close ✕</button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label class="block font-bold text-gray-700 mb-1">Protection Type</label>
            <select v-model="claimType" class="w-full h-10 px-3 rounded-lg border border-gray-300 font-bold">
              <option value="PRICE_MATCH">30-Day Price-Match Adjustment (Instant Credit)</option>
              <option value="RETURN">90-Day Free Return (Full Refund)</option>
              <option value="EXCHANGE">90-Day Free Size/Option Exchange</option>
            </select>
          </div>
          <div v-if="claimType === 'PRICE_MATCH'">
            <label class="block font-bold text-gray-700 mb-1">Lower Observed Price (KRW)</label>
            <input v-model.number="claimCompetitorPrice" type="number" class="w-full h-10 px-3 rounded-lg border border-gray-300 font-bold" />
          </div>
          <div class="sm:col-span-2">
            <label class="block font-bold text-gray-700 mb-1">Reason / URL / Pickup Note</label>
            <input v-model="claimReason" type="text" placeholder="Provide lower price link or return pickup instructions..." class="w-full h-10 px-3 rounded-lg border border-gray-300" />
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <button @click="showClaimModal = false" class="px-4 py-2 rounded-full border border-gray-300 text-xs font-bold">Cancel</button>
          <button @click="submitClaim" class="px-5 py-2 rounded-full bg-[#FF5000] text-white text-xs font-black cursor-pointer">
            Submit Claim Now
          </button>
        </div>
      </div>

      <!-- Ordered Items & Tracking -->
      <div class="bg-white rounded-2xl p-6 border border-gray-200/80">
        <h2 class="text-base font-black text-gray-900 mb-4">Ordered Items & Partner Fulfillment</h2>
        <div class="divide-y divide-gray-100">
          <div
            v-for="item in order.items"
            :key="item.id"
            class="py-4 flex items-center justify-between gap-4"
          >
            <div class="flex items-center gap-4">
              <img v-if="item.thumbnail_url" :src="item.thumbnail_url" class="w-14 h-14 rounded-lg object-cover bg-gray-100" />
              <div>
                <div class="text-sm font-bold text-gray-900">{{ item.title || item.product_id }}</div>
                <div class="text-xs text-gray-500">SKU: {{ item.sku_id }} • Qty: {{ item.quantity }}</div>
                <div v-if="item.tracking_number" class="mt-1 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[11px] font-bold">
                  🚚 {{ item.carrier }} • Tracking #{{ item.tracking_number }}
                </div>
                <div v-else class="mt-1 text-[11px] text-[#00A862] font-semibold">
                  ● Partner Preparing Dispatch ({{ item.status }})
                </div>
              </div>
            </div>
            <div class="text-sm font-black text-gray-900">
              {{ locale.formatPrice(item.total_price) }}
            </div>
          </div>
        </div>
      </div>

      <!-- Submitted Claims History -->
      <div v-if="claims.length > 0" class="bg-white rounded-2xl p-6 border border-gray-200/80">
        <h2 class="text-base font-black text-gray-900 mb-3">Protection Claims History</h2>
        <div class="space-y-2">
          <div v-for="cl in claims" :key="cl.id" class="p-3 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-between text-xs">
            <div>
              <span class="font-black text-[#FF5000] mr-2">[{{ cl.type }}]</span>
              <span class="text-gray-700">{{ cl.reason }}</span>
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
