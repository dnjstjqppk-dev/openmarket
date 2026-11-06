<script setup lang="ts">
// Checkout (PHASE 2 redesign on @olmoa/ui). Every amount shown comes from the server quote
// (/api/v1/orders/quote = createOrder dry run), so the price displayed is the price charged.
// Only the cart lines the buyer selected are ordered; after payment only those lines leave the cart.
// PCCC: the server only says "verified" after a real Uni-Pass match; a well-formed code is shown as
// "형식 확인" (it used to be shown as "관세청 조회 일치" for any P+12 digits).
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { MapPin, ShoppingCart, Store } from 'lucide-vue-next'
import { OmButton, OmInput, OmSelect, OmCheckbox, OmRadio, OmAlert, OmBadge, OmEmptyState, OmSkeleton, formatNumber } from '@olmoa/ui'
import CheckoutSteps from '../components/CheckoutSteps.vue'
import { useCartStore } from '../stores/cart'
import { useAuthStore } from '../stores/auth'
import { useLocaleStore } from '../stores/locale'
import { fetchQuote, type Quote } from '../lib/quote'
import { API_BASE_URL, authHeader, newIdempotencyKey } from '../config'

const cart = useCartStore()
const auth = useAuthStore()
const router = useRouter()
const locale = useLocaleStore()
// Payment is in KRW, so the order sheet always shows KRW (same notation as the cart and product pages).
const won = (n: number | undefined | null) => locale.formatPrice(Number(n || 0), 'KRW')

// The lines this order is made of — fixed when the page opens so a cart change in another tab cannot
// silently change what is being paid for.
const lines = ref(cart.selectedItems.map((i) => ({ ...i })))
const sellerName = (pid: string) => lines.value.find((l) => l.partner_id === pid)?.business_name || '판매자'
const thumbOf = (sku: string) => lines.value.find((l) => l.sku_id === sku)?.thumbnail_url

// ---- address ----------------------------------------------------------------------------------------
const recipientName = ref(auth.user?.name || '')
const phone = ref('')
const zipCode = ref('')
const address = ref('')
const detailAddress = ref('')
const deliveryMemo = ref('')
const savedAddresses = ref<any[]>([])
const addressChoice = ref<string | number | null>('new')
const addressOptions = computed(() => [
  ...savedAddresses.value.map((a) => ({ value: a.id, label: `${a.recipient_name}${Number(a.is_default) === 1 ? ' (기본)' : ''}`, description: `${a.address_line1}${a.address_line2 ? ` ${a.address_line2}` : ''} · ${a.phone}` })),
  { value: 'new', label: '새 배송지 입력', description: '이번 주문에만 사용합니다' }
])
watch(addressChoice, (id) => {
  const a = savedAddresses.value.find((x) => x.id === id)
  if (!a) return
  recipientName.value = a.recipient_name
  phone.value = a.phone
  zipCode.value = a.postal_code
  address.value = a.address_line1
  detailAddress.value = a.address_line2 || ''
})
const showErrors = ref(false)
const fieldErrors = computed(() => ({
  name: recipientName.value.trim() ? null : '수령인을 입력해 주세요',
  phone: /^[0-9+\-\s()]{9,20}$/.test(phone.value) ? null : '연락처를 숫자로 입력해 주세요 (예: 010-1234-5678)',
  zip: /^\d{5}$/.test(zipCode.value) ? null : '우편번호 5자리를 입력해 주세요',
  address: address.value.trim() ? null : '주소를 입력해 주세요'
}))
const addressValid = computed(() => Object.values(fieldErrors.value).every((e) => !e))
const err = (k: keyof typeof fieldErrors.value) => (showErrors.value ? fieldErrors.value[k] : null)

// ---- customs ----------------------------------------------------------------------------------------
const needsCustoms = ref(false)
const pccc = ref('')
const pcccResult = ref<{ verified: boolean; message: string; ok: boolean } | null>(null)
const pcccChecking = ref(false)
const pcccFormatOk = computed(() => /^P\d{12}$/.test(pccc.value.trim().toUpperCase()))
watch(pccc, () => { pcccResult.value = null })
async function validatePccc() {
  pcccChecking.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/customs/validate-pccc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pccc: pccc.value.trim().toUpperCase(), name: recipientName.value, phone: phone.value }) })
    const json = await res.json().catch(() => ({}))
    pcccResult.value = { ok: res.ok && json.success, verified: Boolean(json.verified), message: json.message || json.error || '확인하지 못했습니다' }
  } catch {
    pcccResult.value = { ok: false, verified: false, message: '조회 중 오류가 발생했습니다' }
  } finally {
    pcccChecking.value = false
  }
}

