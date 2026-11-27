<script setup lang="ts">
// Date range presets: today / 1 week / 1 month / 3 months / custom entry.
const range = defineModel<[string, string]>({ default: () => ['', ''] })
const props = withDefaults(defineProps<{ presets?: string[] }>(), { presets: () => ['오늘', '1주일', '1개월', '3개월'] })
const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const applyPreset = (label: string) => {
  const to = new Date()
  const from = new Date()
  if (label === '1주일') from.setDate(to.getDate() - 6)
  else if (label === '1개월') from.setMonth(to.getMonth() - 1)
  else if (label === '3개월') from.setMonth(to.getMonth() - 3)
  range.value = [fmt(from), fmt(to)]
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <div class="flex flex-wrap gap-1" role="group" aria-label="기간 선택">
      <button
        v-for="p in presets"
        :key="p"
        type="button"
        class="h-9 shrink-0 whitespace-nowrap rounded-lg border border-line px-3 text-xs font-bold transition-colors hover:bg-surface-2 active:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        @click="applyPreset(p)"
      >
        {{ p }}
      </button>
    </div>
    <div class="flex items-center gap-1.5">
      <input v-model="range[0]" type="date" aria-label="시작일" class="om-num h-9 rounded-lg border border-line bg-surface px-2 text-xs focus:outline-none focus:ring-2 focus:ring-focus" />
      <span class="text-ink-subtle">~</span>
      <input v-model="range[1]" type="date" aria-label="종료일" class="om-num h-9 rounded-lg border border-line bg-surface px-2 text-xs focus:outline-none focus:ring-2 focus:ring-focus" />
    </div>
    <span class="text-2xs text-ink-subtle">직접 입력</span>
  </div>
</template>
