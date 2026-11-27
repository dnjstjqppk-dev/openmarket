<script setup lang="ts">
// Link navigation (Meridian 2.0) in two shapes:
//   bar    — horizontal scrollable pill-accent nav bar
//   bottom — frosted glass mobile tab bar with icons
import type { Component } from 'vue'
import { uiT } from '../composables/useUiLocale'

export interface NavItem { to: string; label: string; icon?: Component; badge?: number | null; exact?: boolean }
withDefaults(defineProps<{ items: NavItem[]; variant?: 'bar' | 'bottom'; label?: string }>(), { variant: 'bar', label: '주요 메뉴' })
</script>

<template>
  <nav v-if="variant === 'bar'" :aria-label="uiT(label)" class="om-scrollbar-none overflow-x-auto">
    <ul class="flex items-center gap-1 py-1.5">
      <li v-for="it in items" :key="it.to" class="shrink-0">
        <RouterLink
          :to="it.to"
          :exact-active-class="it.exact ? '!bg-primary-soft !text-primary-soft-ink' : ''"
          :active-class="it.exact ? '' : '!bg-primary-soft !text-primary-soft-ink'"
          class="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold text-ink-muted transition-colors duration-fast hover:bg-surface-2 hover:text-ink"
        >
          <component :is="it.icon" v-if="it.icon" :size="15" aria-hidden="true" />{{ uiT(it.label) }}
        </RouterLink>
      </li>
    </ul>
  </nav>
  <nav v-else :aria-label="uiT(label)" class="fixed inset-x-0 bottom-0 z-sticky border-t border-line bg-surface/95 shadow-lg backdrop-blur-md om-safe-bottom md:hidden">
    <ul class="grid" :style="{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }">
      <li v-for="it in items" :key="it.to">
        <RouterLink
          :to="it.to"
          :exact-active-class="it.exact ? '!text-primary' : ''"
          :active-class="it.exact ? '' : '!text-primary'"
          class="relative flex h-14 flex-col items-center justify-center gap-0.5 text-2xs font-semibold text-ink-muted transition-colors"
        >
          <component :is="it.icon" v-if="it.icon" :size="21" :stroke-width="1.9" aria-hidden="true" />
          <span>{{ uiT(it.label) }}</span>
          <span v-if="it.badge" class="absolute left-1/2 top-1.5 ml-2 min-w-[16px] rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4 text-primary-on om-num">{{ it.badge > 99 ? '99+' : it.badge }}</span>
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
