<script setup lang="ts">
// Adapter kept for the 9 existing usages; the card itself moved to
// @olmoa/ui OmProductCard (work order 1-4). Stage 3-3 expands OmProductCard
// and removes this file.
import { OmProductCard } from '@olmoa/ui'
import { useLocaleStore } from '../stores/locale'

withDefaults(defineProps<{ product: any; rank?: number | null; eager?: boolean }>(), { rank: null, eager: false })
const locale = useLocaleStore()
</script>

<template>
  <OmProductCard :product="product" :rank="rank" :eager="eager" :format-price="locale.formatPrice" />
</template>
