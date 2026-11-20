<script setup lang="ts">
// OmFaq — semantic FAQ accordion on native <details>: keyboard support and
// crawlable Q/A text for free, no JS state to hydrate. Pairs with faqGraph().
export interface FaqItem { q: string; a: string }
defineProps<{ items: FaqItem[]; heading?: string }>()
</script>

<template>
  <section aria-labelledby="om-faq-h" class="rounded-lg bg-surface p-4">
    <h2 id="om-faq-h" class="text-md font-semibold text-ink">
      {{ heading || '자주 묻는 질문' }}
    </h2>
    <div class="mt-2 divide-y divide-line">
      <details v-for="(f, i) in items" :key="i" class="py-2">
        <summary class="cursor-pointer text-sm font-medium text-ink">
          {{ f.q }}
        </summary>
        <p class="mt-1 text-sm text-ink-muted">{{ f.a }}</p>
      </details>
    </div>
  </section>
</template>
