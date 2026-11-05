<script setup lang="ts">
// Status label. Tones map to semantic tokens; `dot` adds a leading status dot (used in tables).
withDefaults(defineProps<{
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'highlight'
  size?: 'sm' | 'md'
  dot?: boolean
  solid?: boolean
}>(), { tone: 'neutral', size: 'sm', dot: false, solid: false })
</script>

<template>
  <span
    :class="[
      'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold',
      size === 'sm' ? 'h-5 px-2 text-2xs' : 'h-6 px-2.5 text-xs',
      solid
        ? { neutral: 'bg-secondary text-secondary-on', primary: 'bg-primary text-primary-on', success: 'bg-success text-white', warning: 'bg-warning text-white', danger: 'bg-danger text-white', info: 'bg-info text-white', accent: 'bg-accent text-white', highlight: 'bg-highlight text-stone-900' }[tone]
        : { neutral: 'bg-surface-3 text-ink-muted', primary: 'bg-primary-soft text-primary-soft-ink', success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger', info: 'bg-info-soft text-info', accent: 'bg-accent-soft text-accent', highlight: 'bg-highlight-soft text-highlight-ink' }[tone]
    ]"
  >
    <span v-if="dot" class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
    <slot />
  </span>
</template>
