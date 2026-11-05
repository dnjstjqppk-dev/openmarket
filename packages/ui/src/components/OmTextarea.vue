<script setup lang="ts">
import { computed } from 'vue'
import OmField from './OmField.vue'
import { controlClasses } from './controlClasses'

defineOptions({ inheritAttrs: false })
const model = defineModel<string>({ default: '' })
const props = withDefaults(defineProps<{
  label?: string
  help?: string
  error?: string | null
  success?: string | null
  required?: boolean
  rows?: number
  maxlength?: number
  id?: string
}>(), { rows: 4 })
const state = computed(() => (props.error ? 'error' : props.success ? 'success' : 'default'))
</script>

<template>
  <OmField :label="label" :help="help" :error="error" :success="success" :required="required" :id="id">
    <template #default="{ id: fid, describedBy, invalid }">
      <textarea
        :id="fid"
        v-model="model"
        v-bind="$attrs"
        :rows="rows"
        :maxlength="maxlength"
        :required="required"
        :aria-invalid="invalid || undefined"
        :aria-describedby="describedBy"
        :class="controlClasses(state, 'md', '!h-auto py-2 leading-relaxed resize-y')"
      />
      <span v-if="maxlength" class="self-end text-2xs text-ink-subtle om-num">{{ (model || '').length }} / {{ maxlength }}</span>
    </template>
  </OmField>
</template>
