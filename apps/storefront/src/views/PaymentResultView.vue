<script setup lang="ts">
// PG return page (PHASE 2 redesign). On success the server confirms the payment with the PG (amount re-checked
// server-side). After a confirmed payment only the cart lines that were in this order are removed
// (cart.completeCheckout) — the rest of the cart is kept.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CircleCheck, CircleX, FlaskConical } from 'lucide-vue-next'
import { OmButton, OmAlert, OmSpinner } from '@olmoa/ui'
import CheckoutSteps from '../components/CheckoutSteps.vue'
import { API_BASE_URL, authHeader, newIdempotencyKey } from '../config'
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

// S-N02: a failed attempt leaves the order READY (server confirms only READY +
// exact-amount), so the fail state reloads the order by its order_no and offers
// a retry with the SAME order_no/amount instead of stranding the buyer.
const resumeOrderId = ref('')
const resumeAmount = ref(0)
const resumeName = ref('')
const resuming = ref(false)
const resumeError = ref('')

async function loadResumeOrder() {
  if (!orderNo) return
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/orders/${encodeURIComponent(orderNo)}`, { headers: { ...authHeader() } })
    const json = await res.json().catch(() => ({}))
    if (res.ok && json?.success && json.data?.payment_status === 'READY' && Number(json.data.total_pay_amount) > 0) {
      resumeOrderId.value = json.data.id
      resumeAmount.value = Number(json.data.total_pay_amount)
      const items = json.data.items || []
      resumeName.value = items.length > 1 ? `${items[0]?.product_title || '주문 상품'} 외 ${items.length - 1}건` : (items[0]?.product_title || `주문 ${orderNo}`)
    }
  } catch { /* resume stays hidden; the buyer can still use order/cart links */ }
}

function loadTossSdk(): Promise<any> {
  return new Promise((resolve, reject) => {
    if ((window as any).TossPayments) return resolve((window as any).TossPayments)
    const s = document.createElement('script')
    s.src = 'https://js.tosspayments.com/v1/payment'
    s.onload = () => resolve((window as any).TossPayments)
    s.onerror = () => reject(new Error('결제 모듈을 불러오지 못했습니다.'))
    document.head.appendChild(s)
  })
}

async function retryPayment() {
  if (!resumeOrderId.value || resuming.value) return
  resuming.value = true
  resumeError.value = ''
  try {
    const cfgRes = await fetch(`${API_BASE_URL}/api/v1/payments/config`)
    const cfg = await cfgRes.json().catch(() => ({}))
    if (cfg?.mode === 'SANDBOX_SIMULATOR') {
      const key = `sandbox_${newIdempotencyKey('pay').replace(/[^A-Za-z0-9_-]/g, '')}`
      await router.replace({ path: '/payments/success', query: { orderId: orderNo, paymentKey: key, amount: String(resumeAmount.value), simulator: '1' } })
      return
    }
    if (cfg?.mode === 'TOSS' && cfg?.client_key) {
      const TossPayments = await loadTossSdk()
      const toss = TossPayments(cfg.client_key)
      await toss.requestPayment('카드', {
        amount: resumeAmount.value,
        orderId: orderNo,
        orderName: resumeName.value,
        successUrl: `${window.location.origin}/payments/success`,
        failUrl: `${window.location.origin}/payments/fail`
      })
      return
    }
    resumeError.value = '결제 수단이 연동되지 않았습니다.'
  } catch (e: any) {
    resumeError.value = e?.message || '결제를 다시 시작하지 못했습니다.'
  } finally {
    resuming.value = false
  }
}

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
      loadResumeOrder()
      return
    }
    orderId.value = json.data.order_id
    state.value = 'DONE'
    cart.completeCheckout(orderNo)
    redirect = setTimeout(() => router.replace(`/orders/${json.data.order_id}`), 1500)
  } catch {
    state.value = 'FAILED'
    message.value = '결제 승인 결과를 확인하지 못했습니다. 주문 내역에서 결제 상태를 확인해 주세요.'
    loadResumeOrder()
  }
}

onMounted(() => {
  if (isFail) {
    state.value = 'FAILED'
    message.value = String(route.query.message || '결제가 취소되었거나 실패했습니다.')
    loadResumeOrder()
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
        <div class="mt-6 flex flex-wrap justify-center gap-2">
          <OmButton v-if="resumeOrderId" variant="primary" :loading="resuming" data-testid="retry-payment" @click="retryPayment">결제 다시 시도</OmButton>
          <OmButton v-if="resumeOrderId" variant="outline" :to="`/orders/${resumeOrderId}`">주문 상세에서 계속하기</OmButton>
          <OmButton v-else variant="outline" to="/orders">주문 내역</OmButton>
          <OmButton variant="outline" to="/cart">장바구니로</OmButton>
        </div>
        <p v-if="resumeError" class="mt-2 text-xs text-danger">{{ resumeError }}</p>
      </template>
    </section>
  </div>
</template>
