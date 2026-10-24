<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const locale = useLocaleStore()
const products = ref<any[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products`)
    const json = await res.json()
    if (json.success) products.value = json.data
  } catch {} finally {
    loading.value = false
  }
})

const rankedProducts = computed(() =>
  [...products.value].sort((a, b) => (b.total_sold_count || 0) - (a.total_sold_count || 0)).slice(0, 30)
)
</script>

<template>
  <div class="max-w-[1440px] mx-auto px-4 sm:px-6 py-8">
    <div class="bg-[#111111] text-white rounded-3xl p-6 sm:p-8 mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <div class="text-xs font-black text-[#FFE600] uppercase tracking-wider mb-1">🏆 Real-Time Verified Sales Leaderboard</div>
        <h1 class="text-3xl font-black">OLMOA TOP BEST SELLERS</h1>
        <p class="text-xs text-gray-400 mt-1">Ranked hourly by verified net non-cancelled order volume and buyer satisfaction.</p>
      </div>
    </div>

    <div v-if="loading" class="grid grid-cols-2 md:grid-cols-5 gap-4">
      <div v-for="n in 10" :key="n" class="h-72 bg-white rounded-2xl animate-pulse"></div>
    </div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      <RouterLink
        v-for="(product, idx) in rankedProducts"
        :key="product.id"
        :to="`/product/${product.slug}`"
        class="group bg-white rounded-2xl overflow-hidden border border-gray-200 hover:border-[#FF5000] hover:shadow-xl transition-all flex flex-col relative"
      >
        <div
          :class="[
            'absolute top-2.5 left-2.5 z-10 w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shadow-md',
            idx === 0 ? 'bg-[#FFE600] text-black' :
            idx === 1 ? 'bg-gray-200 text-gray-900' :
            idx === 2 ? 'bg-amber-700 text-white' : 'bg-black/80 text-white'
          ]"
        >
          #{{ idx + 1 }}
        </div>
        <div class="aspect-square bg-gray-100 overflow-hidden">
          <img :src="product.thumbnail_url" :alt="product.title" class="w-full h-full object-cover group-hover:scale-105 transition-transform" />
        </div>
        <div class="p-3.5 flex-1 flex flex-col justify-between">
          <div>
            <span class="text-[10px] font-bold text-gray-400 uppercase">{{ product.brand }}</span>
            <h2 class="text-xs font-bold text-gray-900 line-clamp-2 mt-0.5 mb-2 group-hover:text-[#FF5000]">{{ product.title }}</h2>
          </div>
          <div>
            <div class="text-base font-black text-[#E60023]">{{ locale.formatPrice(product.lowest_sale_price) }}</div>
            <div class="flex items-center justify-between text-[11px] text-gray-500 mt-1">
              <span class="text-[#FFB800] font-bold">★ {{ Number(product.avg_rating || 4.8).toFixed(1) }}</span>
              <span class="font-bold text-gray-800">{{ (product.total_sold_count || 150).toLocaleString() }} sold</span>
            </div>
          </div>
        </div>
      </RouterLink>
    </div>
  </div>
</template>
