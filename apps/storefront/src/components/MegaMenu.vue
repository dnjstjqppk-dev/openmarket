<script setup lang="ts">
// Category mega menu. Hovering the trigger for 0.15s opens the panel (click or
// Enter work too). Left: top-level categories; right: mid-level titles with
// leaf links. Root switches are debounced 0.12s so diagonal crossings toward
// the panel do not flip the section. Arrow keys traverse, ESC closes.
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { ChevronDown, ChevronRight, LayoutGrid } from 'lucide-vue-next'
import { useCatalogStore } from '../stores/catalog'
import { useClickOutside } from '@olmoa/ui'

const catalog = useCatalogStore()
onMounted(() => { catalog.load() })
const root = ref<HTMLElement | null>(null)
const open = ref(false)
const activeId = ref<string | null>(null)
let openTimer: ReturnType<typeof setTimeout> | null = null
let switchTimer: ReturnType<typeof setTimeout> | null = null
const clearTimers = () => {
  if (openTimer) { clearTimeout(openTimer); openTimer = null }
  if (switchTimer) { clearTimeout(switchTimer); switchTimer = null }
}
onBeforeUnmount(clearTimers)
useClickOutside([root], () => { open.value = false })

const roots = () => catalog.roots
const midsOf = (id: string) => catalog.childrenOf(id)
const leafsOf = (id: string) => catalog.childrenOf(id)

function requestOpen() {
  clearTimers()
  openTimer = setTimeout(() => {
    open.value = true
    if (!activeId.value && roots().length) activeId.value = roots()[0].id
  }, 150)
}
function toggle() {
  clearTimers()
  open.value = !open.value
  if (open.value && !activeId.value && roots().length) activeId.value = roots()[0].id
}
function close() {
  clearTimers()
  open.value = false
}
// Diagonal grace: settle 0.12s before switching the right panel.
function requestRoot(id: string) {
  if (id === activeId.value) return
  if (switchTimer) clearTimeout(switchTimer)
  switchTimer = setTimeout(() => { activeId.value = id }, 120)
}
function onTriggerKey(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() }
  else if (e.key === 'Escape') close()
  else if (e.key === 'ArrowDown' && open.value) {
    e.preventDefault()
    root.value?.querySelector<HTMLElement>('[data-root]')?.focus()
  }
}
function onRootKey(e: KeyboardEvent, id: string, index: number) {
  const list = roots()
  if (e.key === 'ArrowDown') { e.preventDefault(); focusRoot((index + 1) % list.length) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); focusRoot((index - 1 + list.length) % list.length) }
  else if (e.key === 'ArrowRight' || e.key === 'Enter') {
    e.preventDefault()
    activeId.value = id
    nextTick(() => root.value?.querySelector<HTMLElement>('[data-panel] a')?.focus())
  } else if (e.key === 'Escape') close()
}
function focusRoot(i: number) {
  const els = root.value?.querySelectorAll<HTMLElement>('[data-root]')
  els?.[i]?.focus()
  const r = roots()[i]
  if (r) activeId.value = r.id
}
</script>

<template>
  <div ref="root" class="relative" @mouseleave="close()">
    <button
      type="button"
      :aria-expanded="open"
      aria-haspopup="true"
      class="ml-2 hidden h-10 items-center gap-1.5 rounded px-3 text-sm font-semibold text-ink hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus lg:inline-flex"
      @mouseenter="requestOpen"
      @click="toggle"
      @keydown="onTriggerKey"
    >
      <LayoutGrid :size="18" aria-hidden="true" />카테고리<ChevronDown :size="16" :class="['transition-transform', open ? 'rotate-180' : '']" aria-hidden="true" />
    </button>
    <div
      v-if="open"
      data-panel-wrap
      class="absolute left-0 top-full z-dropdown mt-1 hidden w-[min(92vw,760px)] overflow-hidden rounded-lg border border-line bg-surface shadow-lg lg:block"
    >
      <div v-if="roots().length" class="flex max-h-[min(70vh,460px)]">
        <ul class="w-56 shrink-0 overflow-y-auto border-r border-line py-1" role="menu" aria-label="대분류">
          <li v-for="(c, i) in roots()" :key="c.id">
            <RouterLink
              :to="`/category/${c.slug}`"
              data-root
              role="menuitem"
              :class="['flex items-center gap-2 px-4 py-2 text-sm', activeId === c.id ? 'bg-primary-soft font-semibold text-primary-soft-ink' : 'text-ink hover:bg-surface-2']"
              @mouseenter="requestRoot(c.id)"
              @focus="activeId = c.id"
              @click="close()"
              @keydown="onRootKey($event, c.id, i)"
            >
              <span class="truncate">{{ c.name }}</span>
              <ChevronRight class="ml-auto h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
            </RouterLink>
          </li>
        </ul>
        <div data-panel class="min-w-0 flex-1 overflow-y-auto p-4">
          <div v-for="m in midsOf(activeId ?? '')" :key="m.id" class="mb-3 break-inside-avoid last:mb-0">
            <RouterLink :to="`/category/${m.slug}`" class="text-sm font-bold text-ink hover:underline" @click="close()">
              {{ m.name }}
            </RouterLink>
            <ul v-if="leafsOf(m.id).length" class="mt-1 grid grid-cols-2 gap-x-2">
              <li v-for="l in leafsOf(m.id)" :key="l.id">
                <RouterLink :to="`/category/${l.slug}`" class="block truncate rounded-sm px-2 py-1 text-xs text-ink-muted hover:bg-surface-2 hover:text-ink" @click="close()">
                  {{ l.name }}
                </RouterLink>
              </li>
            </ul>
          </div>
          <p v-if="!midsOf(activeId ?? '').length" class="py-8 text-center text-sm text-ink-subtle">하위 카테고리가 없습니다.</p>
        </div>
      </div>
      <p v-else class="p-6 text-center text-sm text-ink-muted">카테고리를 불러오지 못했습니다.</p>
    </div>
  </div>
</template>
