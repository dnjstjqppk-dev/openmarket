<script setup lang="ts">
// Three-column category picker (4-3): depth columns plus name search over
// the active catalog tree. Emits the chosen category id.
import { ref, computed } from 'vue'

export interface CategoryNode { id: string; name: string; slug?: string; depth: number; parent_id?: string | null }
const props = defineProps<{ categories: CategoryNode[] }>()
const selectedId = defineModel<string>({ default: '' })
const query = ref('')
const path = ref<string[]>([])

const roots = computed(() => props.categories.filter((c) => Number(c.depth) === 0))
const childrenOf = (id: string | null) => props.categories.filter((c) => String(c.parent_id || '') === String(id || ''))
const searchHits = computed(() => {
  const q = query.value.trim()
  if (!q) return []
  return props.categories.filter((c) => (c.name || '').includes(q)).slice(0, 10)
})
const selectedPath = computed(() => {
  const chain: string[] = []
  let cur = props.categories.find((c) => c.id === selectedId.value)
  while (cur) { chain.unshift(cur.name); cur = props.categories.find((c) => c.id === String(cur!.parent_id || '')) }
  return chain
})

function pick(id: string, depth: number) {
  selectedId.value = id
  path.value = [...path.value.slice(0, depth), id]
}
</script>

<template>
  <div class="space-y-2">
    <input v-model="query" placeholder="카테고리 검색" aria-label="카테고리 검색" class="h-9 w-full rounded-lg border border-line bg-surface px-3 text-xs text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus" />
    <ul v-if="query.trim()" class="max-h-32 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
      <li v-for="c in searchHits" :key="c.id">
        <button type="button" class="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-2" :class="selectedId === c.id ? 'font-bold text-primary' : 'text-ink'" @click="pick(c.id, Number(c.depth))">{{ c.name }}</button>
      </li>
      <li v-if="!searchHits.length" class="px-2 py-1.5 text-xs text-ink-subtle">일치하는 카테고리가 없습니다.</li>
    </ul>
    <div v-else class="grid grid-cols-3 gap-2">
      <ul class="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
        <li v-for="c in roots" :key="c.id">
          <button type="button" class="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-2" :class="path[0] === c.id || selectedId === c.id ? 'bg-primary-soft font-bold text-primary-soft-ink' : 'text-ink'" @click="pick(c.id, 0)">{{ c.name }}</button>
        </li>
      </ul>
      <ul class="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
        <li v-if="!path[0]" class="px-2 py-1.5 text-xs text-ink-subtle">대분류 선택</li>
        <li v-for="c in childrenOf(path[0] || '__none__')" :key="c.id">
          <button type="button" class="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-2" :class="path[1] === c.id || selectedId === c.id ? 'bg-primary-soft font-bold text-primary-soft-ink' : 'text-ink'" @click="pick(c.id, 1)">{{ c.name }}</button>
        </li>
      </ul>
      <ul class="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
        <li v-if="!path[1]" class="px-2 py-1.5 text-xs text-ink-subtle">중분류 선택</li>
        <li v-for="c in childrenOf(path[1] || '__none__')" :key="c.id">
          <button type="button" class="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-2" :class="selectedId === c.id ? 'bg-primary-soft font-bold text-primary-soft-ink' : 'text-ink'" @click="pick(c.id, 2)">{{ c.name }}</button>
        </li>
      </ul>
    </div>
    <p v-if="selectedPath.length" class="text-xs text-ink-muted">선택: {{ selectedPath.join(' > ') }}</p>
  </div>
</template>
