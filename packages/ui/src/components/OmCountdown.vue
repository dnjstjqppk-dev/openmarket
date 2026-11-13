<script setup lang="ts">
// Live countdown from a real end time. Ticks every second, hides on expiry.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { countdownParts } from '../commerce'

const props = defineProps<{ endsAt: number | string | Date }>()
const endMs = computed(() => {
  const v = props.endsAt
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v
  return new Date(v).getTime()
})
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
const parts = computed(() => countdownParts(endMs.value, now.value))
const pad = (n: number) => String(n).padStart(2, '0')
</script>

<template>
  <span v-if="!parts.expired" class="om-num inline-flex items-center gap-1 text-sm font-bold text-urgent" role="timer">
    <template v-if="parts.d > 0">{{ parts.d }}일 </template>{{ pad(parts.h) }}:{{ pad(parts.m) }}:{{ pad(parts.s) }}
  </span>
</template>
