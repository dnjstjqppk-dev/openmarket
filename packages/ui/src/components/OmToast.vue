<script setup lang="ts">
// Toast host — mount once per app (App.vue). Messages come from useToast().
import { toastState, useToast } from '../composables/useToast'
const { dismiss } = useToast()
const tone = {
  success: 'border-success/40 [&_.om-t-bar]:bg-success',
  danger: 'border-danger/40 [&_.om-t-bar]:bg-danger',
  warning: 'border-warning/40 [&_.om-t-bar]:bg-warning',
  info: 'border-info/40 [&_.om-t-bar]:bg-info'
}
</script>

<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed inset-x-0 bottom-0 z-toast flex flex-col items-center gap-2 p-4 om-safe-bottom sm:inset-x-auto sm:right-0 sm:top-0 sm:bottom-auto sm:items-end" aria-live="polite">
      <div
        v-for="t in toastState.items"
        :key="t.id"
        :role="t.tone === 'danger' ? 'alert' : 'status'"
        :class="['pointer-events-auto flex w-full max-w-sm animate-slide-up overflow-hidden rounded-md border bg-surface shadow-lg', tone[t.tone]]"
      >
        <span class="om-t-bar w-1 shrink-0" aria-hidden="true" />
        <div class="flex-1 px-4 py-3">
          <p v-if="t.title" class="text-sm font-bold text-ink">{{ t.title }}</p>
          <p class="text-sm text-ink">{{ t.message }}</p>
        </div>
        <button type="button" class="px-3 text-ink-muted hover:text-ink" aria-label="알림 닫기" @click="dismiss(t.id)">×</button>
      </div>
    </div>
  </Teleport>
</template>
