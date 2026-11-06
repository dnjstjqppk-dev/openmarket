<script setup lang="ts">
// Lightning deals (PHASE 2 redesign): the running flash_sale_campaign and its items, nothing else.
// What the backend really does (routes/features.js, services/orders.js):
//  - checkout charges the SKU's normal sale_price; there is no separate deal price, so prices do NOT change when
//    the campaign ends (the old copy "기간이 끝나면 정상가로 돌아갑니다" was false);
//  - flash_sale_items.sold_stock is never updated by orders and allocated_stock is not enforced, so the old
//    "N개 판매" / progress bar / "특가 수량 소진" were static numbers and are no longer shown.
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { Clock } from 'lucide-vue-next'
import { OmBreadcrumb, OmSkeleton, OmEmptyState, OmErrorState, OmButton, OmAlert, formatDateTime } from '@olmoa/ui'
import ProductCard from '../components/ProductCard.vue'
import { API_BASE_URL } from '../config'

const campaign = ref<any>(null)
const deals = ref<any[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
const nowMs = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

const parseUtc = (s: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z').getTime()
const endsAtMs = computed(() => (campaign.value?.ends_at ? parseUtc(campaign.value.ends_at) : null))
const secondsLeft = computed(() => (endsAtMs.value ? Math.max(0, Math.floor((endsAtMs.value - nowMs.value) / 1000)) : 0))
const timeLeft = computed(() => {
  const t = secondsLeft.value
  const d = Math.floor(t / 86400)
  const hms = [Math.floor((t % 86400) / 3600), Math.floor((t % 3600) / 60), t % 60].map((n) => String(n).padStart(2, '0')).join(':')
  return d > 0 ? `${d}일 ${hms}` : hms
})

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/campaigns/lightning`)
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || `불러오지 못했습니다 (${res.status})`)
    campaign.value = json.data?.campaign || null
    deals.value = json.data?.deals || []
  } catch (e: any) {
    loadError.value = e?.message || '불러오지 못했습니다'
  } finally {
    loading.value = false
  }
  if (campaign.value && !timer) timer = setInterval(() => { nowMs.value = Date.now() }, 1000)
}
onMounted(load)
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <div class="mx-auto max-w-container px-4 py-6 sm:px-6">
    <OmBreadcrumb :items="[{ label: '홈', to: '/' }, { label: '번개특가' }]" />

    <header class="mb-6 mt-3 flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div>
        <p class="text-xs font-semibold text-accent">번개특가 기획전</p>
        <h1 class="mt-1 text-2xl font-bold text-ink">{{ campaign?.title || '번개특가' }}</h1>
        <p v-if="campaign" class="mt-1 text-sm text-ink-muted">{{ formatDateTime(campaign.starts_at) }} ~ {{ formatDateTime(campaign.ends_at) }}</p>
      </div>
      <div v-if="campaign" class="shrink-0 rounded-lg bg-accent-soft px-4 py-3 text-center">
        <p class="text-2xs font-medium text-accent">기획전 종료까지</p>
        <p class="mt-0.5 flex items-center justify-center gap-1.5 text-xl font-bold tabular-nums text-accent" aria-live="off">
          <Clock class="h-4 w-4" aria-hidden="true" />{{ secondsLeft > 0 ? timeLeft : '종료됨' }}
        </p>
      </div>
    </header>

    <OmAlert v-if="campaign && deals.length" tone="info" class="mb-5">
      표시된 가격은 각 상품의 현재 판매가이며 결제 금액과 같습니다. 기획전이 끝나도 가격이 자동으로 바뀌지는 않습니다.
    </OmAlert>

    <div v-if="loading" class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"><OmSkeleton variant="card" :count="10" /></div>
    <OmErrorState v-else-if="loadError" :message="loadError" @retry="load" />
    <OmEmptyState v-else-if="!campaign || !deals.length" title="지금 진행 중인 번개특가가 없습니다" description="새 기획전이 열리면 이곳에 표시됩니다.">
      <OmButton to="/channel/best-sellers" variant="outline" size="sm">베스트 상품 보기</OmButton>
    </OmEmptyState>
    <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      <ProductCard v-for="(d, i) in deals" :key="d.id" :product="d" :eager="i < 5" />
    </div>
  </div>
</template>
