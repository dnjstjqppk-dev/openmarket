<script setup lang="ts">
// Radio group. options: [{ value, label, description?, disabled? }]; `card` renders selectable cards.
export interface RadioOption { value: string | number; label: string; description?: string; disabled?: boolean }
const model = defineModel<string | number | null>({ default: null })
withDefaults(defineProps<{ options: RadioOption[]; name: string; legend?: string; card?: boolean; inline?: boolean; error?: string | null }>(), { card: false, inline: false })
</script>

<template>
  <fieldset class="flex flex-col gap-2">
    <legend v-if="legend" class="mb-1 text-sm font-semibold text-ink">{{ legend }}</legend>
    <div :class="['gap-2', inline ? 'flex flex-wrap' : card ? 'grid grid-cols-1 sm:grid-cols-2' : 'flex flex-col']">
      <label
        v-for="o in options"
        :key="o.value"
        :class="[
          'group flex items-start gap-2.5 select-none',
          o.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          card ? 'rounded border p-3 transition-colors duration-fast has-[:checked]:border-primary has-[:checked]:bg-primary-soft hover:border-ink-subtle' : '',
          card && !(model === o.value) ? 'border-line' : ''
        ]"
      >
        <input
          v-model="model"
          type="radio"
          :name="name"
          :value="o.value"
          :disabled="o.disabled"
          :class="[
            'mt-0.5 h-[18px] w-[18px] shrink-0 appearance-none rounded-full border bg-surface transition-all duration-fast',
            'checked:border-[5px] checked:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            error ? 'border-danger' : 'border-line-strong group-hover:border-ink-subtle'
          ]"
        />
        <span class="flex flex-col">
          <span class="text-md text-ink">{{ o.label }}</span>
          <span v-if="o.description" class="text-xs text-ink-muted">{{ o.description }}</span>
        </span>
      </label>
    </div>
    <p v-if="error" class="text-xs font-medium text-danger" role="alert">{{ error }}</p>
  </fieldset>
</template>
