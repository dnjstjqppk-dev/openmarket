<script setup lang="ts">
// PG return page. On success the server confirms the payment with the PG (amount re-checked server-side).
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { API_BASE_URL, authHeader } from '../config'
import { useCartStore } from '../stores/cart'

const route = useRoute()
const router = useRouter()
const cart = useCartStore()
const state = ref<'CONFIRMING' | 'DONE' | 'FAILED' | 'SIMULATOR_PROMPT'>('CONFIRMING')
const message = ref('')
const orderId = ref('')
const amount = Number(route.query.amount || 0)
const isFail = route.name === 'payment-fail'
const isSimulator = route.query.simulator === '1'

async function confirm() {
  state.value = 'CONFIRMING'
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/payments/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ order_id: route.query.orderId, payment_key: route.query.paymentKey, amount })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) {
      state.value = 'FAILED'
      message.value = json.error || '결제 승인에 실패했습니다.'
      return
    }
    orderId.value = json.data.order_id
    state.value = 'DONE'
    cart.clearCart()
    setTimeout(() => router.replace(`/orders/${json.data.order_id}`), 1200)
  } catch {
    state.value = 'FAILED'
    message.value = '결제 승인 결과를 확인하지 못했습니다. 주문 내역에서 결제 상태를 확인해 주세요.'
  }
}

onMounted(() => {
  if (isFail) {
    state.value = 'FAILED'
    message.value = String(route.query.message || '결제가 취소되었거나 실패했습니다.')
    return
  }
  if (isSimulator) { state.value = 'SIMULATOR_PROMPT'; return }
  confirm()
})
</script>

<template>
  <div class="max-w-md mx-auto py-16 px-4">
    <div class="bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-4" role="status" aria-live="polite">
      <template v-if="state === 'SIMULATOR_PROMPT'">
        <div class="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">개발용 결제 시뮬레이터 · 실제 결제가 발생하지 않습니다</div>
        <h1 class="text-lg font-black">{{ amount.toLocaleString('ko-KR') }}원 테스트 결제</h1>
        <div class="flex gap-2">
          <button data-testid="sim-approve" class="flex-1 h-11 rounded-xl bg-[#FF5000] text-white font-black" @click="confirm">승인</button>
          <button class="flex-1 h-11 rounded-xl border border-slate-300 font-bold" @click="router.replace('/orders')">취소</button>
        </div>
      </template>
      <template v-else-if="state === 'CONFIRMING'"><h1 class="text-lg font-black">결제 승인 확인 중...</h1></template>
      <template v-else-if="state === 'DONE'"><h1 class="text-lg font-black text-emerald-700" data-testid="pay-done">결제가 완료되었습니다</h1><p class="text-xs text-slate-500">주문 상세로 이동합니다.</p></template>
      <template v-else>
        <h1 class="text-lg font-black text-red-700">결제 실패</h1>
        <p class="text-xs text-slate-600">{{ message }}</p>
        <RouterLink to="/orders" class="inline-block mt-2 text-xs font-bold text-[#FF5000] underline">주문 내역으로</RouterLink>
      </template>
    </div>
  </div>
</template>
