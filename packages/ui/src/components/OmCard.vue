<script setup lang="ts">
// Surface container. `interactive` adds hover elevation for clickable cards; header/footer slots optional.
withDefaults(defineProps<{ title?: string; subtitle?: string; padding?: 'none' | 'sm' | 'md' | 'lg'; interactive?: boolean; as?: string }>(), { padding: 'md', interactive: false, as: 'section' })
</script>

<template>
  <component
    :is="as"
    :class="[
      'rounded-lg border border-line bg-surface',
      interactive ? 'transition-shadow duration ease-om hover:shadow-md focus-within:shadow-md' : ''
    ]"
  >
    <header v-if="title || $slots.header || $slots.actions" class="flex items-start justify-between gap-3 border-b border-line-divider px-5 py-4">
      <slot name="header">
        <div class="min-w-0">
          <h3 class="truncate text-md font-bold text-ink">{{ title }}</h3>
          <p v-if="subtitle" class="mt-0.5 text-xs text-ink-muted">{{ subtitle }}</p>
        </div>
      </slot>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2"><slot name="actions" /></div>
    </header>
    <div :class="{ none: '', sm: 'p-3', md: 'p-5', lg: 'p-6 sm:p-8' }[padding]"><slot /></div>
    <footer v-if="$slots.footer" class="border-t border-line-divider px-5 py-3"><slot name="footer" /></footer>
  </component>
</template>
