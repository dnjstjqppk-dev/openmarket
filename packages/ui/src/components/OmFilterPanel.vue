<script setup lang="ts">
// Filter panel: category tree, checkbox groups (searchable), price range with
// slider + direct inputs, toggles. Desktop renders a 240px sidebar; mobile
// uses the bottom sheet with the same sections and an "N개 상품 보기" footer.
import { computed, ref } from 'vue'
import OmBottomSheet from './OmBottomSheet.vue'
import OmCheckbox from './OmCheckbox.vue'
import OmSwitch from './OmSwitch.vue'
import OmInput from './OmInput.vue'

export interface FilterNode { id: string; label: string; count?: number | null; children?: FilterNode[] }
export interface FilterGroup {
  key: string
  label: string
  searchable?: boolean
  options: { value: string; label: string; count?: number | null }[]
}

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

const brandQuery = ref('')
const filteredOptions = (g: FilterGroup) => {
  if (!g.searchable || !brandQuery.value.trim()) return g.options
  const q = brandQuery.value.trim().toLowerCase()
  return g.options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
}

// Dual-thumb slider over the price bounds; null ends mean open-ended.
const lo = computed(() => props.priceBounds?.[0] ?? 0)
const hi = computed(() => Math.max(props.priceBounds?.[1] ?? 0, lo.value + 1))
const loVal = computed(() => price.value[0] ?? lo.value)
const hiVal = computed(() => price.value[1] ?? hi.value)
const fillPct = computed(() => {
  const span = hi.value - lo.value || 1
  return { left: `${((loVal.value - lo.value) / span) * 100}%`, width: `${((hiVal.value - loVal.value) / span) * 100}%` }
})
function slide(which: 0 | 1, v: number) {
  if (!Number.isFinite(v)) return
  if (which === 0) price.value = [Math.min(v, hiVal.value), price.value[1]]
  else price.value = [price.value[0], Math.max(v, loVal.value)]
}
</script>

<template>
  <OmBottomSheet v-if="mode === 'sheet'" v-model="open" title="필터">
    <div class="space-y-6">
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
        <div v-if="g.searchable" class="mb-2"><OmInput v-model="brandQuery" size="sm" placeholder="브랜드 검색" aria-label="브랜드 검색" /></div>
        <ul class="space-y-0.5">
          <li v-for="o in filteredOptions(g)" :key="o.value">
            <div class="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2">
              <OmCheckbox :label="o.label" :model-value="(picked[g.key] ?? []).includes(o.value)" @update:model-value="picked = { ...picked, [g.key]: toggleList(picked[g.key] ?? [], o.value) }" />
              <span v-if="o.count !== null && o.count !== undefined" class="om-num ml-auto text-xs text-ink-subtle">{{ o.count }}</span>
            </div>
          </li>
        </ul>
        <slot name="body" />
      </section>
      <section v-if="priceBounds">
        <h3 class="mb-2 text-sm font-bold text-ink">가격대</h3>
        <div class="relative h-6" role="group" aria-label="가격 범위 막대">
          <div class="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-surface-3" aria-hidden="true" />
          <div class="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary" :style="{ left: fillPct.left, width: fillPct.width }" aria-hidden="true" />
          <input type="range" :min="lo" :max="hi" :value="loVal" aria-label="최저 가격 막대" class="absolute inset-x-0 top-1/2 w-full -translate-y-1/2 appearance-none bg-transparent" @input="slide(0, ($event.target as HTMLInputElement).valueAsNumber)" />
          <input type="range" :min="lo" :max="hi" :value="hiVal" aria-label="최고 가격 막대" class="absolute inset-x-0 top-1/2 w-full -translate-y-1/2 appearance-none bg-transparent" @input="slide(1, ($event.target as HTMLInputElement).valueAsNumber)" />
        </div>
        <div class="mt-2 flex items-center gap-2">
          <input :value="price[0] ?? ''" type="number" :min="lo" :max="hi" aria-label="최저 가격" placeholder="최저가"
            class="om-num h-9 w-full rounded-lg border border-line bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus"
            @change="price = [($event.target as HTMLInputElement).valueAsNumber || null, price[1]]" />
          <span class="text-ink-subtle">~</span>
          <input :value="price[1] ?? ''" type="number" :min="lo" :max="hi" aria-label="최고 가격" placeholder="최고가"
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
      <div v-if="g.searchable" class="mb-2"><OmInput v-model="brandQuery" size="sm" placeholder="브랜드 검색" aria-label="브랜드 검색" /></div>
      <ul class="space-y-0.5">
        <li v-for="o in filteredOptions(g)" :key="o.value">
          <div class="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2">
            <OmCheckbox :label="o.label" :model-value="(picked[g.key] ?? []).includes(o.value)" @update:model-value="picked = { ...picked, [g.key]: toggleList(picked[g.key] ?? [], o.value) }" />
            <span v-if="o.count !== null && o.count !== undefined" class="om-num ml-auto text-xs text-ink-subtle">{{ o.count }}</span>
          </div>
        </li>
      </ul>
    </section>
    <section v-if="priceBounds">
      <h3 class="mb-2 text-sm font-bold text-ink">가격대</h3>
      <div class="relative h-6" role="group" aria-label="가격 범위 막대">
        <div class="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-surface-3" aria-hidden="true" />
        <div class="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary" :style="{ left: fillPct.left, width: fillPct.width }" aria-hidden="true" />
        <input type="range" :min="lo" :max="hi" :value="loVal" aria-label="최저 가격 막대" class="absolute inset-x-0 top-1/2 w-full -translate-y-1/2 appearance-none bg-transparent" @input="slide(0, ($event.target as HTMLInputElement).valueAsNumber)" />
        <input type="range" :min="lo" :max="hi" :value="hiVal" aria-label="최고 가격 막대" class="absolute inset-x-0 top-1/2 w-full -translate-y-1/2 appearance-none bg-transparent" @input="slide(1, ($event.target as HTMLInputElement).valueAsNumber)" />
      </div>
      <div class="mt-2 flex items-center gap-2">
        <input :value="price[0] ?? ''" type="number" :min="lo" :max="hi" aria-label="최저 가격" placeholder="최저가"
          class="om-num h-9 w-full rounded-lg border border-line bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus"
          @change="price = [($event.target as HTMLInputElement).valueAsNumber || null, price[1]]" />
        <span class="text-ink-subtle">~</span>
        <input :value="price[1] ?? ''" type="number" :min="lo" :max="hi" aria-label="최고 가격" placeholder="최고가"
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
