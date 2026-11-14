<script setup lang="ts">
// Stepped option picker (3-4): each attribute unlocks after the previous one.
// Values show sold-out state and the surcharge over the base ticket.
import { formatNumber } from '@olmoa/ui'
import type { BuySelection } from './useBuySelection'

defineProps<{ sel: BuySelection; baseMin: number }>()
</script>

<template>
  <div class="space-y-4">
    <fieldset v-for="(a, i) in sel.attributes" :key="a.name" :disabled="!sel.stepUnlocked(i)">
      <legend class="mb-2 text-sm font-medium text-ink">
        {{ a.name }}
        <span v-if="sel.selection[a.name]" class="ml-2 font-normal text-ink-muted">{{ sel.selection[a.name] }}</span>
        <span v-else-if="!sel.stepUnlocked(i)" class="ml-2 text-xs font-normal text-ink-subtle">이전 옵션을 먼저 선택해 주세요</span>
      </legend>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="v in a.values"
          :key="String(v)"
          type="button"
          :aria-pressed="sel.selection[a.name] === String(v)"
          :disabled="sel.valueState(a.name, String(v)) === 'none'"
          class="min-h-10 rounded-md border px-3.5 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
          :class="sel.selection[a.name] === String(v)
            ? 'border-secondary bg-secondary text-secondary-on'
            : sel.valueState(a.name, String(v)) === 'soldout'
              ? 'border-line border-dashed text-ink-subtle'
              : 'border-line text-ink hover:border-line-strong'"
          @click="sel.choose(a.name, String(v))"
        >
          {{ v }}
          <span v-if="sel.valueState(a.name, String(v)) === 'soldout'" class="ml-1 text-2xs">품절</span>
          <span v-else-if="sel.valueExtra(a.name, String(v)) > 0" class="ml-1 text-2xs tabular-nums opacity-70">+{{ formatNumber(sel.valueExtra(a.name, String(v))) }}원</span>
        </button>
      </div>
    </fieldset>
    <p v-if="sel.comboHint" class="text-sm text-warning" role="status">{{ sel.comboHint }}</p>
  </div>
</template>
