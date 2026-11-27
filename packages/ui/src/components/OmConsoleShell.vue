<script setup lang="ts">
// Shared Studio Console frame (Meridian 2.0) for Seller Center and Admin Console:
// 248px side navigation rail (68px icon rail when collapsed), elevated glass top bar,
// responsive drawer below 1024px, and reactive 4-language menu label translation via uiT().
import { ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Menu, X } from 'lucide-vue-next'
import { uiT } from '../composables/useUiLocale'

export interface ConsoleMenuItem { to: string; label: string; icon?: any; children?: { to: string; label: string }[] }
withDefaults(defineProps<{
  menu: ConsoleMenuItem[]
  collapsed?: boolean
  title?: string
}>(), { collapsed: false })
const emit = defineEmits<{ 'update:collapsed': [v: boolean] }>()
const route = useRoute()
const drawer = ref(false)
watch(() => route.path, () => { drawer.value = false })
const isActive = (to: string) => route.path === to || (to !== '/' && route.path.startsWith(`${to}/`))
</script>

<template>
  <div class="flex min-h-dvh bg-bg text-ink">
    <aside
      class="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface shadow-sm transition-[width] duration-fast ease-om lg:flex"
      :class="collapsed ? 'w-[64px]' : 'w-[240px]'"
      :aria-label="uiT('주 메뉴')"
    >
      <div class="flex h-15 items-center gap-2 border-b border-line-divider px-3.5 py-3">
        <slot name="brand" />
        <button
          type="button"
          class="ml-auto rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          :aria-label="collapsed ? uiT('메뉴 펼치기') : uiT('메뉴 접기')"
          @click="emit('update:collapsed', !collapsed)"
        >
          <Menu class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <nav class="om-scrollbar-none flex-1 overflow-y-auto p-2.5">
        <ul class="space-y-1">
          <li v-for="m in menu" :key="m.to">
            <RouterLink
              :to="m.to"
              :title="collapsed ? uiT(m.label) : undefined"
              :class="[
                'flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                isActive(m.to) ? 'bg-primary text-primary-on shadow-sm' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
              ]"
            >
              <component :is="m.icon" v-if="m.icon" class="h-4 w-4 shrink-0" aria-hidden="true" />
              <span v-if="!collapsed" class="truncate">{{ uiT(m.label) }}</span>
            </RouterLink>
            <ul v-if="!collapsed && m.children?.length" class="ml-5 mt-1 space-y-0.5 border-l-2 border-line-divider pl-3">
              <li v-for="c in m.children" :key="`${c.to}::${c.label}`">
                <RouterLink
                  :to="c.to"
                  :class="[
                    'block rounded-lg px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    isActive(c.to) ? 'bg-primary-soft font-bold text-primary-soft-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
                  ]"
                >
                  {{ uiT(c.label) }}
                </RouterLink>
              </li>
            </ul>
          </li>
        </ul>
      </nav>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="sticky top-0 z-sticky flex h-15 items-center gap-2 border-b border-line bg-surface/90 px-4 py-2.5 shadow-sm backdrop-blur-md">
        <button
          type="button"
          class="rounded-lg p-2 text-ink-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus lg:hidden"
          :aria-label="uiT('메뉴 열기')"
          @click="drawer = true"
        >
          <Menu class="h-5 w-5" aria-hidden="true" />
        </button>
        <slot name="header" />
      </header>
      <main class="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <div class="mx-auto w-full max-w-[1440px]">
          <slot />
        </div>
      </main>
    </div>

    <Teleport to="body">
      <div v-if="drawer" class="fixed inset-0 z-drawer lg:hidden">
        <div class="absolute inset-0 animate-fade-in bg-overlay/50 backdrop-blur-[2px]" aria-hidden="true" @click="drawer = false" />
        <nav class="absolute inset-y-0 left-0 flex w-[288px] animate-slide-in-left flex-col bg-surface shadow-overlay" :aria-label="uiT('주 메뉴')">
          <div class="flex h-15 items-center justify-between border-b border-line-divider px-4 py-3">
            <slot name="brand" />
            <button type="button" :aria-label="uiT('메뉴 닫기')" class="rounded-lg p-2 text-ink-muted hover:bg-surface-2" @click="drawer = false">
              <X class="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <slot name="mobile-nav" :close="() => { drawer = false }">
            <ul class="flex-1 space-y-1 overflow-y-auto p-3">
              <li v-for="m in menu" :key="m.to">
                <RouterLink
                  :to="m.to"
                  :class="[
                    'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    isActive(m.to) ? 'bg-primary text-primary-on shadow-sm' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
                  ]"
                  @click="drawer = false"
                >
                  <component :is="m.icon" v-if="m.icon" class="h-4 w-4 shrink-0" aria-hidden="true" />
                  {{ uiT(m.label) }}
                </RouterLink>
                <ul v-if="m.children?.length" class="ml-5 mt-1 space-y-0.5 border-l-2 border-line-divider pl-3">
                  <li v-for="c in m.children" :key="`${c.to}::${c.label}`">
                    <RouterLink
                      :to="c.to"
                      :class="[
                        'block rounded-lg px-2.5 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                        isActive(c.to) ? 'bg-primary-soft font-bold text-primary-soft-ink' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
                      ]"
                      @click="drawer = false"
                    >
                      {{ uiT(c.label) }}
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
