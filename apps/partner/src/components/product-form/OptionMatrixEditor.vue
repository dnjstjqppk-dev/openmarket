<script setup lang="ts">
// Option matrix editor (4-3): up to 3 kinds, 100 values each, 200
// combinations. The SKU table builds one row per combination.
import { computed } from 'vue'

export interface OptionKind { name: string; values: string[] }
const kinds = defineModel<OptionKind[]>({ default: () => [] })

const combos = computed(() => kinds.value.reduce((n, k) => n * Math.max(1, k.values.length), 1))
const overLimit = computed(() => combos.value > 200)

function addKind() {
  if (kinds.value.length >= 3) return
  kinds.value = [...kinds.value, { name: '', values: [] }]
}
function removeKind(i: number) { kinds.value = kinds.value.filter((_, k) => k !== i) }
function setValues(i: number, text: string) {
  const values = text.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100)
  kinds.value = kinds.value.map((k, n) => (n === i ? { ...k, values } : k))
}
</script>

<template>
  <div class="space-y-3">
    <div v-for="(k, i) in kinds" :key="i" class="space-y-1.5 rounded-xl border border-line bg-surface-2 p-3">
      <div class="flex gap-2">
        <input :value="k.name" placeholder="옵션명 (예: 색상)" aria-label="옵션명" maxlength="50"
          class="h-9 w-40 rounded-lg border border-line bg-surface px-3 text-xs text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus"
          @input="kinds = kinds.map((x, n) => (n === i ? { ...x, name: ($event.target as HTMLInputElement).value } : x))" />
        <input :value="k.values.join(', ')" placeholder="값 (쉼표 구분, 최대 100개)" aria-label="옵션 값"
          class="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-xs text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus"
          @input="setValues(i, ($event.target as HTMLInputElement).value)" />
        <button type="button" class="h-9 shrink-0 rounded-lg border border-line px-3 text-xs font-bold text-ink-muted hover:bg-surface-2" @click="removeKind(i)">삭제</button>
      </div>
    </div>
    <div class="flex items-center justify-between">
      <button type="button" :disabled="kinds.length >= 3" class="h-9 rounded-lg border border-line px-3 text-xs font-bold text-ink hover:bg-surface-2 disabled:opacity-50" @click="addKind">
        옵션 종류 추가 ({{ kinds.length }}/3)
      </button>
      <p class="om-num text-xs font-bold" :class="overLimit ? 'text-danger' : 'text-ink-muted'">조합 {{ combos }}개 / 최대 200개</p>
    </div>
    <p v-if="overLimit" role="alert" class="text-xs font-bold text-danger">조합이 200개를 초과했습니다. 옵션 값 개수를 줄여 주세요.</p>
  </div>
</template>
