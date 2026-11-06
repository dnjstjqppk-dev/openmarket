<script setup lang="ts">
// Purchase progress (cart -> order sheet -> done). Only the cart step links back; later steps are not
// reachable by link because they need an order.
import { RouterLink } from 'vue-router'
import { Check } from 'lucide-vue-next'

const props = defineProps<{ current: 1 | 2 | 3 }>()
const steps = [
  { n: 1, label: '장바구니', to: '/cart' },
  { n: 2, label: '주문/결제' },
  { n: 3, label: '주문 완료' }
] as const
</script>

<template>
  <ol class="flex items-center gap-2 text-sm" aria-label="구매 단계">
    <template v-for="(s, i) in steps" :key="s.n">
      <li v-if="i > 0" aria-hidden="true" class="h-px w-6 bg-line sm:w-10" />
      <li :aria-current="s.n === props.current ? 'step' : undefined" class="flex items-center gap-1.5">
        <span
          :class="[
            'inline-flex h-6 w-6 items-center justify-center rounded-full text-2xs font-bold',
            s.n < props.current ? 'bg-primary text-primary-on' : s.n === props.current ? 'bg-secondary text-secondary-on' : 'border border-line text-ink-subtle'
          ]"
        ><Check v-if="s.n < props.current" class="h-3.5 w-3.5" aria-hidden="true" /><template v-else>{{ s.n }}</template></span>
        <RouterLink v-if="'to' in s && s.n < props.current" :to="s.to" class="text-ink-muted hover:text-ink">{{ s.label }}</RouterLink>
        <span v-else :class="s.n === props.current ? 'font-semibold text-ink' : 'text-ink-subtle'">{{ s.label }}</span>
      </li>
    </template>
  </ol>
</template>
