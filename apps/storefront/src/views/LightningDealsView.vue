<script setup lang="ts">
// Lightning deals (3-11): the running campaign with a live countdown, the
// next round preview when one is scheduled, and measured sell-through per
// deal (shown only while the deal carries an allocation).
import { ref, computed, onMounted } from 'vue'
import { userErrorMessage, OmBreadcrumb, OmSkeleton, OmEmptyState, OmErrorState, OmButton, OmCountdown, OmProgress, formatDateTime, formatNumber } from '@olmoa/ui'
import ProductCard from '../components/ProductCard.vue'
import { API_BASE_URL } from '../config'

const campaign = ref<any>(null)
const nextRound = ref<any>(null)
const deals = ref<any[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)

const parseUtc = (s: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z').getTime()
const endsAtMs = computed(() => (campaign.value?.ends_at ? parseUtc(campaign.value.ends_at) : null))
const nextAtMs = computed(() => (nextRound.value?.starts_at ? parseUtc(nextRound.value.starts_at) : null))

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/campaigns/lightning`)
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || `번개특가를 불러오지 못했습니다`)
    campaign.value = json.data?.campaign || null
    nextRound.value = json.data?.next_campaign || null
    deals.value = json.data?.deals || []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '불러오지 못했습니다')
  } finally {
    loading.value = false
  }
}
onMounted(load)
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
      <div v-if="campaign && endsAtMs" class="shrink-0 rounded-lg bg-accent-soft px-4 py-3 text-center">
        <p class="text-2xs font-medium text-accent">기획전 종료까지</p>
        <p class="mt-0.5 text-xl font-bold"><OmCountdown :ends-at="endsAtMs" /></p>
      </div>
    </header>

    <section v-if="nextRound && nextAtMs" class="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 p-4" aria-label="다음 회차 예고">
      <div>
        <p class="text-2xs font-bold text-ink-subtle">다음 회차 예고</p>
        <p class="mt-0.5 text-sm font-bold text-ink">{{ nextRound.title }}</p>
        <p class="mt-0.5 text-xs text-ink-muted">{{ formatDateTime(nextRound.starts_at) }} 시작</p>
      </div>
      <p class="text-lg font-bold"><OmCountdown :ends-at="nextAtMs" /></p>
    </section>

    <div v-if="loading" class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"><OmSkeleton variant="card" :count="10" /></div>
    <OmErrorState v-else-if="loadError" :message="loadError" @retry="load" />
    <OmEmptyState v-else-if="!campaign || !deals.length" title="지금 진행 중인 번개특가가 없습니다" description="새 기획전이 열리면 이곳에 표시됩니다.">
      <OmButton to="/channel/best-sellers" variant="outline" size="sm">베스트 상품 보기</OmButton>
    </OmEmptyState>
    <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      <div v-for="(d, i) in deals" :key="d.id" class="space-y-1.5">
        <ProductCard :product="d" :eager="i < 5" />
        <div v-if="Number(d.allocated_stock) > 0" class="space-y-1">
          <OmProgress :sold="d.sold_quantity" :allocated="d.allocated_stock" />
          <p class="om-num text-2xs font-bold" :class="Number(d.remaining_stock) > 0 ? 'text-ink-muted' : 'text-danger'">
            {{ Number(d.remaining_stock) > 0 ? `${formatNumber(d.remaining_stock)}개 남음` : '소진됨' }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
