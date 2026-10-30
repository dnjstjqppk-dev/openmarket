<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCartStore } from '../stores/cart'
import { useAuthStore } from '../stores/auth'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const cart = useCartStore()
const auth = useAuthStore()
const locale = useLocaleStore()
const router = useRouter()

const recipientName = ref(auth.user?.name || 'Alex Kim')
const phone = ref('010-8282-5959')
const zipCode = ref('06236')
const address = ref('Teheran-ro 427, Gangnam-gu, Seoul')
const detailAddress = ref('Suite 1502 (Olmoa Tower)')
const paymentMethod = ref('TOSS_PAY')
const submitting = ref(false)
const errorMsg = ref('')

// PCCC & Customs State
const pccc = ref(localStorage.getItem('olmoa_saved_pccc') || 'P123456789012')
const pcccStatus = ref<'IDLE' | 'CHECKING' | 'VERIFIED' | 'INVALID'>('IDLE')
const pcccMsg = ref('')
const customsDutyType = ref<'DDP' | 'DDU'>('DDP')
const dutyEstimate = ref<{
  is_tax_exempt: boolean
  total_order_usd: number
  total_estimated_tax_krw: number
  explanation: string
}>({
  is_tax_exempt: true,
  total_order_usd: 0,
  total_estimated_tax_krw: 0,
  explanation: ''
})

const availableCoupons = ref<any[]>([])
const selectedCouponCode = ref('')
const creditBalance = ref(5000)
const useCreditFlag = ref(false)

const savedAddresses = ref<any[]>([])
const selectedAddressId = ref('')
const deliveryMemo = ref('문 앞 (부재 시 경비실)')

const selectAddress = (addr: any) => {
  selectedAddressId.value = addr.id
  recipientName.value = addr.recipient_name
  phone.value = addr.phone
  zipCode.value = addr.postal_code
  address.value = addr.address_line1
  detailAddress.value = addr.address_line2 || ''
}

const clearToNewAddress = () => {
  selectedAddressId.value = ''
  recipientName.value = auth.user?.name || ''
  phone.value = ''
  zipCode.value = ''
  address.value = ''
  detailAddress.value = ''
}

const validatePccc = async () => {
  const code = (pccc.value || '').trim().toUpperCase()
  if (!code) {
    pcccStatus.value = 'INVALID'
    pcccMsg.value = '개인통관고유부호를 입력해주세요.'
    return
  }
  pcccStatus.value = 'CHECKING'
  pcccMsg.value = '관세청 전자통관시스템(Uni-Pass) 실시간 확인 중...'

  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/customs/validate-pccc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pccc: code,
        name: recipientName.value,
        phone: phone.value
      })
    })
    const json = await res.json()
    if (res.ok && json.verified) {
      pcccStatus.value = 'VERIFIED'
      pcccMsg.value = '관세청 전산 일치 확인 완료 (정상 부호)'
      try { localStorage.setItem('olmoa_saved_pccc', code) } catch (_) {}
    } else {
      pcccStatus.value = 'INVALID'
      pcccMsg.value = json.error || '유효하지 않은 개인통관고유부호입니다.'
    }
  } catch (err: any) {
    pcccStatus.value = 'INVALID'
    pcccMsg.value = '통관부호 검증 통신 오류: ' + (err.message || '다시 시도해주세요.')
  }
}

