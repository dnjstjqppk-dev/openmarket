<script setup lang="ts">
import { RouterLink, useRouter } from 'vue-router'
import { useCartStore } from '../stores/cart'
import { useLocaleStore } from '../stores/locale'

const cart = useCartStore()
const locale = useLocaleStore()
const router = useRouter()
</script>

<template>
  <div class="max-w-[1200px] mx-auto px-4 sm:px-6 py-8">
    <h1 class="text-2xl font-black text-gray-900 mb-6">Shopping Cart ({{ cart.totalCount }})</h1>

    <div v-if="cart.items.length === 0" class="bg-white rounded-2xl p-12 text-center border border-gray-200">
      <div class="text-4xl mb-3">🛒</div>
      <h2 class="text-lg font-bold text-gray-800 mb-2">Your cart is currently empty</h2>
      <p class="text-xs text-gray-500 mb-6">Explore our 42 root departments and lightning deals to start saving.</p>
      <RouterLink to="/" class="inline-block px-6 py-3 rounded-full bg-[#FF5000] text-white text-xs font-black">
        Explore Today's Deals
      </RouterLink>
    </div>

    <div v-else class="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <!-- Left: Partner-Grouped Cart Items -->
      <div class="lg:col-span-8 space-y-5">
        <div
          v-for="group in cart.partnerShippingBreakdown"
          :key="group.partner_id"
          class="bg-white rounded-2xl p-5 border border-gray-200/80 space-y-4"
        >
          <div class="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-gray-100">
            <RouterLink :to="`/store/${group.partner_id}`" class="flex items-center gap-2 text-xs font-black text-gray-900 hover:text-[#FF5000]">
              <span>🏪 {{ group.partner_name }}</span>
              <span class="text-[10px] text-gray-400">Visit Store ›</span>
            </RouterLink>
            <div class="text-xs font-bold">
              <span v-if="group.shipping_fee === 0" class="text-[#00A862]">✓ Free Partner Shipping Unlocked!</span>
              <span v-else class="text-[#FF5000]">
                Add {{ locale.formatPrice(group.remaining_for_free) }} more from this seller for FREE shipping (Current: {{ locale.formatPrice(group.shipping_fee) }})
              </span>
            </div>
          </div>

          <div
            v-for="item in group.items"
            :key="item.sku_id"
            class="flex gap-4 pt-2"
          >
            <RouterLink :to="`/product/${item.slug || item.product_id}`" class="w-20 h-20 rounded-xl overflow-hidden bg-gray-100 shrink-0">
              <img :src="item.thumbnail_url" :alt="item.title" class="w-full h-full object-cover" />
            </RouterLink>

            <div class="flex-1 flex flex-col justify-between">
              <div class="flex justify-between gap-2">
                <div>
                  <span class="text-[10px] font-bold text-gray-400 uppercase">{{ item.brand }}</span>
                  <h3 class="text-sm font-bold text-gray-900">{{ item.title }}</h3>
                  <span class="inline-block mt-1 px-2 py-0.5 bg-gray-100 rounded text-[11px] text-gray-600 font-medium">
                    Option: {{ item.option_Label }}
                  </span>
                </div>
                <button @click="cart.removeItem(item.sku_id)" class="text-xs text-gray-400 hover:text-red-600 font-semibold cursor-pointer">
                  Remove
                </button>
              </div>

              <div class="flex items-center justify-between mt-3">
                <div class="flex items-center border border-gray-300 rounded-lg overflow-hidden">
                  <button @click="cart.updateQuantity(item.sku_id, item.quantity - 1)" class="w-7 h-7 bg-gray-50 font-bold text-xs cursor-pointer">-</button>
                  <span class="w-9 text-center text-xs font-bold">{{ item.quantity }}</span>
                  <button @click="cart.updateQuantity(item.sku_id, item.quantity + 1)" class="w-7 h-7 bg-gray-50 font-bold text-xs cursor-pointer">+</button>
                </div>

                <div class="text-right">
                  <div class="text-base font-black text-[#111111]">{{ locale.formatPrice(item.price * item.quantity) }}</div>
                  <div v-if="item.original_price > item.price" class="text-[11px] text-gray-400 line-through">
                    {{ locale.formatPrice(item.original_price * item.quantity) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right: Order Summary with Partner Shipping Breakdown -->
      <div class="lg:col-span-4">
        <div class="bg-white rounded-2xl p-6 border border-gray-200/80 sticky top-24">
          <h2 class="text-base font-black text-gray-900 mb-4 pb-3 border-b border-gray-100">Order Summary</h2>
          <div class="space-y-2.5 text-xs text-gray-600 mb-4">
            <div class="flex justify-between">
              <span>Items Retail Total</span>
              <span class="line-through">{{ locale.formatPrice(cart.subtotalAmount + cart.totalSavings) }}</span>
            </div>
            <div class="flex justify-between text-[#E60023] font-bold">
              <span>Instant Direct Discount</span>
              <span>-{{ locale.formatPrice(cart.totalSavings) }}</span>
            </div>
            <div class="flex justify-between font-bold text-gray-900 pt-1">
              <span>Subtotal ({{ cart.totalCount }} items)</span>
              <span>{{ locale.formatPrice(cart.subtotalAmount) }}</span>
            </div>
            <div class="flex justify-between">
              <span>Partner Split Shipping ({{ cart.partnerShippingBreakdown.length }} seller{{ cart.partnerShippingBreakdown.length > 1 ? 's' : '' }})</span>
              <span class="font-bold text-gray-900">{{ cart.shippingFee === 0 ? 'FREE' : locale.formatPrice(cart.shippingFee) }}</span>
            </div>
          </div>

          <div class="flex justify-between items-baseline pt-4 border-t border-gray-200 mb-6">
            <span class="text-sm font-black text-gray-900">Estimated Total</span>
            <span class="text-2xl font-black text-[#E60023]">{{ locale.formatPrice(cart.finalTotal) }}</span>
          </div>

          <button
            @click="router.push('/checkout')"
            class="w-full h-12 rounded-full bg-gradient-to-r from-[#FF5000] to-[#E60023] text-white font-black text-sm shadow-md hover:opacity-95 transition-opacity cursor-pointer"
          >
            Proceed to Checkout ({{ cart.totalCount }})
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
