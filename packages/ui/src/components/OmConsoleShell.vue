<script setup lang="ts">
// Shared console frame for seller center and admin: 240px side menu
// (64px icon rail when collapsed), 56px top header, drawer menu below 1024px
// (a 240px rail left tablets in portrait with a cramped content column).
import { ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Menu, X } from 'lucide-vue-next'

export interface ConsoleMenuItem { to: string; label: string; icon?: any; children?: { to: string; label: string }[] }
const props = withDefaults(defineProps<{
  menu: ConsoleMenuItem[]
  collapsed?: boolean
  title?: string
}>(), { collapsed: false })
const emit = defineEmits<{ 'update:collapsed': [v: boolean] }>()
const route = useRoute()
const drawer = ref(false)
watch(() => route.path, () => { drawer.value = false })
const isActive = (to: string) => route.path === to || route.path.startsWith(`${to}/`)
</script>

<template>
  <div class="flex min-h-dvh bg-bg">
    <aside
      class="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line-divider bg-surface transition-[width] lg:flex"
      :class="collapsed ? 'w-[64px]' : 'w-[240px]'"
      aria-label="주 메뉴"
    >
      <div class="flex h-14 items-center gap-2 border-b border-line-divider px-3">
        <slot name="brand" />
        <button
          type="button"
          class="ml-auto rounded p-1.5 text-ink-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          :aria-label="collapsed ? '메뉴 펼치기' : '메뉴 접기'"
          @click="emit('update:collapsed', !collapsed)"
        >
          <Menu class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <nav class="flex-1 overflow-y-auto p-2">
        <ul class="space-y-0.5">
          <li v-for="m in menu" :key="m.to">
            <RouterLink
              :to="m.to"
              :title="collapsed ? m.label : undefined"
              :class="['flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', isActive(m.to) ? 'bg-primary-soft text-primary-soft-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink']"
            >
              <component :is="m.icon" v-if="m.icon" class="h-4 w-4 shrink-0" aria-hidden="true" />
              <span v-if="!collapsed" class="truncate">{{ m.label }}</span>
            </RouterLink>
            <ul v-if="!collapsed && m.children?.length" class="ml-6 mt-0.5 space-y-0.5 border-l border-line-divider pl-2">
              <li v-for="c in m.children" :key="`${c.to}::${c.label}`">
                <RouterLink
                  :to="c.to"
                  :class="['block rounded px-2 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', isActive(c.to) ? 'font-bold text-ink' : 'text-ink-muted hover:text-ink']"
                >
                  {{ c.label }}
                </RouterLink>
              </li>
            </ul>
          </li>
        </ul>
      </nav>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="sticky top-0 z-sticky flex h-14 items-center gap-2 border-b border-line-divider bg-surface px-4">
        <button
          type="button"
          class="rounded p-2 text-ink-muted hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus lg:hidden"
          aria-label="메뉴 열기"
          @click="drawer = true"
        >
          <Menu class="h-5 w-5" aria-hidden="true" />
        </button>
        <slot name="header" />
      </header>
      <main class="min-w-0 flex-1 p-4 sm:p-6">
        <slot />
      </main>
    </div>

    <Teleport to="body">
      <div v-if="drawer" class="fixed inset-0 z-drawer lg:hidden">
        <div class="absolute inset-0 animate-fade-in bg-overlay/50" aria-hidden="true" @click="drawer = false" />
        <nav class="absolute inset-y-0 left-0 flex w-[280px] animate-slide-in-left flex-col bg-surface shadow-overlay" aria-label="주 메뉴">
          <div class="flex h-14 items-center justify-between border-b border-line-divider px-3">
            <slot name="brand" />
            <button type="button" aria-label="메뉴 닫기" class="rounded p-2 text-ink-muted hover:bg-surface-2" @click="drawer = false">
              <X class="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <slot name="mobile-nav" :close="() => { drawer = false }">
            <!-- Same menu data as the side rail, children included, so no screen is desktop-only. -->
            <ul class="flex-1 space-y-0.5 overflow-y-auto p-2">
              <li v-for="m in menu" :key="m.to">
                <RouterLink
                  :to="m.to"
                  :class="['flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', isActive(m.to) ? 'bg-primary-soft text-primary-soft-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink']"
                  @click="drawer = false"
                >
                  <component :is="m.icon" v-if="m.icon" class="h-4 w-4 shrink-0" aria-hidden="true" />
                  {{ m.label }}
                </RouterLink>
                <ul v-if="m.children?.length" class="ml-6 mt-0.5 space-y-0.5 border-l border-line-divider pl-2">
                  <li v-for="c in m.children" :key="`${c.to}::${c.label}`">
                    <RouterLink
                      :to="c.to"
                      :class="['block rounded px-2 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', isActive(c.to) ? 'font-bold text-ink' : 'text-ink-muted hover:text-ink']"
                      @click="drawer = false"
                    >
                      {{ c.label }}
                    </RouterLink>
                  </li>
                </ul>
              </li>
            </ul>
          </slot>
        </nav>
      </div>
    </Teleport>
  </div>
</template>
