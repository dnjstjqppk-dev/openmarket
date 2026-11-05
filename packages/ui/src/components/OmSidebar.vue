<script setup lang="ts">
// Console navigation (partner / admin). Groups of links; items the current user may not use are filtered out by
// the caller (`can`), so menus follow the role. Collapses to an icon rail on lg, becomes a drawer below lg.
import type { Component } from 'vue'
import OmDrawer from './OmDrawer.vue'

export interface SidebarItem { to: string; label: string; icon?: Component; badge?: number | string | null; exact?: boolean; hidden?: boolean }
export interface SidebarGroup { label?: string; items: SidebarItem[] }
const mobileOpen = defineModel<boolean>('mobileOpen', { default: false })
withDefaults(defineProps<{ groups: SidebarGroup[]; collapsed?: boolean; title?: string }>(), { collapsed: false, title: '메뉴' })
</script>

<template>
  <!-- desktop -->
  <aside :class="['sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface lg:flex', collapsed ? 'w-[72px]' : 'w-64']" :aria-label="title">
    <div class="flex h-header shrink-0 items-center border-b border-line-divider px-4"><slot name="brand" :collapsed="collapsed" /></div>
    <nav class="flex-1 overflow-y-auto px-3 py-4">
      <div v-for="(g, gi) in groups" :key="gi" class="mb-5 last:mb-0">
        <p v-if="g.label && !collapsed" class="mb-1.5 px-3 text-2xs font-bold uppercase tracking-wider text-ink-subtle">{{ g.label }}</p>
        <ul class="flex flex-col gap-0.5">
          <li v-for="it in g.items.filter((x) => !x.hidden)" :key="it.to">
            <RouterLink
              :to="it.to"
              :title="collapsed ? it.label : undefined"
              :exact-active-class="it.exact ? '!bg-primary-soft !text-primary-soft-ink' : ''"
              :active-class="it.exact ? '' : '!bg-primary-soft !text-primary-soft-ink'"
              :class="['flex h-9 items-center gap-3 rounded px-3 text-sm font-medium text-ink-muted transition-colors duration-fast hover:bg-surface-2 hover:text-ink', collapsed ? 'justify-center px-0' : '']"
            >
              <component :is="it.icon" v-if="it.icon" :size="18" :stroke-width="1.8" aria-hidden="true" class="shrink-0" />
              <span v-if="!collapsed" class="flex-1 truncate">{{ it.label }}</span>
              <span v-if="!collapsed && it.badge" class="rounded-full bg-accent px-1.5 text-2xs font-bold text-white om-num">{{ it.badge }}</span>
            </RouterLink>
          </li>
        </ul>
      </div>
    </nav>
    <div v-if="$slots.footer" class="border-t border-line-divider p-3"><slot name="footer" :collapsed="collapsed" /></div>
  </aside>

  <!-- mobile / tablet -->
  <OmDrawer v-model:open="mobileOpen" side="left" width="sm" :title="title">
    <nav>
      <div v-for="(g, gi) in groups" :key="gi" class="mb-5">
        <p v-if="g.label" class="mb-1.5 px-1 text-2xs font-bold uppercase tracking-wider text-ink-subtle">{{ g.label }}</p>
        <ul class="flex flex-col gap-0.5">
          <li v-for="it in g.items.filter((x) => !x.hidden)" :key="it.to">
            <RouterLink :to="it.to" active-class="!bg-primary-soft !text-primary-soft-ink" class="flex h-11 items-center gap-3 rounded px-3 text-md font-medium text-ink hover:bg-surface-2" @click="mobileOpen = false">
              <component :is="it.icon" v-if="it.icon" :size="18" aria-hidden="true" />
              <span class="flex-1">{{ it.label }}</span>
              <span v-if="it.badge" class="rounded-full bg-accent px-1.5 text-2xs font-bold text-white om-num">{{ it.badge }}</span>
            </RouterLink>
          </li>
        </ul>
      </div>
    </nav>
    <template v-if="$slots.footer" #footer><slot name="footer" :collapsed="false" /></template>
  </OmDrawer>
</template>