// ---- coupons / credits ------------------------------------------------------------------------------
const coupons = ref<any[]>([])
const selectedUserCouponId = ref<string | number | null>('')
const creditBalance = ref(0)
const creditToUse = ref<number | string | null>(0)
const creditAmount = computed(() => Math.min(creditBalance.value, Math.max(0, Math.floor(Number(creditToUse.value) || 0))))
const couponOptions = computed(() => [
  { value: '', label: coupons.value.length ? '사용 안 함' : '사용할 수 있는 쿠폰이 없습니다' },
  ...coupons.value.map((c) => ({
    value: c.user_coupon_id,
    label: `${c.title || c.code} · ${c.discount_type === 'PERCENT' ? `${c.discount_value}%${c.max_discount_amount ? ` (최대 ${won(c.max_discount_amount)})` : ''}` : won(c.discount_value)} · ${won(c.min_order_amount)} 이상`
  }))
])

// ---- quote ------------------------------------------------------------------------------------------
const quote = ref<Quote | null>(null)
const quoteError = ref('')
const quoting = ref(false)
let ctrl: AbortController | null = null
let timer: ReturnType<typeof setTimeout> | null = null
const itemsPayload = () => lines.value.map((i) => ({ product_id: i.product_id, sku_id: i.sku_id, quantity: i.quantity }))
function requestQuote() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    ctrl?.abort()
    if (!lines.value.length) { quote.value = null; return }
    const my = (ctrl = new AbortController())
    quoting.value = true
    quoteError.value = ''
    try {
      quote.value = await fetchQuote({ items: itemsPayload(), user_coupon_id: selectedUserCouponId.value ? String(selectedUserCouponId.value) : undefined, use_credit_amount: creditAmount.value }, my.signal)
    } catch (e: any) {
      if (my.signal.aborted || e?.name === 'AbortError') return
      quote.value = null
      quoteError.value = e?.message || '주문 금액을 계산하지 못했습니다'
    } finally {
      if (!my.signal.aborted) quoting.value = false
    }
  }, 250)
}
watch([selectedUserCouponId, creditAmount], requestQuote)
onBeforeUnmount(() => { ctrl?.abort(); if (timer) clearTimeout(timer) })

const paymentConfig = ref<{ mode: string; client_key: string | null; is_test_key: boolean | null; message?: string } | null>(null)
const sideLoading = ref(true)
onMounted(async () => {
  requestQuote()
  const h = { headers: { ...authHeader() } }
  const [c, cr, ad, pc] = await Promise.all([
    fetch(`${API_BASE_URL}/api/v1/coupons`, h).then((r) => r.json()).catch(() => ({})),
    fetch(`${API_BASE_URL}/api/v1/credits`, h).then((r) => r.json()).catch(() => ({})),
    fetch(`${API_BASE_URL}/api/v1/addresses`, h).then((r) => r.json()).catch(() => ({})),
    fetch(`${API_BASE_URL}/api/v1/payments/config`).then((r) => r.json()).catch(() => null)
  ])
  coupons.value = Array.isArray(c.data) ? c.data.filter((x: any) => x.is_claimed && !x.is_used) : []
  creditBalance.value = Number(cr?.data?.balance || 0)
  if (Array.isArray(ad.data) && ad.data.length) {
    savedAddresses.value = ad.data
    addressChoice.value = (ad.data.find((a: any) => Number(a.is_default) === 1) || ad.data[0]).id
  }
  paymentConfig.value = pc
  sideLoading.value = false
})

// ---- submit -----------------------------------------------------------------------------------------
const agreeOrder = ref(false)
const submitting = ref(false)
const errorMsg = ref('')
// One idempotency key per checkout attempt so a double click / retry cannot create a second order.
const checkoutKey = ref(newIdempotencyKey('chk'))
const createdOrder = ref<any>(null)
const paymentReady = computed(() => !!paymentConfig.value && paymentConfig.value.mode !== 'DISABLED')
const blockers = computed(() => {
  const b: string[] = []
  if (!quote.value) b.push(quoting.value ? '금액 계산 중' : '금액을 확인할 수 없음')
  if (!addressValid.value) b.push('배송지 입력')
  if (needsCustoms.value && !pcccFormatOk.value) b.push('개인통관고유부호 입력')
  if (!agreeOrder.value) b.push('구매 동의')
  if (!paymentReady.value) b.push('결제 수단 연동 필요')
  return b
})
const canSubmit = computed(() => !blockers.value.length && !submitting.value && !quoting.value)
// The button stays clickable for form problems (address, PCCC, consent) so a click can point them out;
// it is disabled only for what the buyer cannot fix here (no quote yet, no payment method, busy).
const payDisabled = computed(() => !quote.value || quoting.value || !paymentReady.value || submitting.value)

