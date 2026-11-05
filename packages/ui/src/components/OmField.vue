<script setup lang="ts">
// Label + control + help / error / success message. Controls receive the generated id through the slot.
import { computed, useId } from 'vue'

const props = defineProps<{
  label?: string
  help?: string
  error?: string | null
  success?: string | null
  required?: boolean
  id?: string
}>()
const autoId = useId()
const fieldId = computed(() => props.id || `om-f-${autoId}`)
const describedBy = computed(() => (props.error || props.success || props.help ? `${fieldId.value}-msg` : undefined))
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" :for="fieldId" class="text-sm font-semibold text-ink">
      {{ label }}<span v-if="required" class="ml-0.5 text-danger" aria-hidden="true">*</span>
    </label>
    <slot :id="fieldId" :described-by="describedBy" :invalid="!!error" />
    <p v-if="error" :id="`${fieldId}-msg`" class="text-xs font-medium text-danger" role="alert">{{ error }}</p>
    <p v-else-if="success" :id="`${fieldId}-msg`" class="text-xs font-medium text-success">{{ success }}</p>
    <p v-else-if="help" :id="`${fieldId}-msg`" class="text-xs text-ink-muted">{{ help }}</p>
  </div>
</template>
