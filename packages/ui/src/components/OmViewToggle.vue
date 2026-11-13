<script setup lang="ts">
// Grid / list view switch.
import { LayoutGrid, List } from 'lucide-vue-next'

const mode = defineModel<'grid' | 'list'>({ default: 'grid' })
const btn = (on: boolean) => [
  'flex h-9 w-9 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
  on ? 'bg-secondary text-secondary-on' : 'text-ink-muted hover:bg-surface-2'
]
</script>

<template>
  <div class="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="보기 방식">
    <button type="button" :class="btn(mode === 'grid')" :aria-pressed="mode === 'grid'" aria-label="그리드 보기" @click="mode = 'grid'">
      <LayoutGrid class="h-4 w-4" aria-hidden="true" />
    </button>
    <button type="button" :class="btn(mode === 'list')" :aria-pressed="mode === 'list'" aria-label="리스트 보기" @click="mode = 'list'">
      <List class="h-4 w-4" aria-hidden="true" />
    </button>
  </div>
</template>
