<script setup lang="ts">
// Page navigation. Shows "총 N건" when total is known; compact prev/next on phones.
import { computed } from 'vue'
const page = defineModel<number>({ default: 1 })
const props = withDefaults(defineProps<{ total: number; pageSize?: number; siblings?: number }>(), { pageSize: 20, siblings: 1 })
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const items = computed<(number | '…')[]>(() => {
  const p = page.value; const n = pages.value; const s = props.siblings
  const out: (number | '…')[] = []
  for (let i = 1; i <= n; i++) {
    if (i === 1 || i === n || (i >= p - s && i <= p + s)) out.push(i)
    else if (out[out.length - 1] !== '…') out.push('…')
  }
  return out
})
const go = (n: number) => { if (n >= 1 && n <= pages.value && n !== page.value) page.value = n }
const btn = 'inline-flex h-9 min-w-9 items-center justify-center rounded px-2 text-sm font-semibold transition-colors duration-fast disabled:opacity-40 disabled:cursor-not-allowed'
</script>

<template>
  <nav aria-label="페이지" class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-xs text-ink-muted om-num">총 {{ total.toLocaleString('ko-KR') }}건 · {{ page }} / {{ pages }}쪽</p>
    <div class="flex items-center gap-1">
      <button type="button" :class="[btn, 'hover:bg-surface-2']" :disabled="page <= 1" aria-label="이전 페이지" @click="go(page - 1)">‹</button>
      <template v-for="(it, i) in items" :key="i">
        <span v-if="it === '…'" class="hidden px-1 text-ink-subtle sm:inline">…</span>
        <button
          v-else
          type="button"
          :aria-current="it === page ? 'page' : undefined"
          :class="[btn, 'hidden sm:inline-flex om-num', it === page ? 'bg-secondary text-secondary-on' : 'hover:bg-surface-2']"
          @click="go(it)"
        >{{ it }}</button>
      </template>
      <span class="px-2 text-sm font-semibold sm:hidden om-num">{{ page }}</span>
      <button type="button" :class="[btn, 'hover:bg-surface-2']" :disabled="page >= pages" aria-label="다음 페이지" @click="go(page + 1)">›</button>
    </div>
  </nav>
</template>
