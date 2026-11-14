<script setup lang="ts">
// PG return page (PHASE 2 redesign). On success the server confirms the payment with the PG (amount re-checked
// server-side). After a confirmed payment only the cart lines that were in this order are removed
// (cart.completeCheckout) — the rest of the cart is kept.
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CircleCheck, CircleX, FlaskConical } from 'lucide-vue-next'
import { userErrorMessage, OmButton, OmAlert, OmSpinner, formatNumber } from '@olmoa/ui'
import CheckoutSteps from '../components/CheckoutSteps.vue'
import { API_BASE_URL, authHeader, newIdempotencyKey } from '../config'
import { useCartStore } from '../stores/cart'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const cart = useCartStore()
const auth = useAuthStore()
const state = ref<'CONFIRMING' | 'DONE' | 'FAILED' | 'SIMULATOR_PROMPT'>('CONFIRMING')
const message = ref('')
const orderId = ref('')
const receipt = ref<any>(null)
const orderNo = String(route.query.orderId || '')
const amount = Number(route.query.amount || 0)
const isFail = route.name === 'payment-fail'
const isSimulator = route.query.simulator === '1'

// S-N02: a failed attempt leaves the order READY (server confirms only READY +
// exact-amount), so the fail state reloads the order by its order_no and offers
// a retry with the SAME order_no/amount instead of stranding the buyer.
const resumeOrderId = ref('')
const resumeAmount = ref(0)
const resumeName = ref('')
const resuming = ref(false)
const resumeError = ref('')
// NEW-07: retry with the buyer's chosen Toss v1 method (was hardcoded to 카드).
const retryMethod = ref('카드')
const RETRY_METHODS = ['카드', '계좌이체', '가상계좌', '토스페이']

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
    // NEW-08: web uses the v1 API-integration key, never the widget key.
    const apiKey = cfg?.api_client_key || cfg?.client_key
    if (cfg?.mode === 'TOSS' && apiKey) {
      const TossPayments = await loadTossSdk()
      const toss = TossPayments(apiKey)
      await toss.requestPayment(retryMethod.value, {
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
    resumeError.value = userErrorMessage(e, '결제를 다시 시작하지 못했습니다.')
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
    // 3-7: drop the PG roundtrip params from the address bar (keys must not linger).
    try {
      history.replaceState(null, '', `${route.path}?orderId=${encodeURIComponent(orderNo)}`)
    } catch { /* private mode keeps the params */ }
    loadReceipt(json.data.order_id)
  } catch {
    state.value = 'FAILED'
    message.value = '결제 승인 결과를 확인하지 못했습니다. 주문 내역에서 결제 상태를 확인해 주세요.'
    loadResumeOrder()
  }
}

async function loadReceipt(id: string) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/orders/${encodeURIComponent(id)}`, { headers: { ...authHeader() } })
    const json = await res.json().catch(() => ({}))
    if (res.ok && json?.success) receipt.value = json.data
  } catch { /* receipt sections hide one by one */ }
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
function paidDate(s: string | null): string {
  if (!s) return ''
  const d = new Date(String(s).replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
}
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
        <CircleCheck class="mx-auto h-16 w-16 text-success" aria-hidden="true" />
        <h1 class="mt-4 text-2xl font-bold text-ink" data-testid="pay-done">결제가 완료되었습니다</h1>
        <p class="mt-1 text-sm text-ink-muted">주문번호 {{ orderNo }}</p>

        <div v-if="receipt" class="mt-6 space-y-4 text-left">
          <section class="rounded-lg border border-line-divider p-4" aria-label="주문자 및 배송지">
            <h2 class="mb-2 text-sm font-bold text-ink">주문·배송 정보</h2>
            <dl class="grid gap-1 text-sm">
              <div class="flex justify-between gap-3"><dt class="text-ink-muted">주문자</dt><dd class="text-ink">{{ auth.user?.name || '' }}<span v-if="auth.user?.email" class="text-ink-muted"> · {{ auth.user.email }}</span></dd></div>
              <div class="flex justify-between gap-3"><dt class="text-ink-muted">수령인</dt><dd class="text-ink">{{ receipt.recipient_name }} · {{ receipt.recipient_phone }}</dd></div>
              <div class="flex justify-between gap-3"><dt class="text-ink-muted">주소</dt><dd class="text-right text-ink">{{ receipt.shipping_address_line1 }} {{ receipt.shipping_address_line2 || '' }} ({{ receipt.shipping_postal_code }})</dd></div>
              <div v-if="receipt.shipping_memo" class="flex justify-between gap-3"><dt class="text-ink-muted">메모</dt><dd class="text-ink">{{ receipt.shipping_memo }}</dd></div>
            </dl>
          </section>

          <section class="rounded-lg border border-line-divider p-4" aria-label="주문 상품">
            <h2 class="mb-2 text-sm font-bold text-ink">주문 상품</h2>
            <ul class="space-y-3">
              <li v-for="s in receipt.sub_orders || []" :key="s.id">
                <p class="text-xs font-bold text-ink-muted">{{ s.business_name }}</p>
                <ul class="mt-1 space-y-1">
                  <li v-for="it in s.items || []" :key="it.id" class="flex justify-between gap-3 text-sm">
                    <span class="min-w-0 truncate text-ink">{{ it.product_title }} · {{ it.option_summary }} × {{ it.quantity }}</span>
                    <span class="shrink-0 tabular-nums text-ink">{{ formatNumber(it.total_price) }}원</span>
                  </li>
                </ul>
                <p class="mt-1 text-right text-xs text-ink-muted">배송비 {{ Number(s.shipping_fee) ? `${formatNumber(s.shipping_fee)}원` : '무료' }}</p>
              </li>
            </ul>
          </section>

          <section class="rounded-lg border border-line-divider p-4" aria-label="결제 정보">
            <h2 class="mb-2 text-sm font-bold text-ink">결제 정보</h2>
            <dl class="grid gap-1 text-sm">
              <div class="flex justify-between gap-3"><dt class="text-ink-muted">결제 일시</dt><dd class="text-ink">{{ paidDate(receipt.paid_at) }}</dd></div>
              <div v-if="receipt.payment_method" class="flex justify-between gap-3"><dt class="text-ink-muted">결제 수단</dt><dd class="text-ink">{{ receipt.payment_method }}</dd></div>
              <div v-if="receipt.payment_card" class="flex justify-between gap-3"><dt class="text-ink-muted">카드</dt><dd class="text-ink" data-testid="pay-card">{{ receipt.payment_card }}</dd></div>
              <div class="flex justify-between gap-3"><dt class="text-ink-muted">상품 금액</dt><dd class="tabular-nums text-ink">{{ formatNumber(receipt.total_goods_amount) }}원</dd></div>
              <div v-if="Number(receipt.total_discount_amount)" class="flex justify-between gap-3"><dt class="text-ink-muted">할인</dt><dd class="tabular-nums text-accent">-{{ formatNumber(receipt.total_discount_amount) }}원</dd></div>
              <div class="flex justify-between gap-3 border-t border-line-divider pt-1 font-bold"><dt class="text-ink">결제 금액</dt><dd class="tabular-nums text-ink">{{ formatNumber(receipt.total_pay_amount) }}원</dd></div>
            </dl>
          </section>
        </div>

        <div class="mt-6 flex flex-col gap-2">
          <OmButton variant="primary" :to="`/orders/${orderId}`" data-testid="order-detail-link">주문 상세 보기</OmButton>
          <div class="flex gap-2">
            <OmButton class="flex-1" variant="outline" :to="receipt?.sub_orders?.[0]?.partner_id ? `/store/${receipt.sub_orders[0].partner_id}` : '/'">스토어 홈</OmButton>
            <OmButton class="flex-1" variant="outline" to="/">쇼핑 계속하기</OmButton>
          </div>
        </div>
      </template>

      <template v-else>
        <CircleX class="mx-auto h-12 w-12 text-danger" aria-hidden="true" />
        <h1 class="mt-4 text-xl font-bold text-ink">결제하지 못했습니다</h1>
        <p class="mt-2 text-sm text-ink-muted">{{ message }}</p>
        <p class="mt-1 text-xs text-ink-subtle">결제 대기 주문은 30분 후 자동 취소되며 재고·쿠폰·적립금이 복원됩니다. 장바구니 상품은 그대로 남아 있습니다.</p>
        <div v-if="resumeOrderId" class="mt-6 flex flex-wrap items-center justify-center gap-2">
          <label class="text-xs text-ink-muted">결제 수단
            <select v-model="retryMethod" :disabled="resuming" class="ml-1 h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink" aria-label="결제 수단 선택">
              <option v-for="m in RETRY_METHODS" :key="m" :value="m">{{ m }}</option>
            </select>
          </label>
        </div>
        <div class="mt-3 flex flex-wrap justify-center gap-2">
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
