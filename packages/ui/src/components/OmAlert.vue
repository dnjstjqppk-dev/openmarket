<script setup lang="ts">
// Inline message. danger/warning are announced (role="alert"); info/success are polite (role="status").
import { computed } from 'vue'
const props = withDefaults(defineProps<{ tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral'; title?: string; dismissible?: boolean }>(), { tone: 'info', dismissible: false })
const emit = defineEmits<{ dismiss: [] }>()
const icon = computed(() => ({
  info: 'M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  success: 'm9 12 2 2 4-4m7 2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  warning: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  danger: 'M12 8v4m0 4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  neutral: 'M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'
}[props.tone]))
</script>

<template>
  <div
    :role="tone === 'danger' || tone === 'warning' ? 'alert' : 'status'"
    :class="[
      'flex gap-3 rounded-md border p-4 text-sm',
      { info: 'border-info/30 bg-info-soft', success: 'border-success/30 bg-success-soft', warning: 'border-warning/30 bg-warning-soft', danger: 'border-danger/30 bg-danger-soft', neutral: 'border-line bg-surface-2' }[tone]
    ]"
  >
    <svg :class="['mt-0.5 shrink-0', { info: 'text-info', success: 'text-success', warning: 'text-warning', danger: 'text-danger', neutral: 'text-ink-muted' }[tone]]" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="icon" /></svg>
    <div class="min-w-0 flex-1 text-ink">
      <p v-if="title" class="font-bold">{{ title }}</p>
      <div :class="title ? 'mt-1 text-ink-muted' : ''"><slot /></div>
      <div v-if="$slots.actions" class="mt-3 flex flex-wrap gap-2"><slot name="actions" /></div>
    </div>
    <button v-if="dismissible" type="button" class="-m-1 h-7 w-7 shrink-0 rounded text-ink-muted hover:bg-black/5" aria-label="알림 닫기" @click="emit('dismiss')">×</button>
  </div>
</template>
