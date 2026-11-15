<script setup lang="ts">
// SKU table editor (4-3): one row per option combination with per-row prices,
// stock and code, plus fill-all. Server caps prices at 100~100,000,000 and
// stock at 0~1,000,000; the form mirrors those bounds before submit.
import { ref } from 'vue'

export interface SkuRow {
  key: string
  label: string
  combination: Record<string, string>
  sku_code: string
  original_price: number | null
  sale_price: number | null
  stock_quantity: number | null
  safety_stock: number | null
}
const rows = defineModel<SkuRow[]>({ default: () => [] })
const fillSale = ref('')
const fillOrig = ref('')
const fillStock = ref('')

function fillAll() {
  const sale = fillSale.value === '' ? null : Number(fillSale.value)
  const orig = fillOrig.value === '' ? null : Number(fillOrig.value)
  const stock = fillStock.value === '' ? null : Number(fillStock.value)
  rows.value = rows.value.map((r) => ({
    ...r,
    sale_price: sale ?? r.sale_price,
    original_price: orig ?? r.original_price,
    stock_quantity: stock ?? r.stock_quantity
  }))
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface-2 p-3 text-xs">
      <label class="space-y-1">일괄 판매가<input v-model="fillSale" type="number" min="100" max="100000000" class="block h-8 w-28 rounded-lg border border-line bg-surface px-2 text-ink" /></label>
      <label class="space-y-1">일괄 정상가<input v-model="fillOrig" type="number" min="100" max="100000000" class="block h-8 w-28 rounded-lg border border-line bg-surface px-2 text-ink" /></label>
      <label class="space-y-1">일괄 재고<input v-model="fillStock" type="number" min="0" max="1000000" class="block h-8 w-24 rounded-lg border border-line bg-surface px-2 text-ink" /></label>
      <button type="button" class="h-8 rounded-lg bg-secondary px-3 font-bold text-secondary-on hover:bg-secondary-hover" @click="fillAll">일괄 채우기</button>
    </div>
    <div class="overflow-x-auto rounded-xl border border-line">
      <table class="w-full min-w-[640px] text-xs">
        <thead>
          <tr class="border-b border-line bg-surface-2 text-left text-ink-muted">
            <th class="px-3 py-2 font-bold">옵션 조합</th>
            <th class="px-3 py-2 font-bold">SKU 코드</th>
            <th class="px-3 py-2 text-right font-bold">정상가</th>
            <th class="px-3 py-2 text-right font-bold">판매가</th>
            <th class="px-3 py-2 text-right font-bold">재고</th>
            <th class="px-3 py-2 text-right font-bold">안전재고</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="r.key" class="border-b border-line-divider last:border-0">
            <td class="px-3 py-1.5 font-semibold text-ink">{{ r.label }}</td>
            <td class="px-3 py-1.5"><input :value="r.sku_code" maxlength="60" placeholder="자동 생성" aria-label="SKU 코드"
              class="h-8 w-full rounded-lg border border-line bg-surface px-2 font-mono text-ink"
              @input="rows = rows.map((x, n) => (n === i ? { ...x, sku_code: ($event.target as HTMLInputElement).value } : x))" /></td>
            <td class="px-3 py-1.5"><input :value="r.original_price ?? ''" type="number" min="100" max="100000000" aria-label="정상가"
              class="h-8 w-full rounded-lg border border-line bg-surface px-2 text-right text-ink"
              @input="rows = rows.map((x, n) => (n === i ? { ...x, original_price: ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value) } : x))" /></td>
            <td class="px-3 py-1.5"><input :value="r.sale_price ?? ''" type="number" min="100" max="100000000" aria-label="판매가"
              class="h-8 w-full rounded-lg border border-line bg-surface px-2 text-right font-bold text-ink"
              @input="rows = rows.map((x, n) => (n === i ? { ...x, sale_price: ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value) } : x))" /></td>
            <td class="px-3 py-1.5"><input :value="r.stock_quantity ?? ''" type="number" min="0" max="1000000" aria-label="재고"
              class="h-8 w-full rounded-lg border border-line bg-surface px-2 text-right text-ink"
              @input="rows = rows.map((x, n) => (n === i ? { ...x, stock_quantity: ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value) } : x))" /></td>
            <td class="px-3 py-1.5"><input :value="r.safety_stock ?? ''" type="number" min="0" max="1000000" aria-label="안전재고"
              class="h-8 w-full rounded-lg border border-line bg-surface px-2 text-right text-ink"
              @input="rows = rows.map((x, n) => (n === i ? { ...x, safety_stock: ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value) } : x))" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
