<script setup lang="ts">
// Quantity stepper: minus / numeric input / plus. Plus locks at stock, minus at 1.
import { clampQuantity } from '../commerce'

const qty = defineModel<number>({ default: 1 })
const props = withDefaults(defineProps<{ stock?: number | null; disabled?: boolean }>(), { stock: null })
const set = (n: number) => { qty.value = clampQuantity(n, props.stock ?? 999999) }
const onInput = (e: Event) => set(Number((e.target as HTMLInputElement).value))
const btn = 'flex h-9 w-9 items-center justify-center rounded text-lg font-bold transition-colors duration-fast hover:bg-surface-2 active:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'
</script>

<template>
  <div class="inline-flex items-center gap-1 rounded-lg border border-line bg-surface" role="group" aria-label="수량">
    <button type="button" :class="btn" :disabled="disabled || qty <= 1" aria-label="수량 줄이기" @click="set(qty - 1)">−</button>
    <input
      :value="qty"
      type="number"
      min="1"
      :max="stock ?? undefined"
      :disabled="disabled"
      aria-label="수량 입력"
      class="om-num h-9 w-12 border-0 bg-transparent text-center text-sm font-bold outline-none disabled:opacity-40"
      @change="onInput"
    />
    <button type="button" :class="btn" :disabled="disabled || (stock !== null && stock !== undefined && qty >= stock)" aria-label="수량 늘리기" @click="set(qty + 1)">+</button>
  </div>
</template>
