<script setup lang="ts">
// Checkout: every amount shown comes from the server quote (/api/v1/orders/quote), which uses the same code path
// as order creation, so the price displayed is the price charged.
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useCartStore } from '../stores/cart'
import { useAuthStore } from '../stores/auth'
import { API_BASE_URL, authHeader, newIdempotencyKey } from '../config'

const cart = useCartStore()
const auth = useAuthStore()
const router = useRouter()

const recipientName = ref(auth.user?.name || '')
const phone = ref('')
const zipCode = ref('')
const address = ref('')
const detailAddress = ref('')
const deliveryMemo = ref('')
const savedAddresses = ref<any[]>([])
const selectedAddressId = ref('')

const needsCustoms = ref(false)
const pccc = ref('')
const pcccMsg = ref('')
const pcccOk = ref<boolean | null>(null)

const coupons = ref<any[]>([])
const selectedUserCouponId = ref('')
const creditBalance = ref(0)
const creditToUse = ref(0)

const quote = ref<any>(null)
const quoteError = ref('')
const quoting = ref(false)
const agreeOrder = ref(false)
const submitting = ref(false)
const errorMsg = ref('')
const paymentConfig = ref<{ mode: string; client_key: string | null; is_test_key: boolean | null; message?: string } | null>(null)

// Reuse one idempotency key per checkout attempt so a double click / retry cannot create a second order.
const checkoutKey = ref(newIdempotencyKey('chk'))
const createdOrder = ref<any>(null)

const won = (n: number | undefined | null) => `${Number(n || 0).toLocaleString('ko-KR')}원`

function selectAddress(a: any) {
  selectedAddressId.value = a.id
  recipientName.value = a.recipient_name
  phone.value = a.phone
  zipCode.value = a.postal_code
  address.value = a.address_line1
  detailAddress.value = a.address_line2 || ''
}

function itemsPayload() {
  return cart.items.map((i) => ({ product_id: i.product_id, sku_id: i.sku_id, quantity: i.quantity }))
}

let quoteTimer: any = null
function requestQuote() {
  clearTimeout(quoteTimer)
  quoteTimer = setTimeout(async () => {
    if (!cart.items.length) { quote.value = null; return }
    quoting.value = true
    quoteError.value = ''
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/orders/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ items: itemsPayload(), user_coupon_id: selectedUserCouponId.value || undefined, use_credit_amount: creditToUse.value || 0 })
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) {
        quote.value = null
        quoteError.value = json.error || '주문 금액을 계산하지 못했습니다.'
      } else {
        quote.value = json.data
      }
    } catch {
      quoteError.value = '서버에 연결할 수 없습니다.'
    } finally {
      quoting.value = false
    }
  }, 250)
}

watch([selectedUserCouponId, creditToUse, () => cart.items.map((i) => `${i.sku_id}:${i.quantity}`).join(',')], requestQuote)

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
    selectAddress(ad.data.find((a: any) => Number(a.is_default) === 1) || ad.data[0])
  }
  paymentConfig.value = pc
})

const addressValid = computed(() => recipientName.value.trim() && /^[0-9+\-\s()]{9,20}$/.test(phone.value) && /^\d{5}$/.test(zipCode.value) && address.value.trim())
const canSubmit = computed(() => Boolean(quote.value) && !quoting.value && addressValid.value && agreeOrder.value && !submitting.value
  && (!needsCustoms.value || /^P\d{12}$/.test(pccc.value.trim().toUpperCase())) && paymentConfig.value && paymentConfig.value.mode !== 'DISABLED')

async function validatePccc() {
  const code = pccc.value.trim().toUpperCase()
  pcccOk.value = null
  pcccMsg.value = '확인 중...'
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/customs/validate-pccc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pccc: code, name: recipientName.value, phone: phone.value }) })
    const json = await res.json()
    pcccOk.value = Boolean(json.verified)
    pcccMsg.value = json.verified ? '관세청 조회 일치' : (json.message || json.error || '형식은 올바르나 관세청 실시간 조회는 확인되지 않았습니다.')
  } catch {
    pcccOk.value = false
    pcccMsg.value = '조회 중 오류가 발생했습니다.'
  }
}

