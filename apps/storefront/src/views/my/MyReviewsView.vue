<script setup lang="ts">
// 3-9: /my/reviews — reviewable purchases and written reviews. The write form
// itself lives on the product page; reviewable rows link there.
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { API_BASE_URL, authHeader } from '../../config'
import { userErrorMessage, OmEmptyState, OmErrorState, OmImage, OmSkeleton, OmStatusTabs } from '@olmoa/ui'
import MyLayout from './MyLayout.vue'

const tab = ref('reviewable')
const loading = ref(true)
const loadError = ref('')
const reviewable = ref<any[]>([])
const written = ref<any[]>([])

const formatDate = (dStr?: string) => {
  if (!dStr) return '-'
  const d = new Date(dStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

const load = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const [todoRes, doneRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/me/reviewable`, { headers: { ...authHeader() } }),
      fetch(`${API_BASE_URL}/api/v1/me/reviews`, { headers: { ...authHeader() } })
    ])
    const [todo, done] = await Promise.all([todoRes.json(), doneRes.json()])
    if (!todo.success) throw new Error(todo.error || '작성 가능한 리뷰를 불러오지 못했습니다.')
    if (!done.success) throw new Error(done.error || '작성한 리뷰를 불러오지 못했습니다.')
    reviewable.value = todo.data
    written.value = done.data
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '리뷰를 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <MyLayout title="리뷰">
    <div v-if="loading" class="space-y-3">
      <OmSkeleton variant="row" :count="4" />
    </div>
    <OmErrorState v-else-if="loadError" :message="loadError" @retry="load" />
    <div v-else class="space-y-4">
      <OmStatusTabs
        v-model="tab"
        :tabs="[
          { value: 'reviewable', label: '쓸 수 있는 리뷰', count: reviewable.length },
          { value: 'written', label: '작성한 리뷰', count: written.length }
        ]"
      />

      <ul v-if="tab === 'reviewable'" class="space-y-3">
        <li
          v-for="r in reviewable"
          :key="`${r.product_id}:${r.order_id}`"
          class="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4"
        >
          <OmImage :src="r.thumbnail_url" :alt="r.product_title" ratio="h-16 w-16 shrink-0 rounded-xl border border-line" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-bold text-ink">{{ r.product_title }}</p>
            <p v-if="r.option_summary" class="mt-0.5 truncate text-xs text-ink-muted">{{ r.option_summary }}</p>
            <p class="om-num mt-0.5 text-2xs text-ink-subtle">주문 {{ r.order_no || r.order_id }} · {{ formatDate(r.ordered_at) }}</p>
          </div>
          <RouterLink
            :to="`/product/${r.product_id}`"
            class="shrink-0 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-on hover:bg-primary-hover"
          >
            리뷰 쓰기
          </RouterLink>
        </li>
      </ul>
      <OmEmptyState
        v-if="tab === 'reviewable' && reviewable.length === 0"
        title="쓸 수 있는 리뷰가 없습니다"
        description="배송 완료된 상품에 리뷰를 작성해 보세요."
      >
        <RouterLink to="/orders" class="rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-on hover:bg-primary-hover">주문 내역 보기</RouterLink>
      </OmEmptyState>

      <ul v-if="tab === 'written'" class="space-y-3">
        <li
          v-for="r in written"
          :key="r.id"
          class="space-y-2 rounded-2xl border border-line bg-surface p-4"
        >
          <div class="flex items-center gap-3">
            <OmImage :src="r.thumbnail_url" :alt="r.product_title" ratio="h-12 w-12 shrink-0 rounded-xl border border-line" />
            <div class="min-w-0 flex-1">
              <RouterLink :to="`/product/${r.product_id}`" class="block truncate text-sm font-bold text-ink hover:underline">{{ r.product_title }}</RouterLink>
              <p class="mt-0.5 flex items-center gap-2 text-2xs text-ink-subtle">
                <span :aria-label="`별점 ${r.rating}점`">
                  <span v-for="i in 5" :key="i" :class="i <= Number(r.rating) ? 'text-rating' : 'text-ink-subtle'">★</span>
                </span>
                <span class="om-num">{{ formatDate(r.created_at) }}</span>
                <span v-if="r.visibility && r.visibility !== 'VISIBLE'" class="rounded-full bg-warning-soft px-2 py-0.5 font-bold text-warning">숨김 처리됨</span>
              </p>
            </div>
          </div>
          <p class="whitespace-pre-wrap text-sm text-ink">{{ r.content }}</p>
          <div v-if="r.images && r.images.length" class="flex flex-wrap gap-2">
            <OmImage v-for="(img, i) in r.images" :key="i" :src="img" :alt="`리뷰 사진 ${Number(i) + 1}`" ratio="h-16 w-16 rounded-lg border border-line" />
          </div>
          <div v-if="r.reply" class="rounded-xl bg-surface-2 p-3 text-xs">
            <p class="font-bold text-ink">판매자 답글</p>
            <p class="mt-1 text-ink-muted">{{ r.reply.body }}</p>
          </div>
        </li>
      </ul>
      <OmEmptyState
        v-if="tab === 'written' && written.length === 0"
        title="작성한 리뷰가 없습니다"
        description="구매한 상품에 첫 리뷰를 남겨 보세요."
      >
        <RouterLink to="/orders" class="rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-on hover:bg-primary-hover">주문 내역 보기</RouterLink>
      </OmEmptyState>
    </div>
  </MyLayout>
</template>
