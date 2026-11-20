<script setup lang="ts">
// OmSpecTable — semantic spec table: real <table> with row headers so
// snippets and assistive tech read name/value pairs as a table, not divs.
export interface SpecRow { name: string; value: string }
defineProps<{ rows: SpecRow[]; caption?: string }>()
</script>

<template>
  <table class="w-full border-collapse text-sm">
    <caption v-if="caption" class="pb-2 text-left text-md font-semibold text-ink">
      {{ caption }}
    </caption>
    <tbody>
      <tr v-for="(r, i) in rows" :key="i" class="border-t border-line">
        <th scope="row" class="w-32 py-2 pr-3 text-left font-medium text-ink-muted">
          {{ r.name }}
        </th>
        <td class="py-2 text-ink">{{ r.value }}</td>
      </tr>
    </tbody>
  </table>
</template>
