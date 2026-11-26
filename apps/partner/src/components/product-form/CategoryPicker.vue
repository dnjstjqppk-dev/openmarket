<script setup lang="ts">
// Three-column category picker (4-3): depth columns plus name search over
// the active catalog tree. Emits the chosen category id.
import { ref, computed, watch } from 'vue'

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
// Ancestor chain (root first) of a category id; stops on unknown ids and on cycles.
function chainOf(id: string): CategoryNode[] {
  const chain: CategoryNode[] = []
  const seen = new Set<string>()
  let cur = props.categories.find((c) => c.id === id)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    chain.unshift(cur)
    cur = props.categories.find((c) => c.id === String(cur!.parent_id || ''))
  }
  return chain
}
const selectedPath = computed(() => chainOf(selectedId.value).map((c) => c.name))

// The open columns follow the selected value, so an already-saved category (edit screen)
// or a search hit opens its own parent columns instead of empty "대분류 선택" columns.
watch([selectedId, () => props.categories], () => {
  const ids = chainOf(selectedId.value).map((c) => c.id)
  if (ids.length) path.value = ids
}, { immediate: true })

function pick(id: string) {
  selectedId.value = id
  query.value = ''
}
</script>

<template>
  <div class="space-y-2">
    <input v-model="query" placeholder="카테고리 검색" aria-label="카테고리 검색" class="h-9 w-full rounded-lg border border-line bg-surface px-3 text-xs text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus" />
    <ul v-if="query.trim()" class="max-h-32 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
      <li v-for="c in searchHits" :key="c.id">
        <button type="button" class="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-2" :class="selectedId === c.id ? 'font-bold text-primary' : 'text-ink'" @click="pick(c.id)">{{ c.name }}</button>
      </li>
      <li v-if="!searchHits.length" class="px-2 py-1.5 text-xs text-ink-subtle">일치하는 카테고리가 없습니다.</li>
    </ul>
    <div v-else class="grid grid-cols-3 gap-2">
      <ul class="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
        <li v-for="c in roots" :key="c.id">
          <button type="button" class="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-2" :class="path[0] === c.id || selectedId === c.id ? 'bg-primary-soft font-bold text-primary-soft-ink' : 'text-ink'" @click="pick(c.id)">{{ c.name }}</button>
        </li>
      </ul>
      <ul class="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
        <li v-if="!path[0]" class="px-2 py-1.5 text-xs text-ink-subtle">대분류 선택</li>
        <li v-for="c in childrenOf(path[0] || '__none__')" :key="c.id">
          <button type="button" class="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-2" :class="path[1] === c.id || selectedId === c.id ? 'bg-primary-soft font-bold text-primary-soft-ink' : 'text-ink'" @click="pick(c.id)">{{ c.name }}</button>
        </li>
      </ul>
      <ul class="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
        <li v-if="!path[1]" class="px-2 py-1.5 text-xs text-ink-subtle">중분류 선택</li>
        <li v-for="c in childrenOf(path[1] || '__none__')" :key="c.id">
          <button type="button" class="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-2" :class="selectedId === c.id ? 'bg-primary-soft font-bold text-primary-soft-ink' : 'text-ink'" @click="pick(c.id)">{{ c.name }}</button>
        </li>
      </ul>
    </div>
    <p v-if="selectedPath.length" class="text-xs text-ink-muted">선택: {{ selectedPath.join(' > ') }}</p>
  </div>
</template>
