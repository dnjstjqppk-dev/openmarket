<script setup lang="ts">
// Search results (3-2): thin PlpLayout host with a synonym-aware zero state.
import { RouterLink } from 'vue-router'
import { OmEmptyState, OmButton } from '@olmoa/ui'
import ProductCard from '../components/ProductCard.vue'
import PlpLayout from '../components/plp/PlpLayout.vue'
</script>

<template>
  <PlpLayout>
    <template #zero="{ q, suggestions, popular }">
      <OmEmptyState :title="q ? `‘${q}’ 검색 결과가 없습니다` : '검색 결과가 없습니다'" description="검색어나 필터를 바꿔 보세요.">
        <div v-if="suggestions.length" class="mt-4 flex flex-wrap justify-center gap-2">
          <RouterLink
            v-for="s in suggestions"
            :key="s"
            :to="{ path: '/search', query: { q: s } }"
            class="rounded-full border border-line px-3 py-1.5 text-sm text-ink hover:border-line-strong"
          >
            {{ s }}
          </RouterLink>
        </div>
        <OmButton v-if="q" variant="ghost" size="sm" class="mt-3" to="/search">전체 상품 보기</OmButton>
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