const fetchDutyEstimate = async () => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/customs/estimate-duty`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goods_amount_krw: cart.subtotalAmount,
        shipping_fee_krw: cart.shippingFee,
        country_origin: 'OTHER'
      })
    })
    if (res.ok) {
      const json = await res.json()
      if (json.data) {
        dutyEstimate.value = json.data
      }
    }
  } catch (_) {}
}

onMounted(async () => {
  const cid = auth.user?.id || 'cust_demo_001'
  fetchDutyEstimate()
  try {
    const [coupRes, credRes, addrRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/coupons?customer_id=${encodeURIComponent(cid)}`),
      fetch(`${API_BASE_URL}/api/v1/credits?customer_id=${encodeURIComponent(cid)}`, { headers: { 'X-Customer-Id': cid } }),
      fetch(`${API_BASE_URL}/api/v1/addresses`, { headers: { 'X-Customer-Id': cid } }).catch(() => ({ json: async () => ({ success: false }) }))
    ])
    const coupJson = await coupRes.json()
    const credJson = await credRes.json()
    const addrJson = await addrRes.json().catch(() => ({}))

    if (coupJson.success && Array.isArray(coupJson.data)) {
      availableCoupons.value = coupJson.data
    }
    if (credJson.success && credJson.data) {
      creditBalance.value = Number(credJson.data.balance || 0)
    }
    if (addrJson?.success && Array.isArray(addrJson.data) && addrJson.data.length > 0) {
      savedAddresses.value = addrJson.data
      const defaultAddr = addrJson.data.find((a: any) => a.is_default) || addrJson.data[0]
      if (defaultAddr) selectAddress(defaultAddr)
    }
  } catch {}
})

const selectedCoupon = computed(() =>
  availableCoupons.value.find(c => c.code === selectedCouponCode.value)
)

const couponDiscount = computed(() => {
  const c = selectedCoupon.value
  if (!c) return 0
  if (cart.subtotalAmount < (c.min_order_amount || 0)) return 0
  if (c.discount_type === 'FIXED') {
    return Math.min(Number(c.discount_value), Number(c.max_discount_amount || c.discount_value))
  }
  const raw = Math.round((cart.subtotalAmount * Number(c.discount_value)) / 100)
  return Math.min(raw, Number(c.max_discount_amount || raw))
})

const appliedCredits = computed(() => {
  if (!useCreditFlag.value) return 0
  const afterCoupon = Math.max(0, cart.subtotalAmount + cart.shippingFee - couponDiscount.value)
  return Math.min(creditBalance.value, afterCoupon)
})

const ddpTariffAmount = computed(() => {
  if (customsDutyType.value === 'DDP' && !dutyEstimate.value.is_tax_exempt) {
    return dutyEstimate.value.total_estimated_tax_krw
  }
  return 0
})

const netPayableTotal = computed(() =>
  Math.max(0, cart.subtotalAmount + cart.shippingFee + ddpTariffAmount.value - couponDiscount.value - appliedCredits.value)
)

