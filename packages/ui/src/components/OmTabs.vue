<script setup lang="ts">
// WAI-ARIA tabs (Meridian 2.0): roving tabindex, line & pill variants + 4-language tab label support.
import { ref, useId } from 'vue'
import { uiT } from '../composables/useUiLocale'

export interface TabItem { key: string; label: string; count?: number | null; disabled?: boolean }
const model = defineModel<string>({ required: true })
withDefaults(defineProps<{ tabs: TabItem[]; variant?: 'line' | 'pill'; full?: boolean }>(), { variant: 'line', full: false })
const uid = useId()
const list = ref<HTMLElement | null>(null)
const onKey = (e: KeyboardEvent, tabs: TabItem[]) => {
  const enabled = tabs.filter((t) => !t.disabled)
  const i = enabled.findIndex((t) => t.key === model.value)
  let n = -1
  if (e.key === 'ArrowRight') n = (i + 1) % enabled.length
  else if (e.key === 'ArrowLeft') n = (i - 1 + enabled.length) % enabled.length
  else if (e.key === 'Home') n = 0
  else if (e.key === 'End') n = enabled.length - 1
  if (n < 0) return
  e.preventDefault()
  model.value = enabled[n].key
  list.value?.querySelector<HTMLElement>(`[data-key="${enabled[n].key}"]`)?.focus()
}
</script>

<template>
  <div>
    <div
      ref="list"
      role="tablist"
      :class="['flex om-scrollbar-none overflow-x-auto', variant === 'line' ? 'gap-1 border-b border-line' : 'gap-2']"
      @keydown="onKey($event, tabs)"
    >
      <button
        v-for="t in tabs"
        :id="`${uid}-tab-${t.key}`"
        :key="t.key"
        type="button"
        role="tab"
        :data-key="t.key"
        :aria-selected="model === t.key"
        :aria-controls="`${uid}-panel`"
        :tabindex="model === t.key ? 0 : -1"
        :disabled="t.disabled"
        :class="[
          'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-semibold transition-all duration-fast disabled:opacity-40',
          full ? 'flex-1 justify-center' : '',
          variant === 'line'
            ? ['-mb-px border-b-2 px-3.5 py-2.5', model === t.key ? 'border-primary text-primary' : 'border-transparent text-ink-muted hover:text-ink']
            : ['h-9 rounded-full px-4', model === t.key ? 'bg-primary text-primary-on shadow-sm' : 'bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink']
        ]"
        @click="model = t.key"
      >
        {{ uiT(t.label) }}
        <span v-if="t.count !== undefined && t.count !== null" :class="['rounded-full px-1.5 text-2xs om-num', model === t.key ? (variant === 'pill' ? 'bg-primary-on/20 text-primary-on' : 'bg-primary-soft text-primary-soft-ink') : 'bg-surface-3 text-ink-muted']">{{ t.count }}</span>
      </button>
    </div>
    <div v-if="$slots.default" :id="`${uid}-panel`" role="tabpanel" :aria-labelledby="`${uid}-tab-${model}`" class="pt-4" tabindex="0">
      <slot :active="model" />
    </div>
  </div>
</template>
