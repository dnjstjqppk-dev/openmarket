<script setup lang="ts">
// Dialog. On phones it becomes a bottom sheet. `danger` styles destructive confirmations;
// `persistent` blocks backdrop / Escape dismissal while a request is running.
import { ref, toRef, useId } from 'vue'
import { useOverlay } from '../composables/useOverlay'

const open = defineModel<boolean>('open', { default: false })
const props = withDefaults(defineProps<{
  title?: string
  description?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  persistent?: boolean
  hideClose?: boolean
}>(), { size: 'md', persistent: false, hideClose: false })
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)
const titleId = `om-modal-${useId()}`
const close = () => { if (props.persistent) return; open.value = false; emit('close') }
useOverlay(toRef(open), panel, close, { dismissible: () => !props.persistent })
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-modal flex items-end justify-center sm:items-center sm:p-6">
      <div class="absolute inset-0 animate-fade-in bg-overlay/50 backdrop-blur-[2px]" aria-hidden="true" @click="close" />
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="title ? titleId : undefined"
        tabindex="-1"
        :class="[
          'relative flex max-h-[92dvh] w-full animate-slide-up flex-col overflow-hidden bg-surface shadow-overlay outline-none',
          'rounded-t-xl sm:rounded-lg',
          { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size]
        ]"
      >
        <div class="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden="true" />
        <header v-if="title || !hideClose" class="flex items-start justify-between gap-4 px-5 pb-2 pt-4 sm:px-6 sm:pt-5">
          <div>
            <h2 v-if="title" :id="titleId" class="text-lg font-bold text-ink">{{ title }}</h2>
            <p v-if="description" class="mt-1 text-sm text-ink-muted">{{ description }}</p>
          </div>
          <button v-if="!hideClose" type="button" class="-mr-2 -mt-1 flex h-9 w-9 items-center justify-center rounded text-ink-muted hover:bg-surface-2" aria-label="닫기" :disabled="persistent" @click="close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>
        <div class="flex-1 overflow-y-auto px-5 py-3 sm:px-6"><slot /></div>
        <footer v-if="$slots.footer" class="flex flex-col-reverse gap-2 border-t border-line-divider px-5 py-4 sm:flex-row sm:justify-end sm:px-6 om-safe-bottom">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
