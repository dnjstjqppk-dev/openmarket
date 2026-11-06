<script setup lang="ts">
// Narrow centered card used by login, sign-up and password reset.
import { RouterLink } from 'vue-router'
import BrandMark from './BrandMark.vue'

defineProps<{ title: string; subtitle?: string }>()
</script>

<template>
  <div class="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
    <section class="rounded-xl border border-line bg-surface p-6 shadow-sm sm:p-8">
      <header class="mb-6 text-center">
        <RouterLink to="/" class="inline-flex items-center gap-2" aria-label="OLMOA 홈">
          <BrandMark :size="36" />
          <span class="text-2xl font-bold tracking-tight text-ink">olmoa</span>
        </RouterLink>
        <h1 class="mt-4 text-xl font-bold text-ink">{{ title }}</h1>
        <p v-if="subtitle" class="mt-1 text-sm text-ink-muted">{{ subtitle }}</p>
      </header>
      <slot />
      <footer v-if="$slots.footer" class="mt-6 border-t border-line-divider pt-5 text-center text-sm text-ink-muted">
        <slot name="footer" />
      </footer>
    </section>
  </div>
</template>
