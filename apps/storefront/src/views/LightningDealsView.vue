<script setup lang="ts">
// Lightning deals: only a real, running flash_sale_campaign is shown. The countdown runs to that campaign's
// ends_at, prices are the prices checkout charges, and sold / remaining counts come from the campaign rows.
// Nothing is filled in with placeholder numbers when data is missing.
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const locale = useLocaleStore()
const campaign = ref<any>(null)
const deals = ref<any[]>([])
const loading = ref(true)
const loadError = ref(false)
const nowMs = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

// D1 stores 'YYYY-MM-DD HH:MM:SS' in UTC.
const parseUtc = (s: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z').getTime()
const endsAtMs = computed(() => (campaign.value?.ends_at ? parseUtc(campaign.value.ends_at) : null))
const secondsLeft = computed(() => (endsAtMs.value ? Math.max(0, Math.floor((endsAtMs.value - nowMs.value) / 1000)) : 0))
const timeLeftFormatted = computed(() => {
  const t = secondsLeft.value
  const h = Math.floor(t / 3600).toString().padStart(2, '0')
  const m = Math.floor((t % 3600) / 60).toString().padStart(2, '0')
  const s = (t % 60).toString().padStart(2, '0')
  return `${h}:${m}:${s}`
})

onMounted(async () => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/campaigns/lightning`)
    const json = await res.json()
    if (res.ok && json.success) {
      campaign.value = json.data?.campaign || null
      deals.value = json.data?.deals || []
    } else {
      loadError.value = true
    }
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
  if (campaign.value) timer = setInterval(() => { nowMs.value = Date.now() }, 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="max-w-[1440px] mx-auto px-4 sm:px-6 py-8">
    <div class="bg-gradient-to-r from-[#E60023] via-[#FF5000] to-amber-500 text-white rounded-3xl p-6 sm:p-8 mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg">
      <div>
        <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/25 text-xs font-black mb-2">
          ⚡ 번개특가
        </div>
        <h1 class="text-3xl sm:text-4xl font-black tracking-tight">
          {{ campaign?.title || '번개특가' }}
        </h1>
        <p class="text-xs sm:text-sm text-white/90 mt-1">특가 수량이 모두 판매되거나 기간이 끝나면 정상가로 돌아갑니다.</p>
      </div>
      <div v-if="campaign" class="bg-black/25 backdrop-blur-md px-5 py-3 rounded-2xl border border-white/20 text-center shrink-0">
        <div class="text-[10px] font-bold text-white/80">종료까지 남은 시간</div>
        <div class="text-xl font-mono font-black text-[#FFE600] flex items-center justify-center gap-1.5" aria-live="off">
          <i class="fa-regular fa-clock text-sm" aria-hidden="true"></i>
          <span>{{ secondsLeft > 0 ? timeLeftFormatted : '종료됨' }}</span>
        </div>
      </div>
    </div>

    <div v-if="loading" class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div v-for="n in 4" :key="n" class="h-80 bg-white rounded-2xl animate-pulse"></div>
    </div>

    <div v-else-if="!campaign || !deals.length" class="py-20 text-center text-sm text-gray-500" role="status">
      {{ loadError ? '특가 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' : '지금 진행 중인 번개특가가 없습니다.' }}
    </div>

    <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
      <RouterLink
        v-for="item in deals"
        :key="item.id"
        :to="`/product/${item.slug}`"
        class="group bg-white rounded-2xl p-4 border-2 border-orange-200/80 hover:border-[#E60023] hover:shadow-xl transition-all flex flex-col justify-between"
      >
        <div>
          <div class="relative aspect-square rounded-xl overflow-hidden bg-gray-100 mb-3">
            <img :src="item.thumbnail_url" :alt="item.title" class="w-full h-full object-cover group-hover:scale-105 transition-transform" />
            <span v-if="item.discount_rate > 0" class="absolute top-2.5 left-2.5 bg-[#E60023] text-white text-xs font-black px-2.5 py-1 rounded-lg shadow-xs">
              -{{ item.discount_rate }}%
            </span>
          </div>
          <span class="text-[10px] font-extrabold text-[#FF5000]">{{ item.brand }}</span>
          <h2 class="text-sm font-bold text-gray-900 line-clamp-2 mt-0.5 mb-2 group-hover:text-[#E60023]">{{ item.title }}</h2>
        </div>

        <div>
          <div class="flex items-baseline gap-2">
            <span class="text-xl font-black text-[#E60023]">{{ locale.formatPrice(item.deal_price) }}</span>
            <span v-if="item.lowest_original_price > item.deal_price" class="text-xs text-gray-400 line-through">{{ locale.formatPrice(item.lowest_original_price) }}</span>
          </div>
          <template v-if="item.allocated_stock > 0">
            <div class="mt-3 w-full bg-gray-200 h-2.5 rounded-full overflow-hidden" role="progressbar" :aria-valuenow="item.sold_percent" aria-valuemin="0" aria-valuemax="100">
              <div class="bg-gradient-to-r from-[#FF5000] to-[#E60023] h-full rounded-full" :style="{ width: `${item.sold_percent}%` }"></div>
            </div>
            <div class="flex justify-between text-[11px] font-bold text-gray-600 mt-1.5">
              <span class="text-[#E60023]">{{ item.sold_quantity }}개 판매</span>
              <span>{{ item.remaining_stock > 0 ? `${item.remaining_stock}개 남음` : '특가 수량 소진' }}</span>
            </div>
          </template>
        </div>
      </RouterLink>
    </div>
  </div>
</template>
