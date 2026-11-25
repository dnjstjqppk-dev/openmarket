<script setup lang="ts">
// Category hub (6-1): PLP skeleton above the listing — category line (name +
// live count, no intro prose per decision-21), sub-category links, 8 measured
// bestsellers and the FAQ link. Picks come from the live products API.
import { ref, computed, watch, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { API_BASE_URL } from '../../config'
import { useCatalogStore } from '../../stores/catalog'
import ProductCard from '../ProductCard.vue'

const props = defineProps<{ slug: string }>()
const catalog = useCatalogStore()
const picks = ref<any[]>([])

const node = computed(() => catalog.bySlugOrId(props.slug))
const subs = computed(() => (node.value ? catalog.childrenOf(node.value.id) : []))
const siblings = computed(() => {
  if (!node.value?.parent_id) return []
  return catalog.childrenOf(node.value.parent_id).filter((c) => c.id !== node.value!.id).slice(0, 10)
})

async function loadPicks() {
  picks.value = []
  if (!props.slug) return
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/v1/products?category=${encodeURIComponent(props.slug)}&sort=popular&per_page=8`
    )
    const json = await res.json().catch(() => null)
    if (res.ok && json?.success && Array.isArray(json.data)) picks.value = json.data
  } catch { /* hub shows links only */ }
}

onMounted(async () => {
  await catalog.load()
  void loadPicks()
})
watch(() => props.slug, () => void loadPicks())
</script>

<template>
  <section v-if="node" aria-label="카테고리 안내" class="mx-auto max-w-container space-y-4 px-4 pt-6 sm:px-6">
    <p class="text-sm text-ink-muted">
      {{ node.name }} · {{ (node.product_count ?? 0).toLocaleString('ko-KR') }}개 상품
    </p>
    <nav v-if="subs.length" aria-label="하위 분류" class="flex flex-wrap gap-2">
      <RouterLink
        v-for="s in subs"
        :key="s.id"
        :to="`/category/${s.slug}`"
        class="rounded-full border border-line px-3 py-1.5 text-xs font-bold text-ink hover:border-line-strong"
      >
        {{ s.name }} · {{ Number(s.product_count || 0).toLocaleString('ko-KR') }}개
      </RouterLink>
    </nav>
    <nav v-if="siblings.length" aria-label="함께 보는 분류" class="flex flex-wrap items-center gap-2">
      <span class="text-xs text-ink-muted">함께 보는 분류:</span>
      <RouterLink
        v-for="s in siblings"
        :key="s.id"
        :to="`/category/${s.slug}`"
        class="text-xs font-bold text-primary hover:underline"
      >
        {{ s.name }}
      </RouterLink>
    </nav>
    <div v-if="picks.length" aria-label="이 분류 베스트 8">
      <h2 class="mb-3 text-lg font-bold text-ink">이 분류 베스트 8</h2>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ProductCard v-for="p in picks" :key="p.id" :product="p" />
      </div>
    </div>
    <p class="text-xs">
      <RouterLink to="/support" class="font-bold text-primary hover:underline">자주 묻는 질문 보기</RouterLink>
    </p>
  </section>
</template>
