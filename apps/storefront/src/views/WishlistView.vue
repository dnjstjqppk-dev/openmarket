<script setup lang="ts">
// Wishlist (PHASE 2 redesign). GET /wishlist returns the customer's saved products (the server takes the customer
// from the token; the old ?customer_id= / body customer_id were ignored and are no longer sent). POST toggles.
// Saved products that are no longer ACTIVE stay listed but are marked and not linked as purchasable.
// The old empty-state promise of "price-drop alerts" described a feature that does not exist.
import { ref, computed, onMounted } from 'vue'
import { Heart, X } from 'lucide-vue-next'
import { OmBreadcrumb, OmSkeleton, OmEmptyState, OmErrorState, OmButton, OmIconButton, OmBadge, useToast, formatDate } from '@olmoa/ui'
import ProductCard from '../components/ProductCard.vue'
import { API_BASE_URL, authHeader } from '../config'

const toast = useToast()
const items = ref<any[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
const removing = ref<Set<string>>(new Set())

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/wishlist`, { headers: { ...authHeader() } })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || `찜 목록을 불러오지 못했습니다 (${res.status})`)
    items.value = json.data || []
  } catch (e: any) {
    loadError.value = e?.message || '찜 목록을 불러오지 못했습니다'
  } finally {
    loading.value = false
  }
}

async function remove(item: any) {
  const id = item.product_id
  if (removing.value.has(id)) return
  removing.value = new Set(removing.value).add(id)
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/wishlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ product_id: id })
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || `삭제하지 못했습니다 (${res.status})`)
    // The endpoint toggles; if it reports "ADDED" the item had already been removed elsewhere — re-sync.
    if (json.wished) { await load(); return }
    items.value = items.value.filter((i) => i.product_id !== id)
    toast.success('찜 목록에서 삭제했습니다.')
  } catch (e: any) {
    toast.error(e?.message || '삭제하지 못했습니다')
  } finally {
    const s = new Set(removing.value); s.delete(id); removing.value = s
  }
}

onMounted(load)
const activeCount = computed(() => items.value.filter((i) => i.status === 'ACTIVE').length)
</script>

<template>
  <div class="mx-auto max-w-container px-4 py-6 sm:px-6">
    <OmBreadcrumb :items="[{ label: '홈', to: '/' }, { label: '찜한 상품' }]" />
    <header class="mb-6 mt-3">
      <h1 class="text-2xl font-bold text-ink">찜한 상품</h1>
      <p v-if="!loading && !loadError && items.length" class="mt-1 text-sm text-ink-muted">
        {{ items.length }}개<template v-if="activeCount !== items.length"> · 판매 중 {{ activeCount }}개</template>
      </p>
    </header>

    <div v-if="loading" class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"><OmSkeleton variant="card" :count="5" /></div>
    <OmErrorState v-else-if="loadError" :message="loadError" @retry="load" />
    <OmEmptyState v-else-if="!items.length" title="찜한 상품이 없습니다" description="상품 상세에서 하트를 누르면 이곳에 저장됩니다.">
      <template #icon><Heart class="h-8 w-8 text-ink-subtle" aria-hidden="true" /></template>
      <OmButton to="/" variant="outline" size="sm">상품 둘러보기</OmButton>
    </OmEmptyState>

    <ul v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      <li v-for="item in items" :key="item.wishlist_id" class="relative">
        <ProductCard v-if="item.status === 'ACTIVE'" :product="item" />
        <div v-else class="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface-2">
          <div class="aspect-square overflow-hidden bg-surface-3"><img :src="item.thumbnail_url" :alt="item.title" class="h-full w-full object-cover opacity-50 grayscale" loading="lazy" /></div>
          <div class="flex flex-1 flex-col gap-1.5 p-3">
            <OmBadge tone="neutral" class="w-fit">판매 중지</OmBadge>
            <p class="line-clamp-2 text-sm text-ink-muted">{{ item.title }}</p>
          </div>
        </div>
        <p class="mt-1 px-1 text-2xs text-ink-subtle">{{ formatDate(item.wished_at) }} 저장</p>
        <OmIconButton
          :label="`${item.title} 찜 삭제`"
          size="sm"
          variant="outline"
          class="absolute right-2 top-2 !bg-surface/90"
          :loading="removing.has(item.product_id)"
          @click="remove(item)"
        ><X class="h-4 w-4" /></OmIconButton>
      </li>
    </ul>
  </div>
</template>