const submitOrder = async () => {
  if (cart.items.length === 0) return
  submitting.value = true
  errorMsg.value = ''

  try {
    const cid = auth.user?.id || 'cust_demo_001'
    const code = (pccc.value || '').trim().toUpperCase()

    const payload = {
      customer_id: cid,
      idempotency_key: `idem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      payment_method: paymentMethod.value,
      coupon_code: selectedCouponCode.value || undefined,
      use_credits: appliedCredits.value,
      pccc: code || undefined,
      customs_duty_type: customsDutyType.value,
      estimated_duty_amount: ddpTariffAmount.value,
      currency: locale.currency,
      fx_rate: locale.currency === 'USD' ? (1 / (locale.fxRates?.USD || 1380)) : 1.0,
      recipient_name: recipientName.value,
      recipient_phone: phone.value,
      shipping_postal_code: zipCode.value,
      shipping_address_line1: address.value,
      shipping_address_line2: detailAddress.value,
      shipping_memo: deliveryMemo.value || '',
      shipping_address: {
        recipient: recipientName.value,
        phone: phone.value,
        zip: zipCode.value,
        address: address.value,
        detail: detailAddress.value,
        memo: deliveryMemo.value || ''
      },
      items: cart.items.map(i => ({
        product_id: i.product_id,
        sku_id: i.sku_id,
        partner_id: i.partner_id || 'pt_001',
        quantity: i.quantity,
        unit_price: i.price
      }))
    }

    const res = await fetch(`${API_BASE_URL}/api/v1/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Customer-Id': cid
      },
      body: JSON.stringify(payload)
    })

    const json = await res.json()
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Checkout transaction failed')
    }

    cart.clearCart()
    router.push(`/orders/${json.data.order_id}`)
  } catch (e: any) {
    errorMsg.value = e.message || 'Network error during checkout'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="max-w-[1100px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
    <!-- 3-Step Checkout Progress Indicator -->
    <div class="flex items-center justify-center gap-2 sm:gap-4 text-xs font-bold bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs">
      <RouterLink to="/cart" class="flex items-center gap-1.5 text-slate-400 hover:text-slate-600">
        <span class="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[11px] font-black">1</span>
        <span>장바구니</span>
      </RouterLink>
      <span class="text-slate-300">──</span>
      <div class="flex items-center gap-1.5 text-[#FF5000]">
        <span class="w-6 h-6 rounded-full bg-[#FF5000] text-white flex items-center justify-center text-[11px] font-black shadow-xs">2</span>
        <span>주문 / 결제 (진행중)</span>
      </div>
      <span class="text-slate-300">──</span>
      <div class="flex items-center gap-1.5 text-slate-300">
        <span class="w-6 h-6 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-[11px] font-black">3</span>
        <span>주문완료</span>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl sm:text-2xl font-black text-gray-900">Secure Global Checkout (안심 에스크로 결제)</h1>
        <p class="text-xs text-gray-500 font-medium mt-0.5">글로벌 오픈마켓 100% 에스크로 구매자 보호 및 관세청 통관 연동</p>
      </div>
      <!-- Currency Switcher Badge -->
      <div class="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-gray-200 shadow-xs text-xs font-bold">
        <span class="text-gray-500 font-medium">결제 통화:</span>
        <select
          :value="locale.currency"
          @change="locale.setCurrency(($event.target as HTMLSelectElement).value as any)"
          class="bg-transparent text-[#FF5000] font-black focus:outline-none cursor-pointer"
        >
          <option value="KRW">KRW (₩)</option>
          <option value="USD">USD ($)</option>
          <option value="JPY">JPY (¥)</option>
          <option value="EUR">EUR (€)</option>
        </select>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <div class="lg:col-span-7 space-y-6">
        <!-- 1. Shipping Address Card -->
        <div class="bg-white rounded-2xl p-6 border border-gray-200/80">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-base font-black text-gray-900">1. Shipping Destination (배송지 정보)</h2>
            <span v-if="savedAddresses.length > 0" class="text-xs font-semibold text-[#FF5000]">주소록 연동 완료</span>
          </div>

          <!-- Saved Address Selector Chips -->
          <div v-if="savedAddresses.length > 0" class="mb-4 space-y-2">
            <label class="block text-xs font-bold text-gray-700">저장된 배송지 선택</label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div
                v-for="a in savedAddresses"
                :key="a.id"
                @click="selectAddress(a)"
                :class="['p-3 rounded-xl border cursor-pointer transition text-xs', selectedAddressId === a.id ? 'border-[#FF5000] bg-orange-50/40 ring-1 ring-[#FF5000]' : 'border-gray-200 hover:border-gray-300 bg-white']"
              >
                <div class="flex items-center justify-between mb-1">
                  <span class="font-bold text-gray-900">{{ a.recipient_name }}</span>
                  <span v-if="a.is_default" class="px-1.5 py-0.5 rounded bg-orange-100 text-[#FF5000] text-[10px] font-bold">기본 배송지</span>
                </div>
                <p class="text-gray-600 truncate text-[11px]">{{ a.address_line1 }} {{ a.address_line2 || '' }}</p>
                <p class="text-gray-400 text-[10px] mt-0.5">{{ a.phone }}</p>
              </div>

              <div
                @click="clearToNewAddress"
                :class="['p-3 rounded-xl border border-dashed cursor-pointer transition text-xs flex items-center justify-center gap-1.5', !selectedAddressId ? 'border-[#FF5000] text-[#FF5000] bg-orange-50/30 font-bold' : 'border-gray-300 text-gray-500 hover:bg-gray-50']"
              >
                <span>+</span> 신규 배송지 직접 입력
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label class="block font-bold text-gray-700 mb-1">수령인 성명 (Recipient Name)</label>
              <input v-model="recipientName" class="w-full h-10 px-3 rounded-lg border border-gray-300 font-medium" />
            </div>
            <div>
              <label class="block font-bold text-gray-700 mb-1">연락처 (Mobile Phone)</label>
              <input v-model="phone" class="w-full h-10 px-3 rounded-lg border border-gray-300 font-medium" />
            </div>
            <div>
              <label class="block font-bold text-gray-700 mb-1">우편번호 (Postal Code)</label>
              <input v-model="zipCode" class="w-full h-10 px-3 rounded-lg border border-gray-300 font-medium" />
            </div>
            <div class="sm:col-span-2">
              <label class="block font-bold text-gray-700 mb-1">기본 배송지 주소 (Street Address)</label>
              <input v-model="address" class="w-full h-10 px-3 rounded-lg border border-gray-300 font-medium" />
            </div>
            <div class="sm:col-span-2">
              <label class="block font-bold text-gray-700 mb-1">상세 주소 및 배송 요청사항</label>
              <input v-model="detailAddress" class="w-full h-10 px-3 rounded-lg border border-gray-300 font-medium" />
            </div>
          </div>
        </div>

        <!-- 2. Cross-Border Customs & PCCC Card -->
        <div class="bg-white rounded-2xl p-6 border border-gray-200/80 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-base font-black text-gray-900 flex items-center gap-2">
              <span>2. Customs Clearance (해외통관 및 통관고유부호)</span>
              <span class="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[10px] font-bold">관세청 연동</span>
            </h2>
            <a
              href="https://unipass.customs.go.kr"
              target="_blank"
              rel="noopener"
              class="text-xs text-blue-600 hover:underline font-semibold"
            >
              관세청 부호 발급/조회 ↗
            </a>
          </div>

          <div class="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-3">
            <div>
              <label class="block text-xs font-bold text-gray-800 mb-1">
                개인통관고유부호 (PCCC)
                <span class="text-gray-400 font-normal ml-1">수하인 명의와 일치해야 합니다 (P로 시작하는 13자리)</span>
              </label>
              <div class="flex gap-2">
                <input
                  v-model="pccc"
                  placeholder="예: P123456789012"
                  maxlength="13"
                  class="flex-1 h-10 px-3 rounded-lg border border-gray-300 text-xs font-mono font-bold uppercase tracking-wider bg-white focus:outline-none focus:ring-1 focus:ring-[#FF5000]"
                />
                <button
                  type="button"
                  @click="validatePccc"
                  :disabled="pcccStatus === 'CHECKING'"
                  class="px-4 h-10 rounded-lg bg-gray-900 hover:bg-black text-white text-xs font-bold shrink-0 cursor-pointer disabled:opacity-50 transition-colors"
                >
                  {{ pcccStatus === 'CHECKING' ? '검증 중...' : '관세청 실시간 검증' }}
                </button>
              </div>

              <!-- PCCC Status Message -->
              <div v-if="pcccMsg" class="mt-2 text-xs font-bold flex items-center gap-1.5" :class="pcccStatus === 'VERIFIED' ? 'text-emerald-600' : pcccStatus === 'INVALID' ? 'text-red-500' : 'text-blue-600'">
                <span>{{ pcccStatus === 'VERIFIED' ? '✅' : pcccStatus === 'INVALID' ? '❌' : '⏳' }}</span>
                <span>{{ pcccMsg }}</span>
              </div>
            </div>

            <!-- Customs Duty & Tax Option (DDP vs DDU) -->
            <div class="pt-3 border-t border-slate-200 space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span class="font-bold text-gray-800">관부가세 납부 방식:</span>
                <span v-if="dutyEstimate.is_tax_exempt" class="text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full text-[11px]">
                  ✓ 소액물품 면세 대상 ($150 이하, 관세 ₩0)
                </span>
                <span v-else class="text-amber-600 font-bold bg-amber-50 px-2 py-0.5 rounded-full text-[11px]">
                  ⚠️ 면세한도 초과 (예상 관세 ₩{{ dutyEstimate.total_estimated_tax_krw.toLocaleString() }})
                </span>
              </div>

              <div class="grid grid-cols-2 gap-2 text-xs">
                <label
                  :class="[
                    'p-3 rounded-xl border cursor-pointer transition',
                    customsDutyType === 'DDP' ? 'border-[#FF5000] bg-orange-50/40 text-[#FF5000] font-bold' : 'border-gray-200 bg-white text-gray-700'
                  ]"
                >
                  <input type="radio" value="DDP" v-model="customsDutyType" class="sr-only" />
                  <div class="font-bold mb-0.5">DDP (관부가세 선납)</div>
                  <div class="text-[10px] text-gray-500 font-normal">주문 시 결제, 배송 시 추가비용 없음</div>
                </label>

                <label
                  :class="[
                    'p-3 rounded-xl border cursor-pointer transition',
                    customsDutyType === 'DDU' ? 'border-[#FF5000] bg-orange-50/40 text-[#FF5000] font-bold' : 'border-gray-200 bg-white text-gray-700'
                  ]"
                >
                  <input type="radio" value="DDU" v-model="customsDutyType" class="sr-only" />
                  <div class="font-bold mb-0.5">DDU (수입 통관 시 후납)</div>
                  <div class="text-[10px] text-gray-500 font-normal">인천세관 입항 후 관세사 안내로 납부</div>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- 3. Coupons & Credits Card -->
        <div class="bg-white rounded-2xl p-6 border border-gray-200/80 space-y-4">
          <h2 class="text-base font-black text-gray-900">3. Coupons & Olmoa Reward Credits</h2>
          <div>
            <label class="block text-xs font-bold text-gray-700 mb-1.5">Select Promo Coupon</label>
            <select
              v-model="selectedCouponCode"
              class="w-full h-10 px-3 rounded-xl border border-gray-300 text-xs font-bold bg-white"
            >
              <option value="">-- No Coupon Applied --</option>
              <option
                v-for="c in availableCoupons"
                :key="c.code"
                :value="c.code"
                :disabled="cart.subtotalAmount < (c.min_order_amount || 0)"
              >
                [{{ c.code }}] {{ c.name }} (Min {{ locale.formatPrice(c.min_order_amount || 0) }})
              </option>
            </select>
          </div>

          <div class="flex items-center justify-between p-3.5 rounded-xl bg-orange-50/60 border border-orange-200/80">
            <div>
              <div class="text-xs font-black text-gray-900">Use Olmoa Reward Credits</div>
              <div class="text-[11px] text-gray-600">Available Balance: <strong class="text-[#FF5000]">{{ locale.formatPrice(creditBalance) }}</strong></div>
            </div>
            <label class="inline-flex items-center gap-2 cursor-pointer text-xs font-bold text-[#FF5000]">
              <input type="checkbox" v-model="useCreditFlag" class="w-4 h-4 accent-[#FF5000]" />
              <span>Apply Credits</span>
            </label>
          </div>
        </div>

        <!-- 4. Payment Method Card -->
        <div class="bg-white rounded-2xl p-6 border border-gray-200/80">
          <h2 class="text-base font-black text-gray-900 mb-4">4. Escrow Payment Method (결제 수단)</h2>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-bold">
            <button
              v-for="method in ['TOSS_PAY', 'KAKAO_PAY', 'CREDIT_CARD', 'STRIPE_GLOBAL', 'PAYPAL']"
              :key="method"
              type="button"
              @click="paymentMethod = method"
              :class="[
                'py-3 px-4 rounded-xl border text-center cursor-pointer transition-all',
                paymentMethod === method
                  ? 'border-[#FF5000] bg-orange-50 text-[#FF5000] shadow-xs'
                  : 'border-gray-200 text-gray-700 hover:border-gray-400 bg-white'
              ]"
            >
              {{ method.replace('_', ' ') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Right Summary Sidebar -->
      <div class="lg:col-span-5">
        <div class="bg-white rounded-2xl p-6 border border-gray-200/80 sticky top-24 shadow-sm">
          <h2 class="text-base font-black text-gray-900 mb-4">Final Order Verification</h2>
          <div class="space-y-3 max-h-60 overflow-y-auto mb-4 pr-1">
            <div v-for="item in cart.items" :key="item.sku_id" class="flex justify-between text-xs">
              <span class="text-gray-700 line-clamp-1 flex-1 pr-2">{{ item.title }} × {{ item.quantity }}</span>
              <span class="font-bold text-gray-900">{{ locale.formatPrice(item.price * item.quantity) }}</span>
            </div>
          </div>

          <div class="border-t border-gray-100 pt-3 space-y-2 text-xs text-gray-600 mb-4">
            <div class="flex justify-between">
              <span>Items Subtotal</span>
              <span class="font-bold text-gray-900">{{ locale.formatPrice(cart.subtotalAmount) }}</span>
            </div>
            <div class="flex justify-between">
              <span>Partner Split Shipping ({{ cart.partnerShippingBreakdown.length }} vendor{{ cart.partnerShippingBreakdown.length > 1 ? 's' : '' }})</span>
              <span class="font-bold text-gray-900">{{ cart.shippingFee === 0 ? 'FREE' : locale.formatPrice(cart.shippingFee) }}</span>
            </div>
            <div v-if="ddpTariffAmount > 0" class="flex justify-between text-amber-600 font-bold">
              <span>Customs Duty & Tax (DDP 선납)</span>
              <span>+{{ locale.formatPrice(ddpTariffAmount) }}</span>
            </div>
            <div v-if="couponDiscount > 0" class="flex justify-between text-[#E60023] font-bold">
              <span>Coupon Discount ({{ selectedCouponCode }})</span>
              <span>-{{ locale.formatPrice(couponDiscount) }}</span>
            </div>
            <div v-if="appliedCredits > 0" class="flex justify-between text-[#00A862] font-bold">
              <span>Olmoa Reward Credits Applied</span>
              <span>-{{ locale.formatPrice(appliedCredits) }}</span>
            </div>
          </div>

          <div class="border-t border-gray-200 pt-4 mb-5">
            <div class="flex justify-between items-baseline">
              <span class="text-sm font-black text-gray-900">Total Pay Amount</span>
              <div class="text-right">
                <div class="text-2xl font-black text-[#E60023]">{{ locale.formatPrice(netPayableTotal) }}</div>
                <div v-if="locale.currency !== 'KRW'" class="text-[11px] text-gray-400 font-bold">
                  (약 ₩{{ netPayableTotal.toLocaleString() }} KRW 기준)
                </div>
              </div>
            </div>
          </div>

          <div v-if="errorMsg" class="p-3 rounded-xl bg-red-50 text-[#E60023] text-xs font-bold mb-4">
            {{ errorMsg }}
          </div>

          <button
            @click="submitOrder"
            :disabled="submitting || cart.items.length === 0"
            class="w-full h-13 rounded-full bg-gradient-to-r from-[#FF5000] to-[#E60023] text-white font-black text-sm shadow-md hover:opacity-95 disabled:opacity-50 cursor-pointer transition-all"
          >
            {{ submitting ? 'Executing Atomic D1 Transaction...' : `Pay ${locale.formatPrice(netPayableTotal)} Now` }}
          </button>

          <!-- Security Assurance Trust Badges -->
          <div class="flex items-center justify-around gap-2 pt-4 mt-4 border-t border-gray-100 text-[10px] text-gray-400 font-bold">
            <span class="flex items-center gap-1">🔒 256-Bit SSL 보안</span>
            <span class="flex items-center gap-1">🛡️ 에스크로 안전결제</span>
            <span class="flex items-center gap-1">✈️ 관세청 통관 연동</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
