<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const auth = useAuthStore()
const locale = useLocaleStore()
const orders = ref<any[]>([])
const loading = ref(true)
const actionMsg = ref('')

const loadOrders = async () => {
  loading.value = true
  try {
    const cid = auth.user?.id || 'cust_demo_001'
    const res = await fetch(`${API_BASE_URL}/api/v1/orders?customer_id=${encodeURIComponent(cid)}`, {
      headers: { 'X-Customer-Id': cid }
    })
    const json = await res.json()
    if (json.success) orders.value = json.data
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

const cancelOrder = async (orderId: string) => {
  const cid = auth.user?.id || 'cust_demo_001'
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/orders/${orderId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Customer-Id': cid },
      body: JSON.stringify({ reason: 'Customer requested cancellation from Orders list' })
    })
    const json = await res.json()
    if (json.success) {
      actionMsg.value = `✓ Order ${orderId} cancelled and stock restored.`
      await loadOrders()
    } else {
      actionMsg.value = `⚠️ ${json.error}`
    }
  } catch {}
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
      actionMsg.value = `🎉 Purchase confirmed! +₩${Number(json.data.reward_credit || 0).toLocaleString()} (1%) Olmoa Credit added to your wallet.`
      await loadOrders()
    }
  } catch {}
}

onMounted(loadOrders)
</script>

<template>
  <div class="max-w-[1100px] mx-auto px-4 sm:px-6 py-8">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-6">
      <div>
        <h1 class="text-2xl font-black text-gray-900">My Orders & Delivery Guarantee</h1>
        <p class="text-xs text-gray-500 mt-0.5">Confirm purchase to earn +1% Olmoa Credits or request a 90-day free return / 30-day price match.</p>
      </div>
      <div class="flex items-center gap-3">
        <RouterLink to="/addresses" class="text-xs font-bold text-gray-700 hover:text-[#FF5000] px-3 py-1.5 rounded-lg border border-gray-200 bg-white shadow-xs">
          📍 배송지 관리
        </RouterLink>
        <RouterLink to="/coupons" class="text-xs font-bold text-[#FF5000] hover:underline">
          View My Reward Credits & Coupons →
        </RouterLink>
      </div>
    </div>

    <div v-if="actionMsg" class="mb-4 p-3.5 rounded-xl bg-green-50 border border-green-200 text-xs font-bold text-[#00A862]">
      {{ actionMsg }}
    </div>

    <div v-if="loading" class="space-y-4">
      <div v-for="n in 3" :key="n" class="h-32 bg-white rounded-2xl animate-pulse"></div>
    </div>

    <div v-else-if="orders.length === 0" class="bg-white rounded-2xl p-12 text-center border border-gray-200">
      <p class="text-base font-bold text-gray-700 mb-3">You haven't placed any orders yet.</p>
      <RouterLink to="/" class="inline-block px-6 py-2.5 rounded-full bg-[#FF5000] text-white text-xs font-black">Start Shopping</RouterLink>
    </div>

    <div v-else class="space-y-4">
      <div
        v-for="order in orders"
        :key="order.id"
        class="bg-white rounded-2xl p-6 border border-gray-200/80 hover:border-[#FF5000] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <div class="flex items-center gap-2.5 mb-1.5">
            <span
              :class="[
                'px-2.5 py-0.5 text-[11px] font-black rounded-full uppercase',
                order.status === 'CANCELLED' ? 'bg-red-50 text-[#E60023]' :
                order.status === 'CONFIRMED' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-[#00A862]'
              ]"
            >
              {{ order.status }}
            </span>
            <span class="text-xs font-bold text-gray-500">Order #{{ order.id }}</span>
            <span class="text-xs text-gray-400">• {{ new Date(order.created_at).toLocaleString() }}</span>
          </div>
          <div class="text-lg font-black text-gray-900">
            {{ locale.formatPrice(order.total_amount) }}
            <span class="text-xs font-medium text-gray-500 ml-2">via {{ order.payment_method }}</span>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            v-if="['PAID', 'PREPARING'].includes(order.status)"
            @click="cancelOrder(order.id)"
            class="px-3.5 py-2 rounded-full border border-red-200 text-[#E60023] hover:bg-red-50 text-xs font-bold cursor-pointer"
          >
            Cancel Order
          </button>
          <button
            v-if="['PAID', 'SHIPPED', 'DELIVERED'].includes(order.status)"
            @click="confirmPurchase(order.id)"
            class="px-3.5 py-2 rounded-full bg-orange-50 text-[#FF5000] hover:bg-[#FF5000] hover:text-white text-xs font-black transition-colors cursor-pointer"
          >
            ✓ Confirm (+1% Credit)
          </button>
          <RouterLink
            :to="`/orders/${order.id}`"
            class="px-4 py-2 rounded-full bg-gray-900 hover:bg-[#FF5000] text-white text-xs font-bold transition-colors text-center"
          >
            Track / Return / Price-Match →
          </RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>
