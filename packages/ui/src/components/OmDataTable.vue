<script setup lang="ts" generic="T extends Record<string, any>">
// Console data table: sortable headers, row selection (bulk actions), loading skeleton, empty and error states.
// Below `md` each row becomes a card (label: value) instead of a squeezed table.
// Cell slots: #cell-<key>="{ row, value }"; row actions: #actions="{ row }".
import { computed } from 'vue'
import OmCheckbox from './OmCheckbox.vue'
import OmSkeleton from './OmSkeleton.vue'
import OmEmptyState from './OmEmptyState.vue'
import OmErrorState from './OmErrorState.vue'

export interface Column { key: string; label: string; align?: 'left' | 'right' | 'center'; width?: string; sortable?: boolean; mobileHidden?: boolean; primary?: boolean }
export interface SortState { key: string; dir: 'asc' | 'desc' }

const props = withDefaults(defineProps<{
  columns: Column[]
  rows: T[]
  rowKey?: string
  loading?: boolean
  error?: string | null
  selectable?: boolean
  emptyTitle?: string
  emptyDescription?: string
  dense?: boolean
  caption?: string
  rowClickable?: boolean
}>(), { rowKey: 'id', loading: false, error: null, selectable: false, emptyTitle: '표시할 데이터가 없습니다', dense: false, rowClickable: false })

const selected = defineModel<(string | number)[]>('selected', { default: () => [] })
const sort = defineModel<SortState | null>('sort', { default: null })
const emit = defineEmits<{ retry: []; rowClick: [row: T] }>()

