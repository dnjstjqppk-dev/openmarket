<script setup lang="ts">
const model = defineModel<boolean | any[]>({ default: false })
withDefaults(defineProps<{ label?: string; description?: string; value?: any; disabled?: boolean; error?: boolean; indeterminate?: boolean }>(), { disabled: false, error: false, indeterminate: false })
</script>

<template>
  <label :class="['group inline-flex items-start gap-2.5 select-none', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer']">
    <span class="relative mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center">
      <input
        v-model="model"
        type="checkbox"
        :value="value"
        :disabled="disabled"
        :indeterminate.prop="indeterminate"
        :aria-invalid="error || undefined"
        :class="[
          'peer h-[18px] w-[18px] appearance-none rounded-xs border bg-surface transition-colors duration-fast',
          'checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          error ? 'border-danger' : 'border-line-strong group-hover:border-ink-subtle'
        ]"
      />
      <svg class="pointer-events-none absolute hidden text-primary-on peer-checked:block" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" aria-hidden="true"><path d="M5 12.5 10 17 19 7" /></svg>
      <span class="pointer-events-none absolute hidden h-0.5 w-2.5 rounded bg-primary-on peer-indeterminate:block" aria-hidden="true" />
    </span>
    <span v-if="label || $slots.default" class="flex flex-col">
      <span class="text-md text-ink"><slot>{{ label }}</slot></span>
      <span v-if="description" class="text-xs text-ink-muted">{{ description }}</span>
    </span>
  </label>
</template>
