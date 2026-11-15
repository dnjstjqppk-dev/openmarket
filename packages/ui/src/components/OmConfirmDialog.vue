<script setup lang="ts">
// Renders the head of the useConfirm queue. Danger confirmations use the red button.
import { computed, ref } from 'vue'
import { useOverlay } from '../composables/useOverlay'
import { confirmState, useConfirm } from '../composables/useConfirm'

const { settle } = useConfirm()
const open = computed(() => confirmState.queue.length > 0)
const current = computed(() => confirmState.queue[0] ?? null)
const panel = ref<HTMLElement | null>(null)
useOverlay(open, panel, () => { if (current.value) settle(current.value.id, false) })
</script>

<template>
  <Teleport to="body">
    <div v-if="current" class="fixed inset-0 z-modal flex items-end justify-center sm:items-center sm:p-6">
      <div class="absolute inset-0 animate-fade-in bg-overlay/50" aria-hidden="true" @click="settle(current.id, false)" />
      <div
        ref="panel"
        role="alertdialog"
        aria-modal="true"
        :aria-label="current.title"
        data-testid="confirm-dialog"
        tabindex="-1"
        class="relative w-full max-w-sm animate-slide-up rounded-t-xl bg-surface p-5 shadow-overlay outline-none sm:rounded-lg sm:p-6"
      >
        <h2 class="text-md font-bold text-ink">{{ current.title }}</h2>
        <p v-if="current.body" class="mt-2 whitespace-pre-line text-sm text-ink-muted">{{ current.body }}</p>
        <ul v-if="current.amounts.length" class="mt-2 space-y-0.5">
          <li v-for="(a, i) in current.amounts" :key="i" class="om-num text-sm font-black text-ink">{{ a }}</li>
        </ul>
        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            data-testid="confirm-cancel"
            class="h-10 rounded-lg border border-line px-4 text-sm font-bold transition-colors hover:bg-surface-2 active:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            @click="settle(current.id, false)"
          >
            {{ current.cancelLabel }}
          </button>
          <button
            type="button"
            data-testid="confirm-ok"
            :class="['h-10 rounded-lg px-4 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', current.danger ? 'border border-danger bg-danger-soft text-danger hover:bg-danger-soft/70 active:bg-danger-soft/50' : 'bg-secondary text-secondary-on hover:bg-secondary-hover active:bg-secondary-active']"
            @click="settle(current.id, true)"
          >
            {{ current.confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
