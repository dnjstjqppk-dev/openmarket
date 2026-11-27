<script setup lang="ts">
// Site footer (Meridian 2.0): elevated editorial brand block, localized link columns, legal block.
import { uiT } from '../composables/useUiLocale'

export interface FooterColumn { title: string; links: { label: string; to?: string; href?: string }[] }
withDefaults(defineProps<{ columns?: FooterColumn[]; tone?: 'light' | 'dark' }>(), { columns: () => [], tone: 'light' })
</script>

<template>
  <footer :class="['mt-20 border-t', tone === 'dark' ? 'border-transparent bg-secondary text-secondary-on' : 'border-line bg-surface text-ink']">
    <div class="om-container grid gap-10 py-14 md:grid-cols-[1.5fr_repeat(3,1fr)]">
      <div class="space-y-3.5"><slot name="brand" /></div>
      <nav v-for="col in columns" :key="col.title" :aria-label="uiT(col.title)">
        <h2 :class="['mb-3.5 text-xs font-bold uppercase tracking-wider', tone === 'dark' ? 'text-secondary-on/60' : 'text-ink-subtle']">{{ uiT(col.title) }}</h2>
        <ul class="space-y-2.5 text-sm">
          <li v-for="l in col.links" :key="l.label">
            <RouterLink v-if="l.to" :to="l.to" :class="['transition-colors', tone === 'dark' ? 'text-secondary-on/80 hover:text-secondary-on' : 'text-ink-muted hover:text-primary']">{{ uiT(l.label) }}</RouterLink>
            <a v-else :href="l.href" target="_blank" rel="noopener" :class="['transition-colors', tone === 'dark' ? 'text-secondary-on/80 hover:text-secondary-on' : 'text-ink-muted hover:text-primary']">{{ uiT(l.label) }}</a>
          </li>
        </ul>
      </nav>
    </div>
    <div :class="['border-t', tone === 'dark' ? 'border-secondary-on/10' : 'border-line-divider bg-surface-2/60']">
      <div :class="['om-container py-7 text-xs leading-relaxed', tone === 'dark' ? 'text-secondary-on/60' : 'text-ink-muted']"><slot name="legal" /></div>
    </div>
  </footer>
</template>
