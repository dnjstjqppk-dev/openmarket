<script setup lang="ts">
// Review highlights (3-4): server-measured distribution, photo share and fit
// spread. No generated prose — numbers only.
import { ref, watch } from 'vue'
import { OmSkeleton, formatNumber } from '@olmoa/ui'
import { API_BASE_URL } from '../../config'

const props = defineProps<{ productId: string }>()
const summary = ref<any>(null)
const loaded = ref(false)

async function load() {
  loaded.value = false
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${encodeURIComponent(props.productId)}/reviews?per_page=1`)
    const json = await res.json().catch(() => null)
    if (res.ok && json?.success) summary.value = json.data?.summary || null
  } catch {
    summary.value = null
  } finally {
    loaded.value = true
  }
}
watch(() => props.productId, load, { immediate: true })

const FIT_LABEL: Record<string, string> = { TRUE_TO_SIZE: '정사이즈', RUNS_SMALL: '작게 나옴', RUNS_LARGE: '크게 나옴' }
</script>

<template>
  <div v-if="!loaded"><OmSkeleton :lines="2" :count="2" /></div>
  <div v-else-if="summary && summary.count > 0" class="grid gap-4 rounded-lg border border-line bg-surface-2 p-4 sm:grid-cols-3">
    <div>
      <p class="text-xs font-bold text-ink-muted">평점 분포</p>
      <ul class="mt-2 space-y-1">
        <li v-for="n in [5, 4, 3, 2, 1]" :key="n" class="flex items-center gap-2 text-2xs text-ink-muted">
          <span class="w-6 tabular-nums">{{ n }}점</span>
          <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
            <span class="block h-full rounded-full bg-highlight" :style="{ width: `${summary.count ? Math.round(((summary.distribution?.[n] || 0) * 100) / summary.count) : 0}%` }" />
          </span>
          <span class="w-8 text-right tabular-nums">{{ formatNumber(summary.distribution?.[n] || 0) }}</span>
        </li>
      </ul>
    </div>
    <div>
      <p class="text-xs font-bold text-ink-muted">포토 후기</p>
      <p class="mt-2 text-2xl font-bold tabular-nums text-ink">
        {{ summary.count ? Math.round(((summary.photo_count || 0) * 100) / summary.count) : 0 }}<span class="text-sm font-medium text-ink-muted">%</span>
      </p>
      <p class="mt-1 text-xs text-ink-muted">{{ formatNumber(summary.photo_count || 0) }}개가 사진을 포함</p>
    </div>
    <div>
      <p class="text-xs font-bold text-ink-muted">사이즈 체감</p>
      <ul class="mt-2 space-y-1">
        <li v-for="k in ['TRUE_TO_SIZE', 'RUNS_SMALL', 'RUNS_LARGE']" :key="k" class="flex items-center justify-between text-xs">
          <span class="text-ink-muted">{{ FIT_LABEL[k] }}</span>
          <span class="tabular-nums text-ink">{{ formatNumber(summary.fit?.[k] || 0) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
