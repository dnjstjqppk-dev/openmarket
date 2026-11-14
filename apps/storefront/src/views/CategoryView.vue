<script setup lang="ts">
// Category page (3-2): thin PlpLayout host locked to the route slug, with a
// parent-category link and popular fill in the zero state.
import { computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { OmEmptyState } from '@olmoa/ui'
import ProductCard from '../components/ProductCard.vue'
import PlpLayout from '../components/plp/PlpLayout.vue'

const route = useRoute()
const slug = computed(() => String(route.params.slug || ''))
</script>

<template>
  <PlpLayout :key="slug" :locked-category="slug">
    <template #zero="{ popular, parent }">
      <OmEmptyState title="이 카테고리에 상품이 없습니다" description="필터를 풀거나 다른 카테고리를 보세요.">
        <RouterLink
          v-if="parent"
          :to="`/category/${parent.slug}`"
          class="mt-3 inline-block rounded-full border border-line px-3 py-1.5 text-sm text-ink hover:border-line-strong"
        >
          상위 카테고리: {{ parent.name }}
        </RouterLink>
      </OmEmptyState>
      <section v-if="popular.length" class="mx-auto mt-10 max-w-container px-4 sm:px-6" aria-label="인기 상품">
        <h2 class="mb-3 text-lg font-bold text-ink">인기 상품</h2>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ProductCard v-for="p in popular" :key="p.id" :product="p" />
        </div>
      </section>
    </template>
  </PlpLayout>
</template>
