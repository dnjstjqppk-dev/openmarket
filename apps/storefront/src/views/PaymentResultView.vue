<script setup lang="ts">
// PG return page (PHASE 2 redesign). On success the server confirms the payment with the PG (amount re-checked
// server-side). After a confirmed payment only the cart lines that were in this order are removed
// (cart.completeCheckout) — the rest of the cart is kept.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CircleCheck, CircleX, FlaskConical } from 'lucide-vue-next'
import { OmButton, OmAlert, OmSpinner } from '@olmoa/ui'
import CheckoutSteps from '../components/CheckoutSteps.vue'
import { API_BASE_URL, authHeader } from '../config'
import { useCartStore } from '../stores/cart'

const route = useRoute()
const router = useRouter()
const cart = useCartStore()
const state = ref<'CONFIRMING' | 'DONE' | 'FAILED' | 'SIMULATOR_PROMPT'>('CONFIRMING')
const message = ref('')
const orderId = ref('')
const orderNo = String(route.query.orderId || '')
const amount = Number(route.query.amount || 0)
const isFail = route.name === 'payment-fail'
const isSimulator = route.query.simulator === '1'
let redirect: ReturnType<typeof setTimeout> | null = null

async function confirm() {
  state.value = 'CONFIRMING'
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/payments/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ order_id: orderNo, payment_key: route.query.paymentKey, amount })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) {
      state.value = 'FAILED'
      message.value = json.error || '결제 승인에 실패했습니다.'
      return
    }
    orderId.value = json.data.order_id
    state.value = 'DONE'
    cart.completeCheckout(orderNo)
    redirect = setTimeout(() => router.replace(`/orders/${json.data.order_id}`), 1500)
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
onBeforeUnmount(() => { if (redirect) clearTimeout(redirect) })
</script>

<template>
  <div class="mx-auto max-w-lg px-4 py-10 sm:py-16">
    <div class="mb-6 flex justify-center"><CheckoutSteps :current="state === 'DONE' ? 3 : 2" /></div>
    <section class="rounded-lg border border-line bg-surface p-8 text-center" role="status" aria-live="polite">
      <template v-if="state === 'SIMULATOR_PROMPT'">
        <FlaskConical class="mx-auto h-10 w-10 text-warning" aria-hidden="true" />
        <OmAlert tone="warning" class="mt-4 text-left">개발용 결제 시뮬레이터입니다. 실제 결제가 발생하지 않습니다.</OmAlert>
        <h1 class="mt-4 text-xl font-bold text-ink">₩{{ amount.toLocaleString('ko-KR') }} 테스트 결제</h1>
        <p class="mt-1 text-sm text-ink-muted">주문번호 {{ orderNo }}</p>
        <div class="mt-6 flex gap-2">
          <OmButton class="flex-1" variant="outline" @click="router.replace('/orders')">취소</OmButton>
          <OmButton class="flex-1" variant="primary" data-testid="sim-approve" @click="confirm">승인</OmButton>
        </div>
      </template>

      <template v-else-if="state === 'CONFIRMING'">
        <OmSpinner :size="36" class="mx-auto text-primary" label="결제 승인 확인 중" />
        <h1 class="mt-4 text-xl font-bold text-ink">결제 승인을 확인하고 있습니다</h1>
        <p class="mt-1 text-sm text-ink-muted">창을 닫지 말고 잠시 기다려 주세요.</p>
      </template>

      <template v-else-if="state === 'DONE'">
        <CircleCheck class="mx-auto h-12 w-12 text-success" aria-hidden="true" />
        <h1 class="mt-4 text-xl font-bold text-ink" data-testid="pay-done">결제가 완료되었습니다</h1>
        <p class="mt-1 text-sm text-ink-muted">주문번호 {{ orderNo }} · 주문 상세로 이동합니다.</p>
        <OmButton class="mt-6" variant="primary" :to="`/orders/${orderId}`">주문 상세 보기</OmButton>
      </template>

      <template v-else>
        <CircleX class="mx-auto h-12 w-12 text-danger" aria-hidden="true" />
        <h1 class="mt-4 text-xl font-bold text-ink">결제하지 못했습니다</h1>
        <p class="mt-2 text-sm text-ink-muted">{{ message }}</p>
        <p class="mt-1 text-xs text-ink-subtle">결제 대기 주문은 30분 후 자동 취소되며 재고·쿠폰·적립금이 복원됩니다. 장바구니 상품은 그대로 남아 있습니다.</p>
        <div class="mt-6 flex justify-center gap-2">
          <OmButton variant="outline" to="/orders">주문 내역</OmButton>
          <OmButton variant="primary" to="/cart">장바구니로</OmButton>
        </div>
      </template>
    </section>
  </div>
</template>
