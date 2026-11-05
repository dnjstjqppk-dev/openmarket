<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const locale = useLocaleStore()
const campaign = ref<any>(null)
const deals = ref<any[]>([])
const loading = ref(true)

const secondsLeft = ref(14200)
let timer: any = null

const timeLeftFormatted = computed(() => {
  const h = Math.floor(secondsLeft.value / 3600).toString().padStart(2, '0')
  const m = Math.floor((secondsLeft.value % 3600) / 60).toString().padStart(2, '0')
  const s = (secondsLeft.value % 60).toString().padStart(2, '0')
  return `${h}:${m}:${s}`
})

onMounted(async () => {
  timer = setInterval(() => {
    if (secondsLeft.value > 0) secondsLeft.value--
  }, 1000)

  try {
    let res = await fetch(`${API_BASE_URL}/api/v1/deals/lightning`)
    if (!res.ok) res = await fetch(`${API_BASE_URL}/api/v1/campaigns/lightning`)
    const json = await res.json()
    if (json.success && json.data) {
      campaign.value = json.data.campaign || { title: 'OLMOA 초특가 번개딜' }
      deals.value = json.data.deals || []
      if (json.data.remaining_seconds) {
        secondsLeft.value = json.data.remaining_seconds
      }
    }
  } catch {} finally {
    loading.value = false
  }
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="max-w-[1440px] mx-auto px-4 sm:px-6 py-8">
    <div class="bg-gradient-to-r from-[#E60023] via-[#FF5000] to-amber-500 text-white rounded-3xl p-6 sm:p-8 mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg">
      <div>
        <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/25 text-xs font-black uppercase mb-2">
          ⚡ Limited Time Flash Campaign
        </div>
        <h1 class="text-3xl sm:text-4xl font-black tracking-tight">
          {{ campaign?.title || 'OLMOA SUPER LIGHTNING DEALS' }}
        </h1>
        <p class="text-xs sm:text-sm text-white/90 mt-1"> Direct factory allocation with real-time stock gauges. Once claimed, prices return to standard retail.</p>
      </div>
      <div class="bg-black/25 backdrop-blur-md px-5 py-3 rounded-2xl border border-white/20 text-center shrink-0">
        <div class="text-[10px] uppercase font-bold text-white/80">종료까지 남은 시간</div>
        <div class="text-xl font-mono font-black text-[#FFE600] flex items-center justify-center gap-1.5">
          <i class="fa-regular fa-clock text-sm"></i>
          <span>{{ timeLeftFormatted }}</span>
        </div>
      </div>
    </div>

    <div v-if="loading" class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div v-for="n in 4" :key="n" class="h-80 bg-white rounded-2xl animate-pulse"></div>
    </div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
      <RouterLink
        v-for="item in deals"
        :key="item.product_id || item.id"
        :to="`/product/${item.slug}`"
        class="group bg-white rounded-2xl p-4 border-2 border-orange-200/80 hover:border-[#E60023] hover:shadow-xl transition-all flex flex-col justify-between"
      >
        <div>
          <div class="relative aspect-square rounded-xl overflow-hidden bg-gray-100 mb-3">
            <img :src="item.thumbnail_url" :alt="item.title" class="w-full h-full object-cover group-hover:scale-105 transition-transform" />
            <span class="absolute top-2.5 left-2.5 bg-[#E60023] text-white text-xs font-black px-2.5 py-1 rounded-lg shadow-xs">
              -{{ item.discount_rate || 35 }}% FLASH
            </span>
          </div>
          <span class="text-[10px] font-extrabold text-[#FF5000] uppercase">{{ item.brand }}</span>
          <h2 class="text-sm font-bold text-gray-900 line-clamp-2 mt-0.5 mb-2 group-hover:text-[#E60023]">{{ item.title }}</h2>
        </div>

        <div>
          <div class="flex items-baseline gap-2">
            <span class="text-xl font-black text-[#E60023]">{{ locale.formatPrice(item.deal_price || item.lowest_sale_price) }}</span>
            <span class="text-xs text-gray-400 line-through">{{ locale.formatPrice(item.lowest_original_price) }}</span>
          </div>
          <div class="mt-3 w-full bg-gray-200 h-2.5 rounded-full overflow-hidden">
            <div
              class="bg-gradient-to-r from-[#FF5000] to-[#E60023] h-full rounded-full"
              :style="{ width: `${Math.min(96, Math.round(((item.sold_quantity || 40) / (item.allocated_stock || 100)) * 100))}%` }"
            ></div>
          </div>
          <div class="flex justify-between text-[11px] font-bold text-gray-600 mt-1.5">
            <span class="text-[#E60023]">🔥 {{ item.sold_quantity || 42 }} claimed</span>
            <span>{{ (item.allocated_stock || 100) - (item.sold_quantity || 42) }} left</span>
          </div>
        </div>
      </RouterLink>
    </div>
  </div>
</template>
