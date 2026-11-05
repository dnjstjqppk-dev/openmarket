<script setup lang="ts">
// Hover / focus hint. Keep content short; it is linked with aria-describedby.
import { ref, useId } from 'vue'
withDefaults(defineProps<{ text: string; placement?: 'top' | 'bottom' }>(), { placement: 'top' })
const show = ref(false)
const id = `om-tip-${useId()}`
let t: ReturnType<typeof setTimeout> | null = null
const on = () => { if (t) clearTimeout(t); t = setTimeout(() => (show.value = true), 250) }
const off = () => { if (t) clearTimeout(t); show.value = false }
</script>

<template>
  <span class="relative inline-flex" :aria-describedby="show ? id : undefined" @mouseenter="on" @mouseleave="off" @focusin="on" @focusout="off" @keydown.esc="off">
    <slot />
    <span
      v-if="show"
      :id="id"
      role="tooltip"
      :class="['pointer-events-none absolute left-1/2 z-tooltip w-max max-w-[240px] -translate-x-1/2 animate-fade-in rounded-sm bg-secondary px-2.5 py-1.5 text-xs font-medium text-secondary-on shadow-md', placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2']"
    >{{ text }}</span>
  </span>
</template>
