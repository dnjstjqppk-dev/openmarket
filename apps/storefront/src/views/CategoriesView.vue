<script setup lang="ts">
// All categories (PHASE 2 redesign). Tree and product counts come from /categories via the shared store;
// counts are the server's bottom-up rollup of ACTIVE products. No invented labels ("Direct Verified" removed).
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { Search } from 'lucide-vue-next'
import { OmInput, OmSkeleton, OmEmptyState, OmErrorState, OmBreadcrumb, OmButton, formatNumber } from '@olmoa/ui'
import { useCatalogStore } from '../stores/catalog'

const catalog = useCatalogStore()
const filter = ref('')
const hideEmpty = ref(false)
onMounted(() => catalog.load())

const q = computed(() => filter.value.trim().toLowerCase())
const groups = computed(() =>
  catalog.roots
    .map((root) => {
      const rootHit = !q.value || root.name.toLowerCase().includes(q.value)
      let subs = catalog.childrenOf(root.id)
      if (q.value && !rootHit) subs = subs.filter((s) => s.name.toLowerCase().includes(q.value))
      if (hideEmpty.value) subs = subs.filter((s) => Number(s.product_count) > 0)
      return { root, subs, show: rootHit || subs.length > 0 }
    })
    .filter((g) => g.show && (!hideEmpty.value || Number(g.root.product_count) > 0))
)
const totalProducts = computed(() => catalog.roots.reduce((s, r) => s + Number(r.product_count || 0), 0))
async function retry() { await catalog.load(true) }
</script>

<template>
  <div class="mx-auto max-w-container px-4 py-6 sm:px-6">
    <OmBreadcrumb :items="[{ label: '홈', to: '/' }, { label: '전체 카테고리' }]" />

    <header class="mb-6 mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-ink">전체 카테고리</h1>
        <p v-if="catalog.loaded" class="mt-1 text-sm text-ink-muted">
          대분류 {{ catalog.roots.length }}개 · 판매 중인 상품 {{ formatNumber(totalProducts) }}개
        </p>
      </div>
      <div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center md:w-auto">
        <div class="w-full sm:w-72">
          <OmInput v-model="filter" type="search" placeholder="카테고리 이름으로 찾기" aria-label="카테고리 찾기" clearable>
            <template #prefix><Search class="h-4 w-4 text-ink-subtle" aria-hidden="true" /></template>
          </OmInput>
        </div>
        <label class="inline-flex shrink-0 cursor-pointer items-center gap-2 text-sm text-ink-muted">
          <input v-model="hideEmpty" type="checkbox" class="h-4 w-4 accent-[rgb(var(--om-primary))]" />
          상품 있는 카테고리만
        </label>
      </div>
    </header>

    <div v-if="!catalog.loaded && !catalog.error" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <OmSkeleton variant="rect" height="h-40" :count="9" />
    </div>
    <OmErrorState v-else-if="catalog.error && !catalog.loaded" :message="catalog.error" @retry="retry" />
    <OmEmptyState v-else-if="!groups.length" title="일치하는 카테고리가 없습니다" :description="q ? `'${filter}'와 일치하는 카테고리가 없습니다.` : '표시할 카테고리가 없습니다.'">
      <OmButton v-if="q || hideEmpty" variant="outline" size="sm" @click="filter = ''; hideEmpty = false">필터 초기화</OmButton>
    </OmEmptyState>

    <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <section v-for="g in groups" :key="g.root.id" class="flex flex-col rounded-lg border border-line bg-surface p-5">
        <RouterLink :to="`/category/${g.root.slug}`" class="group flex items-baseline justify-between gap-3">
          <h2 class="text-lg font-semibold text-ink group-hover:underline group-hover:underline-offset-2">{{ g.root.name }}</h2>
          <span class="shrink-0 text-xs tabular-nums" :class="Number(g.root.product_count) ? 'text-ink-muted' : 'text-ink-subtle'">
            {{ Number(g.root.product_count) ? `${formatNumber(g.root.product_count)}개` : '상품 없음' }}
          </span>
        </RouterLink>
        <ul v-if="g.subs.length" class="mt-3 flex flex-wrap gap-1.5 border-t border-line-divider pt-3">
          <li v-for="s in g.subs" :key="s.id">
            <RouterLink
              :to="`/category/${s.slug}`"
              class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition"
              :class="Number(s.product_count) ? 'bg-surface-2 text-ink hover:bg-surface-3' : 'bg-transparent text-ink-subtle ring-1 ring-inset ring-line hover:text-ink-muted'"
            >
              {{ s.name }}<span v-if="Number(s.product_count)" class="tabular-nums text-ink-muted">{{ s.product_count }}</span>
            </RouterLink>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