async function createOrderOnce() {
  if (createdOrder.value) return createdOrder.value
  const res = await fetch(`${API_BASE_URL}/api/v1/orders/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': checkoutKey.value, ...authHeader() },
    body: JSON.stringify({
      items: itemsPayload(),
      user_coupon_id: selectedUserCouponId.value || undefined,
      use_credit_amount: creditToUse.value || 0,
      recipient_name: recipientName.value, recipient_phone: phone.value,
      shipping_postal_code: zipCode.value, shipping_address_line1: address.value, shipping_address_line2: detailAddress.value,
      shipping_memo: deliveryMemo.value,
      pccc: needsCustoms.value ? pccc.value.trim().toUpperCase() : undefined
    })
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.success) throw new Error(json.error || '주문 생성에 실패했습니다.')
  createdOrder.value = json.data
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
  if (!canSubmit.value) return
  submitting.value = true
  errorMsg.value = ''
  try {
    const order = await createOrderOnce()
    if (order.payment_status === 'PAID') { // fully covered by credits/coupon
      cart.clearCart()
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
      const first = cart.items[0]
      await toss.requestPayment('카드', {
        amount: order.total_pay_amount,
        orderId: order.order_no,
        orderName: cart.items.length > 1 ? `${first.title} 외 ${cart.items.length - 1}건` : first.title,
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
  <div class="max-w-[1100px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
    <ol class="flex items-center justify-center gap-2 sm:gap-4 text-xs font-bold mb-6" aria-label="주문 단계">
      <li><RouterLink to="/cart" class="text-slate-400 hover:text-slate-600">1. 장바구니</RouterLink></li>
      <li aria-hidden="true" class="text-slate-300">›</li>
      <li class="text-[#FF5000]" aria-current="step">2. 주문/결제</li>
      <li aria-hidden="true" class="text-slate-300">›</li>
      <li class="text-slate-300">3. 주문완료</li>
    </ol>

    <h1 class="text-xl sm:text-2xl font-black text-gray-900 mb-1">주문/결제</h1>
    <p class="text-xs text-gray-500 mb-6">표시된 결제 금액은 서버에서 계산된 실제 청구 금액입니다.</p>

    <div v-if="!cart.items.length" class="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
      장바구니가 비어 있습니다. <RouterLink to="/" class="text-[#FF5000] font-bold underline">쇼핑 계속하기</RouterLink>
    </div>

    <div v-else class="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
      <div class="space-y-5">
        <!-- Shipping address -->
        <section class="bg-white rounded-2xl border border-slate-200 p-5" aria-labelledby="sec-addr">
          <h2 id="sec-addr" class="font-black text-gray-900 mb-4">배송지</h2>
          <div v-if="savedAddresses.length" class="flex flex-wrap gap-2 mb-4">
            <button v-for="a in savedAddresses" :key="a.id" type="button" @click="selectAddress(a)"
              :class="['px-3 py-2 rounded-xl border text-xs text-left', selectedAddressId === a.id ? 'border-[#FF5000] bg-orange-50' : 'border-slate-200']">
              <span class="font-bold">{{ a.recipient_name }}</span>
              <span v-if="Number(a.is_default) === 1" class="ml-1 text-[10px] text-[#FF5000] font-bold">기본</span>
              <span class="block text-slate-500 truncate max-w-[220px]">{{ a.address_line1 }}</span>
            </button>
          </div>
          <div class="grid sm:grid-cols-2 gap-3 text-xs">
            <label class="block"><span class="font-bold text-gray-700">수령인</span>
              <input v-model="recipientName" autocomplete="name" class="mt-1 w-full h-10 px-3 rounded-lg border border-gray-300" /></label>
            <label class="block"><span class="font-bold text-gray-700">연락처</span>
              <input v-model="phone" type="tel" autocomplete="tel" placeholder="010-0000-0000" class="mt-1 w-full h-10 px-3 rounded-lg border border-gray-300" /></label>
            <label class="block"><span class="font-bold text-gray-700">우편번호</span>
              <input v-model="zipCode" inputmode="numeric" maxlength="5" autocomplete="postal-code" class="mt-1 w-full h-10 px-3 rounded-lg border border-gray-300" /></label>
            <label class="block sm:col-span-2"><span class="font-bold text-gray-700">주소</span>
              <input v-model="address" autocomplete="address-line1" class="mt-1 w-full h-10 px-3 rounded-lg border border-gray-300" /></label>
            <label class="block sm:col-span-2"><span class="font-bold text-gray-700">상세주소</span>
              <input v-model="detailAddress" autocomplete="address-line2" class="mt-1 w-full h-10 px-3 rounded-lg border border-gray-300" /></label>
            <label class="block sm:col-span-2"><span class="font-bold text-gray-700">배송 메모</span>
              <input v-model="deliveryMemo" maxlength="200" placeholder="예: 문 앞에 놓아 주세요" class="mt-1 w-full h-10 px-3 rounded-lg border border-gray-300" /></label>
          </div>
          <p v-if="!addressValid" class="mt-2 text-[11px] text-amber-700">수령인, 연락처, 5자리 우편번호, 주소를 입력해 주세요.</p>
        </section>

        <!-- Customs (optional) -->
        <section class="bg-white rounded-2xl border border-slate-200 p-5" aria-labelledby="sec-customs">
          <label class="flex items-center gap-2 text-sm font-black text-gray-900" id="sec-customs">
            <input type="checkbox" v-model="needsCustoms" class="w-4 h-4 accent-[#FF5000]" /> 해외직구 상품 포함 (개인통관고유부호 입력)
          </label>
          <div v-if="needsCustoms" class="mt-3 flex gap-2 text-xs">
            <input v-model="pccc" maxlength="13" placeholder="P로 시작하는 13자리" aria-label="개인통관고유부호" class="flex-1 h-10 px-3 rounded-lg border border-gray-300 uppercase" />
            <button type="button" @click="validatePccc" class="px-3 rounded-lg bg-slate-900 text-white font-bold">조회</button>
          </div>
          <p v-if="needsCustoms && pcccMsg" class="mt-2 text-[11px]" :class="pcccOk ? 'text-emerald-600' : 'text-slate-500'">{{ pcccMsg }}</p>
          <p v-if="needsCustoms" class="mt-1 text-[11px] text-slate-400">관부가세는 결제 금액에 포함되지 않으며, 부과 시 통관 단계에서 별도 안내됩니다.</p>
        </section>

        <!-- Discounts -->
        <section class="bg-white rounded-2xl border border-slate-200 p-5 text-xs space-y-4" aria-labelledby="sec-disc">
          <h2 id="sec-disc" class="font-black text-gray-900 text-sm">할인 · 적립금</h2>
          <label class="block"><span class="font-bold text-gray-700">쿠폰</span>
            <select v-model="selectedUserCouponId" class="mt-1 w-full h-10 px-3 rounded-lg border border-gray-300 bg-white">
              <option value="">사용 안 함</option>
              <option v-for="c in coupons" :key="c.user_coupon_id" :value="c.user_coupon_id">{{ c.title || c.code }} · 최소 {{ won(c.min_order_amount) }}</option>
            </select>
          </label>
          <label class="block"><span class="font-bold text-gray-700">적립금 사용 <span class="font-normal text-slate-500">(보유 {{ won(creditBalance) }})</span></span>
            <div class="mt-1 flex gap-2">
              <input v-model.number="creditToUse" type="number" min="0" :max="creditBalance" step="1" class="flex-1 h-10 px-3 rounded-lg border border-gray-300" />
              <button type="button" class="px-3 rounded-lg border border-slate-300 font-bold" @click="creditToUse = creditBalance">전액</button>
            </div>
          </label>
        </section>
      </div>

      <!-- Summary -->
      <aside class="bg-white rounded-2xl border border-slate-200 p-5 lg:sticky lg:top-24" aria-labelledby="sec-sum">
        <h2 id="sec-sum" class="font-black text-gray-900 mb-3">결제 금액</h2>
        <div v-if="quoteError" role="alert" class="p-3 rounded-xl bg-red-50 text-red-700 text-xs font-bold mb-3">{{ quoteError }}</div>
        <dl v-if="quote" class="text-xs space-y-2" :class="{ 'opacity-50': quoting }" aria-live="polite">
          <div class="flex justify-between"><dt>상품 금액</dt><dd class="font-bold">{{ won(quote.total_goods_amount) }}</dd></div>
          <div v-if="quote.volume_discount_amount" class="flex justify-between text-[#E60023]"><dt>수량 할인</dt><dd>-{{ won(quote.volume_discount_amount) }}</dd></div>
          <div v-if="quote.coupon_discount_amount" class="flex justify-between text-[#E60023]"><dt>쿠폰 할인</dt><dd>-{{ won(quote.coupon_discount_amount) }}</dd></div>
          <div class="flex justify-between"><dt>배송비 ({{ quote.sub_orders.length }}개 판매자)</dt><dd class="font-bold">{{ quote.total_shipping_amount ? won(quote.total_shipping_amount) : '무료' }}</dd></div>
          <div v-if="quote.credit_used_amount" class="flex justify-between text-emerald-700"><dt>적립금 사용</dt><dd>-{{ won(quote.credit_used_amount) }}</dd></div>
          <div class="flex justify-between items-end pt-3 border-t border-slate-100"><dt class="font-black text-sm">최종 결제 금액</dt>
            <dd class="text-2xl font-black text-[#E60023]" data-testid="pay-total">{{ won(quote.total_pay_amount) }}</dd></div>
        </dl>
        <div v-else-if="!quoteError" class="text-xs text-slate-400">금액 계산 중...</div>

        <div class="mt-4 p-3 rounded-xl bg-slate-50 text-[11px] text-slate-600 space-y-1">
          <div class="font-bold text-slate-800">결제 수단</div>
          <div v-if="!paymentConfig">확인 중...</div>
          <div v-else-if="paymentConfig.mode === 'TOSS'">토스페이먼츠 카드/간편결제<span v-if="paymentConfig.is_test_key" class="ml-1 text-amber-700 font-bold">(테스트 키 · 실제 청구 없음)</span></div>
          <div v-else-if="paymentConfig.mode === 'SANDBOX_SIMULATOR'" class="text-amber-700 font-bold">개발용 결제 시뮬레이터 — 실제 결제가 발생하지 않습니다.</div>
          <div v-else class="text-red-700 font-bold">{{ paymentConfig.message || '결제 수단이 연동되지 않았습니다.' }}</div>
        </div>

        <label class="mt-4 flex items-start gap-2 text-[11px] text-slate-700">
          <input type="checkbox" v-model="agreeOrder" class="mt-0.5 w-4 h-4 accent-[#FF5000]" />
          <span>[필수] 주문 상품의 상품명·가격·배송정보를 확인하였으며, 구매에 동의합니다. (전자상거래법 제8조) · 판매자가 다른 상품은 판매자별로 배송·환불됩니다.</span>
        </label>

        <div v-if="errorMsg" role="alert" class="mt-3 p-3 rounded-xl bg-red-50 text-[#E60023] text-xs font-bold">{{ errorMsg }}</div>

        <button type="button" data-testid="pay-button" @click="submitOrder" :disabled="!canSubmit"
          class="mt-4 w-full h-12 rounded-xl bg-[#FF5000] hover:bg-[#E64800] disabled:bg-slate-300 text-white font-black text-sm transition">
          {{ submitting ? '처리 중...' : quote ? `${won(quote.total_pay_amount)} 결제하기` : '결제하기' }}
        </button>
        <p class="mt-2 text-[10px] text-slate-400 text-center">결제 대기 주문은 30분 후 자동 취소되며 재고·쿠폰·적립금이 복원됩니다.</p>
      </aside>
    </div>
  </div>
</template>
