<script setup lang="ts">
// Square icon-only button. `label` is required: it becomes aria-label and the tooltip text.
import OmSpinner from './OmSpinner.vue'

withDefaults(defineProps<{
  label: string
  variant?: 'ghost' | 'outline' | 'primary' | 'soft'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  disabled?: boolean
  badge?: number | string | null
}>(), { variant: 'ghost', size: 'md', loading: false, disabled: false, badge: null })
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    :title="label"
    :disabled="disabled || loading"
    :class="[
      'relative inline-flex shrink-0 items-center justify-center rounded transition-colors duration-fast ease-om',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50',
      { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-12 w-12' }[size],
      {
        ghost: 'text-ink hover:bg-surface-2 active:bg-surface-3',
        outline: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
        primary: 'bg-primary text-primary-on hover:bg-primary-hover',
        soft: 'bg-primary-soft text-primary-soft-ink hover:bg-lagoon-100'
      }[variant]
    ]"
  >
    <OmSpinner v-if="loading" :size="16" />
    <slot v-else />
    <span
      v-if="badge !== null && badge !== 0 && badge !== ''"
      class="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-accent px-1 text-center text-2xs font-bold leading-[18px] text-white om-num"
      aria-hidden="true"
    >{{ typeof badge === 'number' && badge > 99 ? '99+' : badge }}</span>
  </button>
</template>
