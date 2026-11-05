<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const route = useRoute()
const locale = useLocaleStore()
const storeData = ref<any>(null)
const loading = ref(true)

const loadStore = async () => {
  loading.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partners/${route.params.id}/store`)
    const json = await res.json()
    if (json.success) storeData.value = json.data
  } catch {} finally {
    loading.value = false
  }
}

onMounted(loadStore)
watch(() => route.params.id, loadStore)
</script>

<template>
  <div class="max-w-[1440px] mx-auto px-4 sm:px-6 py-8">
    <div v-if="loading" class="h-48 bg-white rounded-3xl animate-pulse"></div>
    <div v-else-if="storeData" class="space-y-8">
      <!-- Seller Header Banner -->
      <div class="bg-gradient-to-r from-gray-900 via-[#1e293b] to-gray-900 text-white rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 rounded-2xl bg-[#FF5000] flex items-center justify-center text-2xl font-black shadow-lg">
            🏪
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span v-if="storeData.partner.status === 'APPROVED'" class="px-2 py-0.5 rounded bg-[#00A862] text-white text-[10px] font-black">입점 심사 승인 판매자</span>
              <span v-if="storeData.partner.business_number" class="text-xs text-gray-300">사업자등록번호 {{ storeData.partner.business_number }}</span>
            </div>
            <h1 class="text-2xl sm:text-3xl font-black mt-1">{{ storeData.partner.company_name }}</h1>
            <p class="text-xs text-gray-300 mt-1">
              <template v-if="storeData.shipping_policy">배송비 {{ locale.formatPrice(storeData.shipping_policy.base_fee) }}<template v-if="storeData.shipping_policy.free_shipping_threshold"> · {{ locale.formatPrice(storeData.shipping_policy.free_shipping_threshold) }} 이상 무료배송</template></template>
            </p>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-3 text-center shrink-0">
          <div class="bg-white/10 px-4 py-2.5 rounded-xl">
            <div v-if="storeData.metrics.review_count > 0 && storeData.metrics.avg_rating != null" class="text-lg font-black text-[#FFE600]">★ {{ storeData.metrics.avg_rating }}</div>
            <div v-else class="text-lg font-black text-gray-400">-</div>
            <div class="text-[10px] text-gray-300">스토어 평점<template v-if="storeData.metrics.review_count > 0"> (후기 {{ storeData.metrics.review_count }})</template></div>
          </div>
          <div class="bg-white/10 px-4 py-2.5 rounded-xl">
            <div class="text-lg font-black text-white">{{ storeData.metrics.product_count }}</div>
            <div class="text-[10px] text-gray-300">판매 중 상품</div>
          </div>
          <div class="bg-white/10 px-4 py-2.5 rounded-xl">
            <div class="text-lg font-black text-[#00A862]">{{ (storeData.metrics.total_sold || 0).toLocaleString() }}</div>
            <div class="text-[10px] text-gray-300">누적 판매 수량</div>
          </div>
        </div>
      </div>

      <!-- Store Products Grid -->
      <div>
        <h2 class="text-lg font-black text-gray-900 mb-4">All Products from {{ storeData.partner.company_name }}</h2>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <RouterLink
            v-for="product in storeData.products"
            :key="product.id"
            :to="`/product/${product.slug}`"
            class="group bg-white rounded-2xl overflow-hidden border border-gray-200 hover:border-[#FF5000] hover:shadow-lg transition-all flex flex-col"
          >
            <div class="aspect-square bg-gray-100 overflow-hidden">
              <img :src="product.thumbnail_url" :alt="product.title" class="w-full h-full object-cover group-hover:scale-105 transition-transform" />
            </div>
            <div class="p-3 flex-1 flex flex-col justify-between">
              <div>
                <span class="text-[10px] font-bold text-gray-400 uppercase">{{ product.brand }}</span>
                <h3 class="text-xs font-bold text-gray-900 line-clamp-2 mt-0.5 mb-2 group-hover:text-[#FF5000]">{{ product.title }}</h3>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-base font-black text-[#111111]">{{ locale.formatPrice(product.lowest_sale_price) }}</span>
                <span v-if="product.review_count && product.avg_rating" class="text-[11px] text-[#FFB800] font-bold">★ {{ Number(product.avg_rating).toFixed(1) }}</span><span v-else class="px-1 py-0.2 rounded bg-gray-100 text-gray-600 font-semibold text-[10px]">NEW</span>
              </div>
            </div>
          </RouterLink>
        </div>
      </div>
    </div>
  </div>
</template>
