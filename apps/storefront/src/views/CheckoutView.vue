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

const availableCoupons = ref<any[]>([])
const selectedCouponCode = ref('')
const creditBalance = ref(5000)
const useCreditFlag = ref(false)

onMounted(async () => {
  const cid = auth.user?.id || 'cust_demo_001'
  try {
    const [coupRes, credRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/coupons?customer_id=${encodeURIComponent(cid)}`),
      fetch(`${API_BASE_URL}/api/v1/credits?customer_id=${encodeURIComponent(cid)}`, { headers: { 'X-Customer-Id': cid } })
    ])
    const coupJson = await coupRes.json()
    const credJson = await credRes.json()
    if (coupJson.success && Array.isArray(coupJson.data)) {
      availableCoupons.value = coupJson.data
    }
    if (credJson.success && credJson.data) {
      creditBalance.value = Number(credJson.data.balance || 0)
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

const netPayableTotal = computed(() =>
  Math.max(0, cart.subtotalAmount + cart.shippingFee - couponDiscount.value - appliedCredits.value)
)

const submitOrder = async () => {
  if (cart.items.length === 0) return
  submitting.value = true
  errorMsg.value = ''

  try {
    const cid = auth.user?.id || 'cust_demo_001'
    const payload = {
      customer_id: cid,
      idempotency_key: `idem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      payment_method: paymentMethod.value,
      coupon_code: selectedCouponCode.value || undefined,
      use_credits: appliedCredits.value,
      shipping_address: {
        recipient: recipientName.value,
        phone: phone.value,
        zip: zipCode.value,
        address: address.value,
        detail: detailAddress.value
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
  <div class="max-w-[1100px] mx-auto px-4 sm:px-6 py-8">
    <h1 class="text-2xl font-black text-gray-900 mb-6">Secure Direct Checkout</h1>

    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <div class="lg:col-span-7 space-y-6">
        <!-- Shipping Address Card -->
        <div class="bg-white rounded-2xl p-6 border border-gray-200/80">
          <h2 class="text-base font-black text-gray-900 mb-4">1. Shipping Destination</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label class="block font-bold text-gray-700 mb-1">Recipient Name</label>
              <input v-model="recipientName" class="w-full h-10 px-3 rounded-lg border border-gray-300" />
            </div>
            <div>
              <label class="block font-bold text-gray-700 mb-1">Mobile Phone</label>
              <input v-model="phone" class="w-full h-10 px-3 rounded-lg border border-gray-300" />
            </div>
            <div>
              <label class="block font-bold text-gray-700 mb-1">Postal Code</label>
              <input v-model="zipCode" class="w-full h-10 px-3 rounded-lg border border-gray-300" />
            </div>
            <div class="sm:col-span-2">
              <label class="block font-bold text-gray-700 mb-1">Street Address</label>
              <input v-model="address" class="w-full h-10 px-3 rounded-lg border border-gray-300" />
            </div>
            <div class="sm:col-span-2">
              <label class="block font-bold text-gray-700 mb-1">Apartment / Suite / Delivery Note</label>
              <input v-model="detailAddress" class="w-full h-10 px-3 rounded-lg border border-gray-300" />
            </div>
          </div>
        </div>

        <!-- Coupons & Credits Card -->
        <div class="bg-white rounded-2xl p-6 border border-gray-200/80 space-y-4">
          <h2 class="text-base font-black text-gray-900">2. Coupons & Olmoa Reward Credits</h2>
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

        <!-- Payment Method Card -->
        <div class="bg-white rounded-2xl p-6 border border-gray-200/80">
          <h2 class="text-base font-black text-gray-900 mb-4">3. Escrow Payment Method</h2>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-bold">
            <button
              v-for="method in ['TOSS_PAY', 'KAKAO_PAY', 'CREDIT_CARD']"
              :key="method"
              type="button"
              @click="paymentMethod = method"
              :class="[
                'py-3 px-4 rounded-xl border text-center cursor-pointer transition-all',
                paymentMethod === method
                  ? 'border-[#FF5000] bg-orange-50 text-[#FF5000]'
                  : 'border-gray-200 text-gray-700 hover:border-gray-400'
              ]"
            >
              {{ method.replace('_', ' ') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Right Summary -->
      <div class="lg:col-span-5">
        <div class="bg-white rounded-2xl p-6 border border-gray-200/80 sticky top-24">
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
              <span>Partner Split Shipping ({{ cart.partnerShippingBreakdown.length }} seller{{ cart.partnerShippingBreakdown.length > 1 ? 's' : '' }})</span>
              <span class="font-bold text-gray-900">{{ cart.shippingFee === 0 ? 'FREE' : locale.formatPrice(cart.shippingFee) }}</span>
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

          <div class="flex justify-between items-baseline border-t border-gray-200 pt-4 mb-5">
            <span class="text-sm font-black text-gray-900">Net Payment Amount</span>
            <span class="text-2xl font-black text-[#E60023]">{{ locale.formatPrice(netPayableTotal) }}</span>
          </div>

          <div v-if="errorMsg" class="p-3 rounded-xl bg-red-50 text-[#E60023] text-xs font-bold mb-4">
            {{ errorMsg }}
          </div>

          <button
            @click="submitOrder"
            :disabled="submitting || cart.items.length === 0"
            class="w-full h-13 rounded-full bg-gradient-to-r from-[#FF5000] to-[#E60023] text-white font-black text-sm shadow-md hover:opacity-95 disabled:opacity-50 cursor-pointer"
          >
            {{ submitting ? 'Executing Atomic D1 Transaction...' : `Pay ${locale.formatPrice(netPayableTotal)} Now` }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
