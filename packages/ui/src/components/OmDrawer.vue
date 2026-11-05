<script setup lang="ts">
// Side panel: detail views in the consoles (right) and the mobile navigation (left).
import { ref, toRef, useId } from 'vue'
import { useOverlay } from '../composables/useOverlay'

const open = defineModel<boolean>('open', { default: false })
const props = withDefaults(defineProps<{ title?: string; side?: 'left' | 'right'; width?: 'sm' | 'md' | 'lg' | 'xl'; persistent?: boolean }>(), { side: 'right', width: 'md', persistent: false })
const panel = ref<HTMLElement | null>(null)
const titleId = `om-drawer-${useId()}`
const close = () => { if (!props.persistent) open.value = false }
useOverlay(toRef(open), panel, close, { dismissible: () => !props.persistent })
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-drawer">
      <div class="absolute inset-0 animate-fade-in bg-overlay/40" aria-hidden="true" @click="close" />
      <aside
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="title ? titleId : undefined"
        tabindex="-1"
        :class="[
          'absolute inset-y-0 flex w-full flex-col bg-surface shadow-overlay outline-none',
          side === 'right' ? 'right-0 animate-slide-in-right' : 'left-0 animate-slide-in-left',
          { sm: 'max-w-xs', md: 'max-w-md', lg: 'max-w-xl', xl: 'max-w-3xl' }[width]
        ]"
      >
        <header class="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line-divider px-5">
          <h2 v-if="title" :id="titleId" class="truncate text-lg font-bold">{{ title }}</h2>
          <slot name="header" />
          <button type="button" class="-mr-2 flex h-9 w-9 items-center justify-center rounded text-ink-muted hover:bg-surface-2" aria-label="닫기" @click="close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>
        <div class="flex-1 overflow-y-auto p-5"><slot /></div>
        <footer v-if="$slots.footer" class="flex gap-2 border-t border-line-divider p-4 om-safe-bottom"><slot name="footer" /></footer>
      </aside>
    </div>
  </Teleport>
</template>
