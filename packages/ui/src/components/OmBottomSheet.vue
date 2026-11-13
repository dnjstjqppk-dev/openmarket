<script setup lang="ts">
// Mobile bottom sheet: drag handle to close, backdrop dismiss, focus trapped,
// iPhone bottom inset respected. Rendered inline (no Teleport) so callers can
// place it anywhere; open state drives visibility.
import { ref, toRef } from 'vue'
import { useOverlay } from '../composables/useOverlay'

const open = defineModel<boolean>({ default: false })
withDefaults(defineProps<{ title?: string; labelledby?: string }>(), { title: '' })
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)
const close = () => { open.value = false; emit('close') }
useOverlay(toRef(open), panel, close)
let dragY: number | null = null
const onTouchStart = (e: TouchEvent) => { dragY = e.touches[0]?.clientY ?? null }
const onTouchEnd = (e: TouchEvent) => {
  if (dragY === null) return
  const dy = (e.changedTouches[0]?.clientY ?? dragY) - dragY
  if (dy > 90) close()
  dragY = null
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-modal flex items-end justify-center sm:items-center sm:p-6">
      <div class="absolute inset-0 animate-fade-in bg-overlay/50" aria-hidden="true" @click="close" />
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        class="relative flex max-h-[92dvh] w-full animate-slide-up flex-col overflow-hidden rounded-t-xl bg-surface shadow-overlay outline-none sm:max-w-lg sm:rounded-lg"
        @touchstart="onTouchStart"
        @touchend="onTouchEnd"
      >
        <div class="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong" aria-hidden="true" />
        <header v-if="title" class="border-b border-line-divider px-5 py-3">
          <h2 class="text-md font-bold text-ink">{{ title }}</h2>
        </header>
        <div class="flex-1 overflow-y-auto px-5 py-4"><slot /></div>
        <div v-if="$slots.footer" class="border-t border-line-divider px-5 py-3 om-safe-bottom"><slot name="footer" /></div>
      </div>
    </div>
  </Teleport>
</template>
