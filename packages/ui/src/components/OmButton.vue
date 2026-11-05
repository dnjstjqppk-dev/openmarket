<script setup lang="ts">
// Button: primary | secondary | outline | ghost | danger | accent; sizes sm | md | lg.
// `loading` keeps the width, disables the button and announces the busy state.
import { computed } from 'vue'
import OmSpinner from './OmSpinner.vue'

const props = withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'accent' | 'soft'
  size?: 'sm' | 'md' | 'lg'
  type?: 'button' | 'submit' | 'reset'
  loading?: boolean
  disabled?: boolean
  block?: boolean
  to?: string
  href?: string
}>(), { variant: 'primary', size: 'md', type: 'button', loading: false, disabled: false, block: false })

const tag = computed(() => (props.to ? 'RouterLink' : props.href ? 'a' : 'button'))
const classes = computed(() => [
  'relative inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold select-none',
  'transition-colors duration-fast ease-om focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
  'disabled:cursor-not-allowed aria-disabled:cursor-not-allowed',
  props.block ? 'w-full' : '',
  { sm: 'h-8 px-3 text-sm rounded-sm', md: 'h-10 px-4 text-md rounded', lg: 'h-12 px-6 text-lg rounded-md' }[props.size],
  {
    primary: 'bg-primary text-primary-on hover:bg-primary-hover active:bg-primary-active disabled:bg-surface-3 disabled:text-ink-subtle',
    secondary: 'bg-secondary text-secondary-on hover:bg-secondary-hover disabled:bg-surface-3 disabled:text-ink-subtle',
    outline: 'border border-line-strong bg-surface text-ink hover:bg-surface-2 active:bg-surface-3 disabled:text-ink-subtle',
    ghost: 'text-ink hover:bg-surface-2 active:bg-surface-3 disabled:text-ink-subtle',
    danger: 'bg-danger text-white hover:opacity-90 active:opacity-80 disabled:bg-surface-3 disabled:text-ink-subtle',
    accent: 'bg-accent text-white hover:opacity-90 active:opacity-80 disabled:bg-surface-3 disabled:text-ink-subtle',
    soft: 'bg-primary-soft text-primary-soft-ink hover:bg-lagoon-100 disabled:text-ink-subtle'
  }[props.variant]
])
</script>

<template>
  <component
    :is="tag"
    :to="to"
    :href="href"
    :type="tag === 'button' ? type : undefined"
    :disabled="tag === 'button' ? disabled || loading : undefined"
    :aria-disabled="disabled || loading || undefined"
    :aria-busy="loading || undefined"
    :class="classes"
  >
    <span v-if="loading" class="absolute inset-0 flex items-center justify-center"><OmSpinner :size="size === 'sm' ? 14 : 18" /></span>
    <span :class="['inline-flex items-center gap-2', loading ? 'invisible' : '']"><slot /></span>
  </component>
</template>
