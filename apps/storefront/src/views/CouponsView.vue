<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const auth = useAuthStore()
const locale = useLocaleStore()
const coupons = ref<any[]>([])
const creditData = ref<any>({ balance: 5000, history: [] })
const claimMsg = ref('')

const loadWallet = async () => {
  const cid = auth.user?.id || 'cust_demo_001'
  try {
    const [cRes, crRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/coupons?customer_id=${encodeURIComponent(cid)}`),
      fetch(`${API_BASE_URL}/api/v1/credits?customer_id=${encodeURIComponent(cid)}`, { headers: { 'X-Customer-Id': cid } })
    ])
    const cJson = await cRes.json()
    const crJson = await crRes.json()
    if (cJson.success) coupons.value = cJson.data || []
    if (crJson.success) creditData.value = crJson.data || { balance: 5000, history: [] }
  } catch {}
}

const claimCoupon = async (couponId: string) => {
  const cid = auth.user?.id || 'cust_demo_001'
  const res = await fetch(`${API_BASE_URL}/api/v1/coupons/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Customer-Id': cid },
    body: JSON.stringify({ customer_id: cid, coupon_id: couponId })
  })
  const json = await res.json()
  if (json.success) {
    claimMsg.value = '🎉 Coupon claimed to your account! Ready to apply at Checkout.'
    await loadWallet()
  }
}

onMounted(loadWallet)
</script>

<template>
  <div class="max-w-[1100px] mx-auto px-4 sm:px-6 py-8 space-y-8">
    <div class="bg-gradient-to-r from-[#111111] to-gray-800 text-white rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <span class="text-xs font-black text-[#FFE600] uppercase">Olmoa Rewards & Benefits Wallet</span>
        <h1 class="text-2xl sm:text-3xl font-black mt-1">Coupons & Reward Credits</h1>
        <p class="text-xs text-gray-300 mt-1">Combine instant promo coupons with your 1% purchase confirmation & price-match credits.</p>
      </div>
      <div class="bg-white/10 rounded-2xl p-4 border border-white/15 text-right shrink-0">
        <div class="text-[11px] text-gray-300">Available Olmoa Credit Balance</div>
        <div class="text-3xl font-black text-[#FFE600]">{{ locale.formatPrice(creditData.balance || 0) }}</div>
      </div>
    </div>

    <div v-if="claimMsg" class="p-4 rounded-xl bg-green-50 border border-green-200 text-xs font-bold text-[#00A862]">
      {{ claimMsg }}
    </div>

    <!-- Active Coupons -->
    <section>
      <h2 class="text-lg font-black text-gray-900 mb-4">🎟️ Available Promo Coupons</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          v-for="c in coupons"
          :key="c.id"
          class="bg-white rounded-2xl p-5 border-2 border-dashed border-[#FF5000] flex flex-col justify-between"
        >
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="px-2.5 py-0.5 rounded bg-orange-50 text-[#FF5000] text-[11px] font-black">{{ c.code }}</span>
              <span class="text-[11px] text-gray-400">Valid thru {{ new Date(c.valid_until).toLocaleDateString() }}</span>
            </div>
            <div class="text-2xl font-black text-[#E60023] mb-1">
              {{ c.discount_type === 'FIXED' ? locale.formatPrice(c.discount_value) : `${c.discount_value}% OFF` }}
            </div>
            <h3 class="text-sm font-bold text-gray-900">{{ c.name }}</h3>
            <p class="text-xs text-gray-500 mt-1">
              Min. Order {{ locale.formatPrice(c.min_order_amount || 0) }} • Max Discount {{ locale.formatPrice(c.max_discount_amount || c.discount_value) }}
            </p>
          </div>
          <button
            @click="claimCoupon(c.id)"
            :disabled="Boolean(c.claimed_status)"
            :class="[
              'mt-4 w-full h-10 rounded-xl text-xs font-black transition-colors cursor-pointer',
              c.claimed_status
                ? 'bg-gray-100 text-gray-500 cursor-default'
                : 'bg-[#FF5000] hover:bg-[#E60023] text-white'
            ]"
          >
            {{ c.claimed_status ? `✓ Claimed (${c.claimed_status})` : 'Claim Coupon Now' }}
          </button>
        </div>
      </div>
    </section>

    <!-- Credit Ledger History -->
    <section class="bg-white rounded-2xl p-6 border border-gray-200/80">
      <h2 class="text-base font-black text-gray-900 mb-4">💰 Reward Credit Ledger History</h2>
      <div class="divide-y divide-gray-100 text-xs">
        <div v-for="entry in creditData.history" :key="entry.id" class="py-3 flex items-center justify-between">
          <div>
            <div class="font-bold text-gray-900">{{ entry.reason }}</div>
            <div class="text-[11px] text-gray-400">{{ new Date(entry.created_at).toLocaleString() }}</div>
          </div>
          <div :class="['text-sm font-black', entry.amount >= 0 ? 'text-[#00A862]' : 'text-[#E60023]']">
            {{ entry.amount >= 0 ? '+' : '' }}{{ locale.formatPrice(entry.amount) }}
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
