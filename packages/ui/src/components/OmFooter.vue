<script setup lang="ts">
// Site footer: brand block, link columns and a legal block (business disclosures required by the
// Korean E-Commerce Act are passed in by the app; the footer never invents company data).
export interface FooterColumn { title: string; links: { label: string; to?: string; href?: string }[] }
withDefaults(defineProps<{ columns?: FooterColumn[]; tone?: 'light' | 'dark' }>(), { columns: () => [], tone: 'light' })
</script>

<template>
  <footer :class="['mt-16 border-t', tone === 'dark' ? 'border-transparent bg-secondary text-secondary-on' : 'border-line bg-surface text-ink']">
    <div class="om-container grid gap-10 py-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
      <div class="space-y-3"><slot name="brand" /></div>
      <nav v-for="col in columns" :key="col.title" :aria-label="col.title">
        <h2 :class="['mb-3 text-xs font-semibold uppercase tracking-wide', tone === 'dark' ? 'text-white/60' : 'text-ink-subtle']">{{ col.title }}</h2>
        <ul class="space-y-2 text-sm">
          <li v-for="l in col.links" :key="l.label">
            <RouterLink v-if="l.to" :to="l.to" :class="tone === 'dark' ? 'text-white/80 hover:text-white' : 'text-ink-muted hover:text-ink'">{{ l.label }}</RouterLink>
            <a v-else :href="l.href" target="_blank" rel="noopener" :class="tone === 'dark' ? 'text-white/80 hover:text-white' : 'text-ink-muted hover:text-ink'">{{ l.label }}</a>
          </li>
        </ul>
      </nav>
    </div>
    <div :class="['border-t', tone === 'dark' ? 'border-white/10' : 'border-line']">
      <div :class="['om-container py-6 text-xs leading-relaxed', tone === 'dark' ? 'text-white/60' : 'text-ink-muted']"><slot name="legal" /></div>
    </div>
  </footer>
</template>
