<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useCartStore } from '../stores/cart'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const cart = useCartStore()
const locale = useLocaleStore()
const router = useRouter()

interface RecommendedProduct {
  id: string
  title: string
  thumbnail_url: string
  lowest_sale_price: number
  lowest_original_price: number
  total_sold_count: number
}

const recommendedProducts = ref<RecommendedProduct[]>([])
const loadingRecs = ref(false)

const loadRecommendations = async () => {
  loadingRecs.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/campaigns/lightning`)
    const json = await res.json()
    if (json.success && Array.isArray(json.data)) {
      recommendedProducts.value = json.data.slice(0, 8).map((it: any) => ({
        id: it.product_id || it.slug || it.id,
        title: it.title,
        thumbnail_url: it.thumbnail_url,
        lowest_sale_price: it.deal_price || it.lowest_sale_price,
        lowest_original_price: it.lowest_original_price,
        total_sold_count: it.sold_quantity || it.total_sold_count || 120
      }))
    }
  } catch (e) {
    console.error('Failed to load cart recommendations:', e)
  } finally {
    loadingRecs.value = false
  }
}

onMounted(() => {
  loadRecommendations()
})
</script>

<template>
  <div class="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
    <div class="flex items-center justify-between border-b border-gray-200 pb-4">
      <h1 class="text-xl sm:text-2xl font-black text-gray-900 flex items-center gap-2">
        <span>🛒 장바구니</span>
        <span class="text-xs px-2.5 py-0.5 rounded-full bg-orange-100 text-[#FF5000] font-black">
          {{ cart.totalCount }}개 품목
        </span>
      </h1>
      <RouterLink to="/" class="text-xs font-bold text-gray-500 hover:text-[#FF5000] transition">
        ← 쇼핑 계속하기
      </RouterLink>
    </div>

    <!-- Empty Cart State with Recommendations -->
    <div v-if="cart.items.length === 0" class="space-y-10">
      <div class="bg-white rounded-3xl p-10 sm:p-14 text-center border border-gray-200/90 shadow-xs">
        <div class="w-20 h-20 mx-auto mb-4 rounded-full bg-orange-50 flex items-center justify-center text-[#FF5000] text-3xl">
          <i class="fa-solid fa-cart-shopping"></i>
        </div>
        <h2 class="text-lg font-black text-gray-900 mb-1.5">장바구니가 비어 있습니다</h2>
        <p class="text-xs text-gray-500 max-w-md mx-auto mb-6">
          올모아 글로벌 다이렉트 공장 직발송 최저가와 30,000원 이상 무료배송 혜택을 놓치지 마세요.
        </p>
        <RouterLink
          to="/"
          class="inline-flex items-center gap-2 px-7 py-3 rounded-full bg-[#FF5000] hover:bg-[#e04700] text-white text-xs font-black shadow-md transition transform active:scale-95"
        >
          <i class="fa-solid fa-bolt"></i>
          <span>오늘의 번개특가 구경하기</span>
        </RouterLink>
      </div>

      <!-- Recommended Deals Grid -->
      <div v-if="recommendedProducts.length > 0" class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-base sm:text-lg font-black text-gray-900 flex items-center gap-2">
              <span class="text-[#FF5000]">⚡</span>
              <span>회원님을 위한 실시간 인기 특가 상품</span>
            </h3>
            <p class="text-xs text-gray-500 mt-0.5">최대 85% 할인율과 빠른 배송이 보장되는 베스트셀러</p>
          </div>
          <RouterLink to="/channel/best-sellers" class="text-xs font-bold text-[#FF5000] hover:underline">
            전체 랭킹 보기 →
          </RouterLink>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5 sm:gap-4">
          <RouterLink
            v-for="p in recommendedProducts"
            :key="p.id"
            :to="`/product/${p.id}`"
            class="bg-white rounded-2xl p-3 border border-gray-200/90 hover:border-[#FF5000] shadow-xs hover:shadow-md transition-all group flex flex-col justify-between"
          >
            <div>
              <div class="aspect-square rounded-xl overflow-hidden bg-gray-100 mb-2.5 relative">
                <img :src="p.thumbnail_url" :alt="p.title" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                <span class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-black">
                  HOT
                </span>
              </div>
              <h4 class="text-xs font-bold text-gray-900 line-clamp-2 mb-1 group-hover:text-[#FF5000] transition">
                {{ p.title }}
              </h4>
            </div>

            <div class="pt-2 border-t border-gray-100 flex items-center justify-between">
              <div>
                <div class="text-sm font-black text-[#E60023]">
                  {{ locale.formatPrice(p.lowest_sale_price) }}
                </div>
                <div v-if="p.lowest_original_price > p.lowest_sale_price" class="text-[10px] text-gray-400 line-through">
                  {{ locale.formatPrice(p.lowest_original_price) }}
                </div>
              </div>
              <span class="text-[10px] text-gray-500 font-medium">
                {{ p.total_sold_count }}개 구매
              </span>
            </div>
          </RouterLink>
        </div>
      </div>
    </div>

    <!-- Active Cart Items Grid -->
    <div v-else class="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <!-- Left: Partner-Grouped Cart Items -->
      <div class="lg:col-span-8 space-y-5">
        <div
          v-for="group in cart.partnerShippingBreakdown"
          :key="group.partner_id"
          class="bg-white rounded-3xl p-5 sm:p-6 border border-gray-200/90 shadow-xs space-y-4"
        >
          <!-- Store Header & Free Shipping Progress -->
          <div class="flex flex-wrap items-center justify-between gap-2 pb-3.5 border-b border-gray-100">
            <RouterLink :to="`/store/${group.partner_id}`" class="flex items-center gap-2 text-xs font-black text-gray-900 hover:text-[#FF5000]">
              <i class="fa-solid fa-store text-gray-400"></i>
              <span>{{ group.partner_name }}</span>
              <span class="text-[10px] text-gray-400 font-normal">판매자 홈 ›</span>
            </RouterLink>
            <div class="text-xs font-bold">
              <span v-if="group.shipping_fee === 0" class="text-[#00A862] flex items-center gap-1">
                <i class="fa-solid fa-circle-check"></i>
                <span>판매자 무료배송 혜택 적용 완료!</span>
              </span>
              <span v-else class="text-[#FF5000]">
                {{ locale.formatPrice(group.remaining_for_free) }} 추가 구매 시 무료배송 (현재: {{ locale.formatPrice(group.shipping_fee) }})
              </span>
            </div>
          </div>

          <!-- Items in this Partner Group -->
          <div
            v-for="item in group.items"
            :key="item.sku_id"
            class="flex gap-4 py-2 border-b border-gray-100 last:border-b-0"
          >
            <RouterLink :to="`/product/${item.product_id}`" class="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden bg-gray-100 shrink-0 border border-gray-200">
              <img :src="item.thumbnail_url" :alt="item.title" class="w-full h-full object-cover" />
            </RouterLink>

            <div class="flex-1 flex flex-col justify-between">
              <div class="flex justify-between gap-2">
                <div>
                  <h3 class="text-xs sm:text-sm font-black text-gray-900 line-clamp-2">{{ item.title }}</h3>
                  <span class="inline-block mt-1 px-2 py-0.5 bg-gray-100 rounded text-[11px] text-gray-600 font-medium">
                    옵션: {{ item.option_summary || '기본 표준형' }}
                  </span>
                </div>
                <button
                  @click="cart.removeItem(item.sku_id)"
                  class="text-xs text-gray-400 hover:text-red-600 font-bold p-1 cursor-pointer"
                  title="장바구니에서 삭제"
                >
                  ✕
                </button>
              </div>

              <div class="flex items-center justify-between mt-3">
                <div class="flex items-center border border-gray-300 rounded-xl overflow-hidden bg-white">
                  <button @click="cart.updateQuantity(item.sku_id, item.quantity - 1)" class="w-8 h-8 bg-gray-50 hover:bg-gray-100 font-bold text-xs cursor-pointer">-</button>
                  <span class="w-10 text-center text-xs font-black">{{ item.quantity }}</span>
                  <button @click="cart.updateQuantity(item.sku_id, item.quantity + 1)" class="w-8 h-8 bg-gray-50 hover:bg-gray-100 font-bold text-xs cursor-pointer">+</button>
                </div>

                <div class="text-right">
                  <div class="text-base font-black text-gray-900">{{ locale.formatPrice(item.price * item.quantity) }}</div>
                  <div v-if="item.original_price > item.price" class="text-[11px] text-gray-400 line-through">
                    {{ locale.formatPrice(item.original_price * item.quantity) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right: Order Summary -->
      <div class="lg:col-span-4">
        <div class="bg-white rounded-3xl p-6 border border-gray-200/90 shadow-xs sticky top-24 space-y-5">
          <h2 class="text-base font-black text-gray-900 pb-3 border-b border-gray-100">결제 예상 금액</h2>
          
          <div class="space-y-2.5 text-xs text-gray-600">
            <div class="flex justify-between">
              <span>상품 정가 합계</span>
              <span class="line-through">{{ locale.formatPrice(cart.subtotalAmount + cart.totalSavings) }}</span>
            </div>
            <div class="flex justify-between text-[#E60023] font-bold">
              <span>공장 직발송 파격 할인</span>
              <span>-{{ locale.formatPrice(cart.totalSavings) }}</span>
            </div>
            <div class="flex justify-between font-black text-gray-900 pt-1">
              <span>상품 판매가 합계 ({{ cart.totalCount }}개)</span>
              <span>{{ locale.formatPrice(cart.subtotalAmount) }}</span>
            </div>
            <div class="flex justify-between">
              <span>판매자 묶음 배송비 ({{ cart.partnerShippingBreakdown.length }}개 스토어)</span>
              <span class="font-bold text-gray-900">{{ cart.shippingFee === 0 ? '무료' : locale.formatPrice(cart.shippingFee) }}</span>
            </div>
          </div>

          <div class="flex justify-between items-baseline pt-4 border-t border-gray-200">
            <span class="text-sm font-black text-gray-900">최종 결제 예정액</span>
            <span class="text-2xl font-black text-[#E60023]">{{ locale.formatPrice(cart.finalTotal) }}</span>
          </div>

          <button
            @click="router.push('/checkout')"
            class="w-full h-12 rounded-full bg-gradient-to-r from-[#FF5000] to-[#E60023] hover:from-[#e04700] hover:to-[#cc0000] text-white font-black text-sm shadow-md transition transform active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
          >
            <span>주문서 작성 및 결제하기 ({{ cart.totalCount }}개)</span>
            <i class="fa-solid fa-arrow-right text-xs"></i>
          </button>

          <div class="p-3 bg-gray-50 rounded-2xl text-[11px] text-gray-500 space-y-1">
            <div class="flex items-center gap-1.5 font-bold text-gray-700">
              <i class="fa-solid fa-shield-halved text-[#00A862]"></i>
              <span>올모아 100% 고객 안심 보장제</span>
            </div>
            <p>• 90일 무조건 무료반품 (불만족 시 100% 전액 환불)</p>
            <p>• 30일 최저가 차액 자동 보상</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
