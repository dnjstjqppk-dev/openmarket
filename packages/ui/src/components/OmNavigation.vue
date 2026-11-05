<script setup lang="ts">
// Link navigation in two shapes:
//   bar    — horizontal, scrollable (buyer category bar, console page tabs)
//   bottom — fixed mobile tab bar with icons (buyer app, hidden from md)
import type { Component } from 'vue'
export interface NavItem { to: string; label: string; icon?: Component; badge?: number | null; exact?: boolean }
withDefaults(defineProps<{ items: NavItem[]; variant?: 'bar' | 'bottom'; label?: string }>(), { variant: 'bar', label: '주요 메뉴' })
</script>

<template>
  <nav v-if="variant === 'bar'" :aria-label="label" class="om-scrollbar-none overflow-x-auto">
    <ul class="flex items-center gap-1">
      <li v-for="it in items" :key="it.to" class="shrink-0">
        <RouterLink
          :to="it.to"
          :exact-active-class="it.exact ? '!text-ink !border-primary' : ''"
          :active-class="it.exact ? '' : '!text-ink !border-primary'"
          class="inline-flex h-11 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-semibold text-ink-muted hover:text-ink"
        >
          <component :is="it.icon" v-if="it.icon" :size="16" aria-hidden="true" />{{ it.label }}
        </RouterLink>
      </li>
    </ul>
  </nav>
  <nav v-else :aria-label="label" class="fixed inset-x-0 bottom-0 z-sticky border-t border-line bg-surface/95 backdrop-blur om-safe-bottom md:hidden">
    <ul class="grid" :style="{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }">
      <li v-for="it in items" :key="it.to">
        <RouterLink
          :to="it.to"
          :exact-active-class="it.exact ? '!text-primary' : ''"
          :active-class="it.exact ? '' : '!text-primary'"
          class="relative flex h-14 flex-col items-center justify-center gap-0.5 text-2xs font-semibold text-ink-muted"
        >
          <component :is="it.icon" v-if="it.icon" :size="22" :stroke-width="1.8" aria-hidden="true" />
          <span>{{ it.label }}</span>
          <span v-if="it.badge" class="absolute left-1/2 top-1.5 ml-2 min-w-[16px] rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4 text-white om-num">{{ it.badge > 99 ? '99+' : it.badge }}</span>
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