async function createOrderOnce() {
  if (createdOrder.value) return createdOrder.value
  const res = await fetch(`${API_BASE_URL}/api/v1/orders/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': checkoutKey.value, ...authHeader() },
    body: JSON.stringify({
      items: itemsPayload(),
      user_coupon_id: selectedUserCouponId.value || undefined,
      use_credit_amount: creditAmount.value,
      recipient_name: recipientName.value, recipient_phone: phone.value,
      shipping_postal_code: zipCode.value, shipping_address_line1: address.value, shipping_address_line2: detailAddress.value,
      shipping_memo: deliveryMemo.value,
      pccc: needsCustoms.value ? pccc.value.trim().toUpperCase() : undefined
    })
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.success) throw new Error(json.error || '주문 생성에 실패했습니다.')
  createdOrder.value = json.data
  cart.markPending(json.data.order_no, lines.value.map((l) => l.sku_id))
  return json.data
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

async function submitOrder() {
  showErrors.value = true
  if (!canSubmit.value) {
    requestAnimationFrame(() => document.querySelector<HTMLElement>('#main [aria-invalid="true"]')?.focus())
    return
  }
  submitting.value = true
  errorMsg.value = ''
  try {
    const order = await createOrderOnce()
    if (order.payment_status === 'PAID') { // fully covered by credits/coupon
      cart.completeCheckout(order.order_no)
      return router.push(`/orders/${order.order_id}`)
    }
    const mode = paymentConfig.value?.mode
    if (mode === 'SANDBOX_SIMULATOR') {
      const key = `sandbox_${newIdempotencyKey('pay').replace(/[^A-Za-z0-9_-]/g, '')}`
      return router.push({ path: '/payments/success', query: { orderId: order.order_no, paymentKey: key, amount: String(order.total_pay_amount), simulator: '1' } })
    }
    if (mode === 'TOSS' && paymentConfig.value?.client_key) {
      const TossPayments = await loadTossSdk()
      const toss = TossPayments(paymentConfig.value.client_key)
      const first = lines.value[0]
      await toss.requestPayment('카드', {
        amount: order.total_pay_amount,
        orderId: order.order_no,
        orderName: lines.value.length > 1 ? `${first.title} 외 ${lines.value.length - 1}건` : first.title,
        customerName: recipientName.value,
        successUrl: `${window.location.origin}/payments/success`,
        failUrl: `${window.location.origin}/payments/fail`
      })
      return
    }
    throw new Error('결제 수단이 연동되지 않았습니다.')
  } catch (e: any) {
    errorMsg.value = e?.message || '결제를 진행하지 못했습니다.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-container px-4 pb-16 pt-6 sm:px-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-bold text-ink">주문/결제</h1>
      <CheckoutSteps :current="2" />
    </div>

    <OmEmptyState v-if="!lines.length" class="mt-6" title="주문할 상품이 없습니다" description="장바구니에서 주문할 상품을 선택해 주세요.">
      <template #icon><ShoppingCart class="h-8 w-8" aria-hidden="true" /></template>
      <OmButton to="/cart" variant="primary" size="sm">장바구니로</OmButton>
    </OmEmptyState>

    <div v-else class="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div class="min-w-0 space-y-5">
        <!-- address -->
        <section class="rounded-lg border border-line bg-surface p-5" aria-labelledby="sec-addr">
          <div class="mb-4 flex items-center justify-between">
            <h2 id="sec-addr" class="flex items-center gap-2 text-lg font-bold text-ink"><MapPin class="h-5 w-5 text-ink-muted" aria-hidden="true" />배송지</h2>
            <RouterLink to="/addresses" class="text-sm text-ink-muted hover:text-ink">배송지 관리</RouterLink>
          </div>
          <OmSkeleton v-if="sideLoading" :lines="2" />
          <OmRadio v-else-if="savedAddresses.length" v-model="addressChoice" name="address" :options="addressOptions" card class="mb-4" />
          <div class="grid gap-3 sm:grid-cols-2">
            <OmInput v-model="recipientName" label="수령인" required autocomplete="name" :error="err('name')" />
            <OmInput v-model="phone" label="연락처" required type="tel" autocomplete="tel" placeholder="010-0000-0000" :error="err('phone')" />
            <OmInput v-model="zipCode" label="우편번호" required inputmode="numeric" maxlength="5" autocomplete="postal-code" :error="err('zip')" />
            <div class="hidden sm:block" />
            <div class="sm:col-span-2"><OmInput v-model="address" label="주소" required autocomplete="address-line1" :error="err('address')" /></div>
            <div class="sm:col-span-2"><OmInput v-model="detailAddress" label="상세주소" autocomplete="address-line2" /></div>
            <div class="sm:col-span-2"><OmInput v-model="deliveryMemo" label="배송 메모" maxlength="200" placeholder="예: 문 앞에 놓아 주세요" /></div>
          </div>
        </section>

        <!-- items (server quote) -->
        <section class="rounded-lg border border-line bg-surface" aria-labelledby="sec-items">
          <h2 id="sec-items" class="border-b border-line-divider px-5 py-4 text-lg font-bold text-ink">주문 상품 <span class="text-md font-medium text-ink-muted">{{ lines.length }}</span></h2>
          <div v-if="!quote && quoting" class="p-5"><OmSkeleton variant="row" :count="lines.length" /></div>
          <ul v-else-if="quote" class="divide-y divide-line-divider">
            <li v-for="s in quote.sub_orders" :key="s.partner_id" class="px-5 py-4">
              <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p class="inline-flex items-center gap-1.5 text-sm font-semibold text-ink"><Store class="h-4 w-4 text-ink-muted" aria-hidden="true" />{{ sellerName(s.partner_id) }}</p>
                <p class="text-xs text-ink-muted">배송비 {{ s.shipping_fee ? won(s.shipping_fee) : '무료' }}</p>
              </div>
              <ul class="space-y-3">
                <li v-for="it in s.items" :key="it.sku_id" class="flex gap-3">
                  <img :src="thumbOf(it.sku_id)" :alt="it.title" class="h-16 w-16 shrink-0 rounded-md border border-line bg-surface-2 object-cover" loading="lazy" />
                  <div class="min-w-0 flex-1">
                    <p class="line-clamp-2 text-sm text-ink">{{ it.title }}</p>
                    <p class="text-xs text-ink-muted">{{ it.option_summary }} · {{ formatNumber(it.quantity) }}개<template v-if="it.volume_discount_pct"> · 수량 할인 {{ it.volume_discount_pct }}%</template></p>
                  </div>
                  <p class="shrink-0 text-sm font-semibold tabular-nums text-ink">{{ won(it.line_total) }}</p>
                </li>
              </ul>
            </li>
          </ul>
          <OmAlert v-else-if="quoteError" tone="danger" class="m-5">{{ quoteError }} <RouterLink to="/cart" class="underline">장바구니에서 수정</RouterLink></OmAlert>
        </section>

        <!-- customs -->
        <section class="rounded-lg border border-line bg-surface p-5" aria-labelledby="sec-customs">
          <h2 id="sec-customs" class="sr-only">해외직구 통관 정보</h2>
          <OmCheckbox v-model="needsCustoms" label="해외직구 상품이 포함되어 있습니다" description="개인통관고유부호가 필요합니다. 관부가세는 결제 금액에 포함되지 않으며 부과 시 통관 단계에서 따로 안내됩니다." />
          <div v-if="needsCustoms" class="mt-4 flex items-start gap-2">
            <div class="flex-1"><OmInput v-model="pccc" label="개인통관고유부호" required maxlength="13" placeholder="P로 시작하는 13자리" :error="showErrors && !pcccFormatOk ? 'P로 시작하는 13자리를 입력해 주세요' : null" /></div>
            <OmButton class="mt-6" variant="outline" :loading="pcccChecking" :disabled="!pcccFormatOk" @click="validatePccc">확인</OmButton>
          </div>
          <p v-if="needsCustoms && pcccResult" class="mt-2 flex items-start gap-2 text-xs" role="status">
            <OmBadge :tone="pcccResult.verified ? 'success' : pcccResult.ok ? 'neutral' : 'danger'">{{ pcccResult.verified ? '관세청 조회 일치' : pcccResult.ok ? '형식 확인' : '확인 실패' }}</OmBadge>
            <span class="text-ink-muted">{{ pcccResult.message }}</span>
          </p>
        </section>

        <!-- discounts -->
        <section class="rounded-lg border border-line bg-surface p-5" aria-labelledby="sec-disc">
          <h2 id="sec-disc" class="mb-4 text-lg font-bold text-ink">할인 · 적립금</h2>
          <div class="grid gap-4 sm:grid-cols-2">
            <OmSelect v-model="selectedUserCouponId" label="쿠폰" :options="couponOptions" :disabled="!coupons.length" />
            <div>
              <div class="flex items-end gap-2">
                <div class="flex-1"><OmInput v-model="creditToUse" label="적립금" type="number" min="0" :max="creditBalance" step="1" :help="`보유 ${won(creditBalance)}`" :disabled="!creditBalance" /></div>
                <OmButton class="mb-6" variant="outline" :disabled="!creditBalance" @click="creditToUse = creditBalance">전액</OmButton>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- summary / pay -->
      <aside class="rounded-lg border border-line bg-surface p-5 lg:sticky lg:top-24" aria-labelledby="sec-sum">
        <h2 id="sec-sum" class="text-lg font-bold text-ink">결제 금액 <span class="text-xs font-normal text-ink-muted">원화(KRW) 결제</span></h2>
        <OmAlert v-if="quoteError" tone="danger" class="mt-3">{{ quoteError }}</OmAlert>
        <dl v-if="quote" class="mt-4 space-y-2 text-sm" :class="{ 'opacity-60': quoting }" aria-live="polite">
          <div class="flex justify-between"><dt class="text-ink-muted">상품 금액</dt><dd class="tabular-nums text-ink">{{ won(quote.total_goods_amount) }}</dd></div>
          <div v-if="quote.volume_discount_amount" class="flex justify-between"><dt class="text-ink-muted">수량 할인</dt><dd class="tabular-nums text-accent">-{{ won(quote.volume_discount_amount) }}</dd></div>
          <div v-if="quote.coupon_discount_amount" class="flex justify-between"><dt class="text-ink-muted">쿠폰 할인</dt><dd class="tabular-nums text-accent">-{{ won(quote.coupon_discount_amount) }}</dd></div>
          <div class="flex justify-between"><dt class="text-ink-muted">배송비 ({{ quote.sub_orders.length }}개 판매자)</dt><dd class="tabular-nums text-ink">{{ quote.total_shipping_amount ? won(quote.total_shipping_amount) : '무료' }}</dd></div>
          <div v-if="quote.credit_used_amount" class="flex justify-between"><dt class="text-ink-muted">적립금 사용</dt><dd class="tabular-nums text-accent">-{{ won(quote.credit_used_amount) }}</dd></div>
          <div class="flex items-baseline justify-between border-t border-line-divider pt-3">
            <dt class="font-semibold text-ink">최종 결제 금액</dt>
            <dd class="text-2xl font-bold tabular-nums text-ink" data-testid="pay-total">{{ won(quote.total_pay_amount) }}</dd>
          </div>
        </dl>
        <OmSkeleton v-else-if="!quoteError" class="mt-4" :lines="4" />

        <div class="mt-4 rounded-md bg-surface-2 p-3 text-xs">
          <p class="font-semibold text-ink">결제 수단</p>
          <p v-if="!paymentConfig" class="mt-1 text-ink-muted">확인 중…</p>
          <p v-else-if="paymentConfig.mode === 'TOSS'" class="mt-1 text-ink-muted">토스페이먼츠 카드·간편결제<OmBadge v-if="paymentConfig.is_test_key" tone="warning" class="ml-1">테스트 키 · 실제 청구 없음</OmBadge></p>
          <p v-else-if="paymentConfig.mode === 'SANDBOX_SIMULATOR'" class="mt-1 font-medium text-warning">개발용 결제 시뮬레이터 — 실제 결제가 발생하지 않습니다.</p>
          <p v-else class="mt-1 font-medium text-danger">{{ paymentConfig.message || '결제 수단이 연동되지 않았습니다.' }}</p>
        </div>

        <div class="mt-4">
          <OmCheckbox v-model="agreeOrder" :error="showErrors && !agreeOrder">
            <span class="text-xs text-ink">[필수] 주문 상품의 상품명·가격·배송정보를 확인했으며 구매에 동의합니다. (전자상거래법 제8조) 판매자가 다른 상품은 판매자별로 배송·환불됩니다.</span>
          </OmCheckbox>
        </div>

        <OmAlert v-if="errorMsg" tone="danger" class="mt-3">{{ errorMsg }}</OmAlert>
        <OmButton class="mt-4" data-testid="pay-button" variant="primary" size="lg" block :loading="submitting" :disabled="payDisabled" @click="submitOrder">
          {{ quote ? `${won(quote.total_pay_amount)} 결제하기` : '결제하기' }}
        </OmButton>
        <p v-if="blockers.length && !submitting && (showErrors || payDisabled)" class="mt-2 text-center text-2xs text-danger" role="status">확인 필요: {{ blockers.join(' · ') }}</p>
        <p class="mt-2 text-center text-2xs text-ink-subtle">결제 대기 주문은 30분 후 자동 취소되며 재고·쿠폰·적립금이 복원됩니다.</p>
      </aside>
    </div>
  </div>
</template>
