<script setup lang="ts">
// Free-shipping gauge (3-5): rendered only for sellers with a threshold.
// Progress = selected goods / threshold; the spotlight link opens the store
// home with the same amount so bigger-ticket goods surface first (3-10).
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { formatNumber } from '@olmoa/ui'

const props = defineProps<{ goods: number; threshold: number; partnerId: string }>()

const pct = computed(() => {
  if (!(props.threshold > 0)) return 0
  return Math.min(100, Math.floor((props.goods / props.threshold) * 100))
})
const remaining = computed(() => Math.max(0, props.threshold - props.goods))
const achieved = computed(() => props.threshold > 0 && remaining.value === 0)
</script>

<template>
  <div v-if="threshold > 0" class="rounded-lg bg-surface-2 p-3">
    <div class="h-1.5 w-full overflow-hidden rounded-full bg-surface-3" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100" aria-label="무료배송 진행률">
      <div class="h-full rounded-full bg-primary transition-[width]" :style="{ width: `${pct}%` }" />
    </div>
    <p v-if="achieved" class="mt-2 text-xs font-bold text-ink">무료배송 조건 달성</p>
    <template v-else>
      <p class="mt-2 text-xs text-ink">{{ formatNumber(remaining) }}원 더 담으면 이 스토어 무료배송</p>
      <RouterLink :to="`/store/${partnerId}?first_min=${remaining}`" class="mt-1 inline-block text-xs font-bold text-primary hover:underline">
        이 스토어 상품 더 보기 &gt;
      </RouterLink>
    </template>
  </div>
</template>
