<script setup lang="ts">
// Action menu with full keyboard support (Arrow/Home/End/Enter/Escape). Items: { key, label, danger?, disabled?, divider? }.
import { ref, nextTick } from 'vue'
import OmPopover from './OmPopover.vue'

export interface DropdownItem { key: string; label: string; danger?: boolean; disabled?: boolean; divider?: boolean; hint?: string }
withDefaults(defineProps<{ items: DropdownItem[]; label?: string; placement?: 'bottom-start' | 'bottom-end' }>(), { label: '메뉴', placement: 'bottom-end' })
const emit = defineEmits<{ select: [key: string] }>()
const open = ref(false)
const list = ref<HTMLElement | null>(null)

const focusItem = (idx: number) => {
  const els = list.value ? Array.from(list.value.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')) : []
  if (!els.length) return
  els[(idx + els.length) % els.length].focus()
}
const onOpen = async (toggle: () => void) => { toggle(); await nextTick(); if (open.value) focusItem(0) }
const onKey = (e: KeyboardEvent) => {
  const els = list.value ? Array.from(list.value.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')) : []
  const i = els.indexOf(document.activeElement as HTMLElement)
  if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(i + 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(i - 1) }
  else if (e.key === 'Home') { e.preventDefault(); focusItem(0) }
  else if (e.key === 'End') { e.preventDefault(); focusItem(els.length - 1) }
}
const choose = (it: DropdownItem) => { if (it.disabled) return; open.value = false; emit('select', it.key) }
</script>

<template>
  <OmPopover v-model:open="open" :placement="placement" width="min-w-[12rem]" role="menu">
    <template #trigger="{ toggle, attrs }">
      <slot name="trigger" :toggle="() => onOpen(toggle)" :attrs="attrs">
        <button type="button" v-bind="attrs" class="inline-flex h-9 items-center gap-1 rounded px-3 text-sm font-semibold hover:bg-surface-2" @click="onOpen(toggle)">{{ label }} ▾</button>
      </slot>
    </template>
    <ul ref="list" class="flex flex-col" @keydown="onKey">
      <template v-for="it in items" :key="it.key">
        <li v-if="it.divider" class="my-1 h-px bg-line-divider" role="separator" />
        <li v-else>
          <button
            type="button"
            role="menuitem"
            :aria-disabled="it.disabled || undefined"
            :class="[
              'flex w-full items-center justify-between gap-6 rounded-sm px-3 py-2 text-left text-sm focus:bg-surface-2 focus:outline-none',
              it.disabled ? 'cursor-not-allowed text-ink-subtle' : it.danger ? 'text-danger hover:bg-danger-soft' : 'text-ink hover:bg-surface-2'
            ]"
            @click="choose(it)"
          >
            <span>{{ it.label }}</span><span v-if="it.hint" class="text-2xs text-ink-subtle">{{ it.hint }}</span>
          </button>
        </li>
      </template>
    </ul>
  </OmPopover>
</template>
