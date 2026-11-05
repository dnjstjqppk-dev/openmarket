<script setup lang="ts">
// Search box with grouped, keyboard-navigable autocomplete (WAI-ARIA combobox).
// Without a `fetcher` it is a plain search field. Selecting a result emits the real record (id + type);
// Enter without a highlighted result emits `submit` with the typed text.
import { ref, computed, onBeforeUnmount, useId } from 'vue'
import { createAutocomplete, type AcFetcher, type AcGroup, type AcItem, type AcState } from '../composables/autocompleteCore'
import { useClickOutside } from '../composables/useClickOutside'
import OmSpinner from './OmSpinner.vue'

const props = withDefaults(defineProps<{
  placeholder?: string
  fetcher?: AcFetcher
  minChars?: number
  debounceMs?: number
  size?: 'md' | 'lg'
  label?: string
  emptyText?: string
}>(), { placeholder: '검색', minChars: 1, debounceMs: 200, size: 'md', label: '검색', emptyText: '일치하는 결과가 없습니다' })
const emit = defineEmits<{ select: [item: AcItem]; submit: [query: string]; focus: [] }>()
const model = defineModel<string>({ default: '' })

const uid = useId()
const root = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)
const open = ref(false)
const active = ref(-1)
const st = ref<AcState>({ query: '', loading: false, error: null, groups: [], settledQuery: '' })

const ac = props.fetcher ? createAutocomplete({ fetcher: props.fetcher, debounceMs: props.debounceMs, minChars: props.minChars, onChange: (s) => { st.value = s; active.value = -1 } }) : null
onBeforeUnmount(() => ac?.dispose())
useClickOutside([root], () => { open.value = false })

const flat = computed<AcItem[]>(() => st.value.groups.flatMap((g: AcGroup) => g.items))
const listId = `${uid}-list`
const optId = (i: number) => `${uid}-opt-${i}`
const showPanel = computed(() => open.value && !!ac && (st.value.loading || !!st.value.error || st.value.settledQuery !== ''))

function onInput(e: Event) {
  const v = (e.target as HTMLInputElement).value
  model.value = v
  open.value = true
  ac?.input(v)
}
function onKey(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return // IME is still composing: Enter/arrows belong to the IME
  const n = flat.value.length
  if (e.key === 'ArrowDown') { e.preventDefault(); open.value = true; if (n) active.value = (active.value + 1) % n }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) active.value = (active.value - 1 + n) % n }
  else if (e.key === 'Escape') { if (open.value) { e.preventDefault(); open.value = false; active.value = -1 } }
  else if (e.key === 'Enter') {
    e.preventDefault()
    if (open.value && active.value >= 0 && flat.value[active.value]) choose(flat.value[active.value])
    else { open.value = false; emit('submit', model.value.trim()) }
  } else if (e.key === 'Tab') { open.value = false }
}
function choose(it: AcItem) { open.value = false; active.value = -1; emit('select', it) }
function clear() { model.value = ''; ac?.clear(); inputEl.value?.focus() }
const indexOf = (it: AcItem) => flat.value.indexOf(it)
defineExpose({ focus: () => inputEl.value?.focus(), close: () => { open.value = false } })
</script>

<template>
  <div ref="root" class="relative w-full">
    <form role="search" class="relative flex items-center" @submit.prevent>
      <label :for="`${uid}-in`" class="sr-only">{{ label }}</label>
      <svg class="pointer-events-none absolute left-3.5 text-ink-muted" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input
        :id="`${uid}-in`"
        ref="inputEl"
        :value="model"
        type="search"
        enterkeyhint="search"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="showPanel"
        :aria-controls="listId"
        :aria-activedescendant="active >= 0 ? optId(active) : undefined"
        :placeholder="placeholder"
        :class="[
          'w-full rounded-full border border-line-strong bg-surface pl-11 pr-20 text-ink placeholder:text-ink-subtle transition-colors duration-fast',
          'hover:border-ink-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 [&::-webkit-search-cancel-button]:hidden',
          size === 'lg' ? 'h-12 text-md' : 'h-10 text-sm'
        ]"
        @input="onInput"
        @compositionstart="ac?.compositionStart()"
        @compositionend="ac?.compositionEnd(($event.target as HTMLInputElement).value)"
        @keydown="onKey"
        @focus="open = true; emit('focus')"
      />
      <span class="absolute right-2 flex items-center gap-1">
        <OmSpinner v-if="st.loading" :size="16" class="text-ink-muted" />
        <button v-if="model" type="button" class="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-surface-2" aria-label="검색어 지우기" @click="clear">×</button>
        <button type="button" :class="['flex items-center justify-center rounded-full bg-primary font-semibold text-primary-on hover:bg-primary-hover', size === 'lg' ? 'h-9 px-4 text-sm' : 'h-7 px-3 text-xs']" @click="open = false; emit('submit', model.trim())">검색</button>
      </span>
    </form>

    <div
      v-if="open && ac && (st.loading || st.error || st.settledQuery || $slots.idle)"
      class="absolute inset-x-0 top-full z-dropdown mt-2 max-h-[min(70dvh,520px)] overflow-y-auto rounded-lg border border-line bg-surface p-2 shadow-lg"
    >
      <ul :id="listId" role="listbox" :aria-label="`${label} 추천`">
        <template v-if="st.settledQuery">
          <template v-for="g in st.groups" :key="g.key">
            <li v-if="g.items.length" role="presentation" class="px-3 pb-1 pt-2 text-2xs font-bold uppercase tracking-wider text-ink-subtle">{{ g.label }}</li>
            <li
              v-for="it in g.items"
              :id="optId(indexOf(it))"
              :key="g.key + it.id"
              role="option"
              :aria-selected="active === indexOf(it)"
              :class="['flex cursor-pointer items-center gap-3 rounded px-3 py-2', active === indexOf(it) ? 'bg-primary-soft' : 'hover:bg-surface-2']"
              @mousedown.prevent
              @click="choose(it)"
              @mousemove="active = indexOf(it)"
            >
              <img v-if="it.image" :src="it.image" alt="" class="h-9 w-9 shrink-0 rounded-sm border border-line object-cover" loading="lazy" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm text-ink">{{ it.label }}</span>
                <span v-if="it.sub" class="block truncate text-xs text-ink-muted">{{ it.sub }}</span>
              </span>
            </li>
          </template>
          <li v-if="!st.loading && !st.error && !flat.length" role="presentation" class="px-3 py-6 text-center text-sm text-ink-muted">{{ emptyText }}</li>
        </template>
        <li v-else-if="st.loading" role="presentation" class="px-3 py-4 text-center text-sm text-ink-muted">검색 중…</li>
      </ul>
      <div v-if="st.error" class="flex items-center justify-between gap-3 rounded bg-danger-soft px-3 py-2.5 text-sm text-danger" role="alert">
        <span>{{ st.error }}</span>
        <button type="button" class="shrink-0 font-semibold underline" @click="ac?.retry()">다시 시도</button>
      </div>
      <div v-if="!st.settledQuery && !st.loading && !st.error && $slots.idle"><slot name="idle" :close="() => (open = false)" /></div>
    </div>
  </div>
</template>
