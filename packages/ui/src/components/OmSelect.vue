<script setup lang="ts">
// Native <select> (best on mobile) styled as an OLMOA control.
import { computed } from 'vue'
import OmField from './OmField.vue'
import { controlClasses, type ControlSize } from './controlClasses'

export interface SelectOption { value: string | number; label: string; disabled?: boolean }
defineOptions({ inheritAttrs: false })
const model = defineModel<string | number | null>({ default: '' })
const props = withDefaults(defineProps<{
  options: SelectOption[]
  label?: string
  help?: string
  error?: string | null
  placeholder?: string
  required?: boolean
  size?: ControlSize
  id?: string
}>(), { size: 'md' })
const state = computed(() => (props.error ? 'error' : 'default'))
</script>

<template>
  <OmField :label="label" :help="help" :error="error" :required="required" :id="id">
    <template #default="{ id: fid, describedBy, invalid }">
      <div class="relative">
        <select
          :id="fid"
          v-model="model"
          v-bind="$attrs"
          :required="required"
          :aria-invalid="invalid || undefined"
          :aria-describedby="describedBy"
          :class="controlClasses(state, size, 'appearance-none pr-9 cursor-pointer')"
        >
          <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
          <option v-for="o in options" :key="o.value" :value="o.value" :disabled="o.disabled">{{ o.label }}</option>
        </select>
        <svg class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </div>
    </template>
  </OmField>
</template>
