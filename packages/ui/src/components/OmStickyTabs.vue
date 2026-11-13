<script setup lang="ts">
// Sticky tab bar pinned under the header; the visible section drives the active tab.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface StickyTab { id: string; label: string; count?: number | null }
const props = withDefaults(defineProps<{ tabs: StickyTab[]; offsetTop?: string }>(), { offsetTop: '64px' })
const active = defineModel<string>({ default: '' })
let observer: IntersectionObserver | null = null
const select = (id: string) => {
  active.value = id
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
onMounted(() => {
  if (!active.value && props.tabs.length) active.value = props.tabs[0].id
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) active.value = e.target.id
    },
    { rootMargin: '-30% 0px -60% 0px' }
  )
  for (const tb of props.tabs) {
    const el = document.getElementById(tb.id)
    if (el) observer.observe(el)
  }
})
watch(() => props.tabs, () => {
  observer?.disconnect()
  for (const tb of props.tabs) {
    const el = document.getElementById(tb.id)
    if (el) observer?.observe(el)
  }
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div class="sticky z-sticky -mx-4 border-b border-line-divider bg-surface/95 px-4 backdrop-blur" :style="{ top: offsetTop }" role="tablist" aria-label="구역 이동">
    <div class="flex gap-1 overflow-x-auto om-scrollbar-none">
      <button
        v-for="tb in tabs"
        :key="tb.id"
        type="button"
        role="tab"
        :aria-selected="active === tb.id"
        :class="['whitespace-nowrap px-3 py-2.5 text-sm font-semibold transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', active === tb.id ? 'text-ink shadow-[inset_0_-2px_0_0_var(--om-primary)]' : 'text-ink-muted']"
        @click="select(tb.id)"
      >
        {{ tb.label }}<span v-if="tb.count !== null && tb.count !== undefined" class="om-num ml-1 text-xs">({{ tb.count }})</span>
      </button>
    </div>
  </div>
</template>