const keyOf = (r: T) => r[props.rowKey] as string | number
const allSelected = computed(() => props.rows.length > 0 && props.rows.every((r) => selected.value.includes(keyOf(r))))
const someSelected = computed(() => !allSelected.value && props.rows.some((r) => selected.value.includes(keyOf(r))))
const toggleAll = (v: boolean | any[]) => { selected.value = v ? props.rows.map(keyOf) : [] }
const toggleSort = (c: Column) => {
  if (!c.sortable) return
  sort.value = sort.value?.key === c.key ? (sort.value.dir === 'asc' ? { key: c.key, dir: 'desc' } : null) : { key: c.key, dir: 'asc' }
}
const ariaSort = (c: Column) => (sort.value?.key === c.key ? (sort.value.dir === 'asc' ? 'ascending' : 'descending') : c.sortable ? 'none' : undefined)
const align = (c: Column) => (c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left')
</script>

<template>
  <div class="w-full">
    <div v-if="$slots.toolbar || (selectable && selected.length)" class="mb-3 flex flex-wrap items-center gap-2">
      <div v-if="selectable && selected.length" class="flex items-center gap-2 rounded bg-primary-soft px-3 py-1.5 text-sm font-semibold text-primary-soft-ink">
        <span class="om-num">{{ selected.length }}개 선택</span>
        <slot name="bulk" :selected="selected" />
      </div>
      <slot name="toolbar" />
    </div>

    <OmErrorState v-if="error" compact :message="error" @retry="emit('retry')" />

    <template v-else>
      <!-- table (md and up) -->
      <div class="hidden overflow-x-auto rounded-lg border border-line bg-surface md:block">
        <table class="w-full border-collapse text-sm">
          <caption v-if="caption" class="sr-only">{{ caption }}</caption>
          <thead class="sticky top-0 z-[1] bg-surface-2">
            <tr>
              <th v-if="selectable" scope="col" class="w-10 border-b border-line px-3 py-2.5">
                <OmCheckbox :model-value="allSelected" :indeterminate="someSelected" aria-label="전체 선택" @update:model-value="toggleAll" />
              </th>
              <th
                v-for="c in columns"
                :key="c.key"
                scope="col"
                :style="c.width ? { width: c.width } : undefined"
                :aria-sort="ariaSort(c)"
                :class="['whitespace-nowrap border-b border-line px-3 py-2.5 text-xs font-semibold text-ink-muted', align(c)]"
              >
                <button v-if="c.sortable" type="button" class="inline-flex items-center gap-1 hover:text-ink" @click="toggleSort(c)">
                  {{ c.label }}
                  <span aria-hidden="true" class="text-2xs">{{ sort?.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕' }}</span>
                </button>
                <span v-else>{{ c.label }}</span>
              </th>
              <th v-if="$slots.actions" scope="col" class="w-px border-b border-line px-3 py-2.5"><span class="sr-only">작업</span></th>
            </tr>
          </thead>
          <tbody v-if="loading">
            <tr v-for="n in 6" :key="n"><td :colspan="columns.length + (selectable ? 1 : 0) + ($slots.actions ? 1 : 0)" class="px-3"><OmSkeleton variant="row" /></td></tr>
          </tbody>
          <tbody v-else-if="rows.length">
            <tr
              v-for="r in rows"
              :key="keyOf(r)"
              :class="['border-b border-line-divider last:border-0 hover:bg-surface-2', selected.includes(keyOf(r)) ? 'bg-primary-soft/50' : '', rowClickable ? 'cursor-pointer' : '']"
              @click="rowClickable && emit('rowClick', r)"
            >
              <td v-if="selectable" class="px-3" @click.stop><OmCheckbox v-model="selected" :value="keyOf(r)" :aria-label="`${keyOf(r)} 선택`" /></td>
              <td v-for="c in columns" :key="c.key" :class="[dense ? 'py-2' : 'py-3', 'px-3 align-middle', align(c), c.align === 'right' ? 'om-num' : '']">
                <slot :name="`cell-${c.key}`" :row="r" :value="r[c.key]">{{ r[c.key] ?? '-' }}</slot>
              </td>
              <td v-if="$slots.actions" class="whitespace-nowrap px-3 text-right" @click.stop><slot name="actions" :row="r" /></td>
            </tr>
          </tbody>
        </table>
        <OmEmptyState v-if="!loading && !rows.length" compact :title="emptyTitle" :description="emptyDescription"><slot name="empty" /></OmEmptyState>
      </div>

      <!-- cards (below md) -->
      <div class="flex flex-col gap-2 md:hidden">
        <template v-if="loading"><OmSkeleton variant="rect" height="h-24" :count="4" /></template>
        <template v-else-if="rows.length">
          <article
            v-for="r in rows"
            :key="keyOf(r)"
            :class="['rounded-lg border bg-surface p-4', selected.includes(keyOf(r)) ? 'border-primary' : 'border-line']"
            @click="rowClickable && emit('rowClick', r)"
          >
            <div class="flex items-start gap-3">
              <OmCheckbox v-if="selectable" v-model="selected" :value="keyOf(r)" :aria-label="`${keyOf(r)} 선택`" @click.stop />
              <dl class="grid min-w-0 flex-1 grid-cols-[auto,1fr] gap-x-3 gap-y-1.5 text-sm">
                <template v-for="c in columns.filter((x) => !x.mobileHidden)" :key="c.key">
                  <dt class="whitespace-nowrap text-xs text-ink-muted">{{ c.label }}</dt>
                  <dd :class="['min-w-0 break-words', c.primary ? 'font-semibold' : '', c.align === 'right' ? 'om-num' : '']">
                    <slot :name="`cell-${c.key}`" :row="r" :value="r[c.key]">{{ r[c.key] ?? '-' }}</slot>
                  </dd>
                </template>
              </dl>
            </div>
            <div v-if="$slots.actions" class="mt-3 flex flex-wrap justify-end gap-2 border-t border-line-divider pt-3" @click.stop><slot name="actions" :row="r" /></div>
          </article>
        </template>
        <OmEmptyState v-else compact :title="emptyTitle" :description="emptyDescription"><slot name="empty" /></OmEmptyState>
      </div>
    </template>
  </div>
</template>
