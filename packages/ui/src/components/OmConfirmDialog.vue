<script setup lang="ts">
// Renders the head of the useConfirm queue (Meridian 2.0). Danger confirmations use the danger button.
import { computed, ref } from 'vue'
import { useOverlay } from '../composables/useOverlay'
import { confirmState, useConfirm } from '../composables/useConfirm'
import { uiT } from '../composables/useUiLocale'

const { settle } = useConfirm()
const open = computed(() => confirmState.queue.length > 0)
const current = computed(() => confirmState.queue[0] ?? null)
const panel = ref<HTMLElement | null>(null)
useOverlay(open, panel, () => { if (current.value) settle(current.value.id, false) })
</script>

<template>
  <Teleport to="body">
    <div v-if="current" class="fixed inset-0 z-modal flex items-end justify-center sm:items-center sm:p-6">
      <div class="absolute inset-0 animate-fade-in bg-overlay/55 backdrop-blur-[2px]" aria-hidden="true" @click="settle(current.id, false)" />
      <div
        ref="panel"
        role="alertdialog"
        aria-modal="true"
        :aria-label="uiT(current.title)"
        data-testid="confirm-dialog"
        tabindex="-1"
        class="relative w-full max-w-sm animate-slide-up rounded-t-2xl border border-line bg-surface p-5 shadow-overlay outline-none sm:rounded-2xl sm:p-6"
      >
        <h2 class="text-lg font-bold text-ink">{{ uiT(current.title) }}</h2>
        <p v-if="current.body" class="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-muted">{{ uiT(current.body) }}</p>
        <ul v-if="current.amounts.length" class="mt-3 space-y-1 rounded-xl bg-surface-2 px-3.5 py-2.5">
          <li v-for="(a, i) in current.amounts" :key="i" class="om-num text-sm font-black text-ink">{{ a }}</li>
        </ul>
        <div class="mt-6 flex justify-end gap-2">
          <button
            type="button"
            data-testid="confirm-cancel"
            class="h-10 rounded-xl border border-line-strong px-4 text-sm font-bold text-ink transition-colors hover:bg-surface-2 active:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            @click="settle(current.id, false)"
          >
            {{ uiT(current.cancelLabel) }}
          </button>
          <button
            type="button"
            data-testid="confirm-ok"
            :class="['h-10 rounded-xl px-4 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', current.danger ? 'border border-danger bg-danger-soft text-danger hover:bg-danger-soft/70 active:bg-danger-soft/50' : 'bg-primary text-primary-on shadow-sm hover:bg-primary-hover active:bg-primary-active']"
            @click="settle(current.id, true)"
          >
            {{ uiT(current.confirmLabel) }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
