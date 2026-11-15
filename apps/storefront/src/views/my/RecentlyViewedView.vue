<script setup lang="ts">
// 3-9: /my/recent — server-side recently viewed products (logged-in views are
// recorded by the product API). Each row deletes individually and loudly.
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useLocaleStore } from '../../stores/locale'
import { API_BASE_URL, authHeader } from '../../config'
import { userErrorMessage, OmEmptyState, OmErrorState, OmImage, OmSkeleton } from '@olmoa/ui'
import MyLayout from './MyLayout.vue'

const locale = useLocaleStore()

const loading = ref(true)
const loadError = ref('')
const items = ref<any[]>([])
const actionError = ref('')
let lastAction: (() => Promise<void>) | null = null

const formatDate = (dStr?: string) => {
  if (!dStr) return '-'
  const d = new Date(dStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

const load = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/me/recently-viewed?limit=50`, { headers: { ...authHeader() } })
    const json = await res.json()
    if (!json.success) throw new Error(json.error || '최근 본 상품을 불러오지 못했습니다.')
    items.value = json.data
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '최근 본 상품을 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}

const retryAction = async () => {
  if (!lastAction) return
  actionError.value = ''
  await lastAction()
}

const removeItem = async (productId: string) => {
  lastAction = () => removeItem(productId)
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/me/recently-viewed/${productId}`, {
      method: 'DELETE',
      headers: { ...authHeader() }
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || '삭제하지 못했습니다. 잠시 후 다시 시도해주세요.')
    items.value = items.value.filter((p) => p.id !== productId)
    lastAction = null
  } catch (e: any) {
    actionError.value = userErrorMessage(e, '삭제에 실패했습니다.')
  }
}

onMounted(load)
</script>

<template>
  <MyLayout title="최근 본 상품">
    <div v-if="loading" class="space-y-3">
      <OmSkeleton variant="row" :count="5" />
    </div>
    <OmErrorState v-else-if="loadError" :message="loadError" @retry="load" />
    <div v-else class="space-y-4">
      <div v-if="actionError" class="flex items-center justify-between gap-3 rounded-xl border border-warning bg-warning-soft p-3.5 text-xs font-bold text-warning">
        <span>{{ actionError }}</span>
        <button type="button" class="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 hover:bg-surface-2" @click="retryAction">다시 시도</button>
      </div>
      <ul v-if="items.length" class="space-y-3">
        <li
          v-for="p in items"
          :key="p.id"
          class="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4"
        >
          <OmImage :src="p.thumbnail_url" :alt="p.title" ratio="h-16 w-16 shrink-0 rounded-xl border border-line" />
          <div class="min-w-0 flex-1">
            <RouterLink :to="`/product/${p.id}`" class="block truncate text-sm font-bold text-ink hover:underline">{{ p.title }}</RouterLink>
            <p class="om-num mt-0.5 text-sm font-bold text-primary">{{ locale.formatPrice(p.lowest_sale_price) }}</p>
            <p class="om-num mt-0.5 text-2xs text-ink-subtle">{{ formatDate(p.viewed_at) }}에 봄</p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-xl border border-line px-3 py-2 text-xs font-bold text-ink-muted hover:border-line-strong hover:text-ink"
            @click="removeItem(p.id)"
          >
            삭제
          </button>
        </li>
      </ul>
      <OmEmptyState
        v-else
        title="최근 본 상품이 없습니다"
        description="상품을 보면 여기에 최대 50개까지 표시됩니다."
      >
        <RouterLink to="/" class="rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-on hover:bg-primary-hover">쇼핑하러 가기</RouterLink>
      </OmEmptyState>
    </div>
  </MyLayout>
</template>
