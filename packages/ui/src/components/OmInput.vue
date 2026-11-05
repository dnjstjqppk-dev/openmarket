<script setup lang="ts">
// Text input with optional label/help/error (via OmField), prefix/suffix slots and a clear button.
import { computed } from 'vue'
import OmField from './OmField.vue'
import { controlClasses, type ControlSize } from './controlClasses'

defineOptions({ inheritAttrs: false })
const model = defineModel<string | number | null>({ default: '' })
const props = withDefaults(defineProps<{
  label?: string
  help?: string
  error?: string | null
  success?: string | null
  required?: boolean
  size?: ControlSize
  type?: string
  clearable?: boolean
  id?: string
}>(), { size: 'md', type: 'text', clearable: false })
const state = computed(() => (props.error ? 'error' : props.success ? 'success' : 'default'))
</script>

<template>
  <OmField :label="label" :help="help" :error="error" :success="success" :required="required" :id="id">
    <template #default="{ id: fid, describedBy, invalid }">
      <div class="relative flex items-center">
        <span v-if="$slots.prefix" class="pointer-events-none absolute left-3 flex items-center text-ink-muted"><slot name="prefix" /></span>
        <input
          :id="fid"
          v-model="model"
          v-bind="$attrs"
          :type="type"
          :required="required"
          :aria-invalid="invalid || undefined"
          :aria-describedby="describedBy"
          :class="controlClasses(state, size, [$slots.prefix ? 'pl-9' : '', $slots.suffix || clearable ? 'pr-9' : ''].join(' '))"
        />
        <button
          v-if="clearable && model !== '' && model !== null"
          type="button"
          class="absolute right-2 flex h-6 w-6 items-center justify-center rounded-full text-ink-muted hover:bg-surface-3"
          aria-label="입력 지우기"
          @click="model = ''"
        >×</button>
        <span v-else-if="$slots.suffix" class="absolute right-3 flex items-center text-ink-muted"><slot name="suffix" /></span>
      </div>
    </template>
  </OmField>
</template>
