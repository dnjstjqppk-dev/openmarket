<script setup lang="ts">
// Failed load. Shows the server's message (never a fake success) and a retry action.
import OmButton from './OmButton.vue'
withDefaults(defineProps<{ title?: string; message?: string | null; code?: string | null; retrying?: boolean; compact?: boolean }>(), { title: '불러오지 못했습니다', retrying: false, compact: false })
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div :class="['flex flex-col items-center text-center', compact ? 'gap-2 py-8' : 'gap-3 py-16']" role="alert">
    <div class="flex h-14 w-14 items-center justify-center rounded-full bg-danger-soft text-danger">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 8v4m0 4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z" /></svg>
    </div>
    <p class="text-lg font-bold text-ink">{{ title }}</p>
    <p v-if="message" class="max-w-md text-sm text-ink-muted">{{ message }}</p>
    <p v-if="code" class="font-mono text-2xs text-ink-subtle">{{ code }}</p>
    <OmButton variant="outline" size="sm" :loading="retrying" @click="emit('retry')">다시 시도</OmButton>
  </div>
</template>
