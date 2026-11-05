<script setup lang="ts">
// Anchored floating panel. Trigger slot receives { open, toggle, attrs }; content is any slot content.
import { ref, useId } from 'vue'
import { useClickOutside } from '../composables/useClickOutside'

const open = defineModel<boolean>('open', { default: false })
withDefaults(defineProps<{ placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'; width?: string; role?: 'dialog' | 'menu' | 'listbox' | 'tree' | 'grid' }>(), { placement: 'bottom-start', width: 'w-72', role: 'dialog' })
const root = ref<HTMLElement | null>(null)
const id = `om-pop-${useId()}`
const toggle = () => { open.value = !open.value }
useClickOutside([root], () => { open.value = false })
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open.value) { open.value = false; e.stopPropagation() } }
</script>

<template>
  <div ref="root" class="relative inline-flex" @keydown="onKey">
    <slot name="trigger" :open="open" :toggle="toggle" :attrs="{ 'aria-expanded': open, 'aria-controls': id, 'aria-haspopup': role }" />
    <div
      v-if="open"
      :id="id"
      :role="role"
      :class="[
        'absolute z-dropdown animate-fade-in rounded-md border border-line bg-surface p-2 shadow-lg',
        width,
        { 'bottom-start': 'left-0 top-full mt-2', 'bottom-end': 'right-0 top-full mt-2', 'top-start': 'bottom-full left-0 mb-2', 'top-end': 'bottom-full right-0 mb-2' }[placement]
      ]"
    >
      <slot :close="() => (open = false)" />
    </div>
  </div>
</template>
