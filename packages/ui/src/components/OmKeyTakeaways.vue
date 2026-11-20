<script setup lang="ts">
// OmKeyTakeaways — GEO/AEO answer-first block: a labelled section with a
// plain list so extractors and readers get the verdict without scrolling.
defineProps<{ items: string[]; heading?: string }>()
</script>

<template>
  <section aria-labelledby="om-takeaways-h" class="rounded-lg bg-surface p-4">
    <h2 id="om-takeaways-h" class="text-md font-semibold text-ink">
      {{ heading || '핵심 요약' }}
    </h2>
    <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
      <li v-for="(t, i) in items" :key="i">{{ t }}</li>
    </ul>
  </section>
</template>
