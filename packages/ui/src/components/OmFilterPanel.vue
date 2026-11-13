<script setup lang="ts">
// Filter panel: category tree, checkbox groups, price range, toggles.
// Desktop renders a 240px sidebar; mobile uses the bottom sheet.
import OmBottomSheet from './OmBottomSheet.vue'
import OmCheckbox from './OmCheckbox.vue'
import OmSwitch from './OmSwitch.vue'

export interface FilterNode { id: string; label: string; count?: number | null; children?: FilterNode[] }
export interface FilterGroup { key: string; label: string; options: { value: string; label: string; count?: number | null }[] }

const props = withDefaults(defineProps<{
  categories?: FilterNode[]
  groups?: FilterGroup[]
  priceBounds?: [number, number] | null
  toggles?: { key: string; label: string }[]
  resultCount?: number | null
  mode?: 'sidebar' | 'sheet'
}>(), { mode: 'sidebar' })
const open = defineModel<boolean>('open', { default: false })
const cats = defineModel<string[]>('cats', { default: () => [] })
const picked = defineModel<Record<string, string[]>>('picked', { default: () => ({}) })
const price = defineModel<[number | null, number | null]>('price', { default: () => [null, null] })
const flags = defineModel<Record<string, boolean>>('flags', { default: () => ({}) })
const emit = defineEmits<{ apply: []; reset: [] }>()

const toggleList = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
const flat = (nodes: FilterNode[], depth = 0): { node: FilterNode; depth: number }[] =>
  nodes.flatMap((n) => [{ node: n, depth }, ...flat(n.children ?? [], depth + 1)])
</script>

<template>
  <OmBottomSheet v-if="mode === 'sheet'" v-model="open" title="필터">
    <div class="space-y-6">
      <slot name="body" />
    </div>
    <template #footer>
      <div class="flex gap-2">
        <button type="button" class="h-10 flex-1 rounded-lg border border-line text-sm font-bold" @click="emit('reset')">초기화</button>
        <button type="button" class="h-10 flex-[2] rounded-lg bg-secondary text-sm font-bold text-secondary-on" @click="emit('apply')">
          {{ resultCount !== null && resultCount !== undefined ? `${resultCount}개 상품 보기` : '적용하기' }}
        </button>
      </div>
    </template>
  </OmBottomSheet>
  <aside v-else class="w-[240px] shrink-0 space-y-6" aria-label="상품 필터">
    <section v-if="categories?.length">
      <h3 class="mb-2 text-sm font-bold text-ink">카테고리</h3>
      <ul class="space-y-0.5">
        <li v-for="{ node, depth } in flat(categories)" :key="node.id">
          <div class="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2" :style="{ paddingLeft: `${0.5 + depth * 1}rem` }">
            <OmCheckbox :label="node.label" :model-value="cats.includes(node.id)" @update:model-value="cats = toggleList(cats, node.id)" />
            <span v-if="node.count !== null && node.count !== undefined" class="om-num ml-auto text-xs text-ink-subtle">{{ node.count }}</span>
          </div>
        </li>
      </ul>
    </section>
    <section v-for="g in groups ?? []" :key="g.key">
      <h3 class="mb-2 text-sm font-bold text-ink">{{ g.label }}</h3>
      <ul class="space-y-0.5">
        <li v-for="o in g.options" :key="o.value">
          <div class="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2">
            <OmCheckbox :label="o.label" :model-value="(picked[g.key] ?? []).includes(o.value)" @update:model-value="picked = { ...picked, [g.key]: toggleList(picked[g.key] ?? [], o.value) }" />
            <span v-if="o.count !== null && o.count !== undefined" class="om-num ml-auto text-xs text-ink-subtle">{{ o.count }}</span>
          </div>
        </li>
      </ul>
    </section>
    <section v-if="priceBounds">
      <h3 class="mb-2 text-sm font-bold text-ink">가격대</h3>
      <div class="flex items-center gap-2">
        <input :value="price[0] ?? ''" type="number" :min="priceBounds[0]" :max="priceBounds[1]" aria-label="최저 가격" placeholder="최저가"
          class="om-num h-9 w-full rounded-lg border border-line bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus"
          @change="price = [($event.target as HTMLInputElement).valueAsNumber || null, price[1]]" />
        <span class="text-ink-subtle">~</span>
        <input :value="price[1] ?? ''" type="number" :min="priceBounds[0]" :max="priceBounds[1]" aria-label="최고 가격" placeholder="최고가"
          class="om-num h-9 w-full rounded-lg border border-line bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus"
          @change="price = [price[0], ($event.target as HTMLInputElement).valueAsNumber || null]" />
      </div>
    </section>
    <section v-if="toggles?.length" class="space-y-2">
      <div v-for="tg in toggles" :key="tg.key" class="flex items-center justify-between gap-2">
        <span class="text-sm">{{ tg.label }}</span>
        <OmSwitch :model-value="!!flags[tg.key]" @update:model-value="flags = { ...flags, [tg.key]: $event }" />
      </div>
    </section>
  </aside>
</template>
