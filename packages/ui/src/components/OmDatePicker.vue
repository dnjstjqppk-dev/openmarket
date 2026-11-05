<script setup lang="ts">
// Date or date-range input on top of the native picker (correct keyboard + mobile wheels, locale aware).
// Values are 'YYYY-MM-DD' strings. Range mode guarantees from <= to and offers quick presets.
import { computed } from 'vue'
import OmField from './OmField.vue'
import { controlClasses } from './controlClasses'

const from = defineModel<string>('from', { default: '' })
const to = defineModel<string>('to', { default: '' })
const props = withDefaults(defineProps<{ label?: string; range?: boolean; min?: string; max?: string; error?: string | null; presets?: boolean; help?: string }>(), { range: false, presets: false })
const state = computed(() => (props.error ? 'error' : 'default'))
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const preset = (days: number) => { const end = new Date(); const start = new Date(); start.setDate(end.getDate() - (days - 1)); from.value = iso(start); to.value = iso(end) }
const onFrom = (v: string) => { from.value = v; if (props.range && to.value && v > to.value) to.value = v }
const onTo = (v: string) => { to.value = v; if (from.value && v < from.value) from.value = v }
</script>

<template>
  <OmField :label="label" :error="error" :help="help">
    <template #default="{ id, describedBy, invalid }">
      <div class="flex flex-wrap items-center gap-2">
        <input :id="id" type="date" :value="from" :min="min" :max="range ? to || max : max" :aria-invalid="invalid || undefined" :aria-describedby="describedBy" :aria-label="range ? '시작일' : undefined" :class="controlClasses(state, 'md', 'w-auto min-w-[9.5rem]')" @input="onFrom(($event.target as HTMLInputElement).value)" />
        <template v-if="range">
          <span class="text-ink-subtle" aria-hidden="true">~</span>
          <input type="date" :value="to" :min="from || min" :max="max" aria-label="종료일" :class="controlClasses(state, 'md', 'w-auto min-w-[9.5rem]')" @input="onTo(($event.target as HTMLInputElement).value)" />
        </template>
        <div v-if="range && presets" class="flex gap-1">
          <button v-for="d in [7, 30, 90]" :key="d" type="button" class="h-8 rounded-full bg-surface-2 px-3 text-xs font-semibold text-ink-muted hover:text-ink" @click="preset(d)">최근 {{ d }}일</button>
        </div>
      </div>
    </template>
  </OmField>
</template>
