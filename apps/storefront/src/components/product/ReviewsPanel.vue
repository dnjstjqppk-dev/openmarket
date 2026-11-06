<script setup lang="ts">
// Product reviews: list + summary from GET /products/:id/reviews; writing via POST, which the server allows only
// to a buyer with a delivered, not fully refunded order of this product (403 otherwise) and once per order.
// The reviewer name is masked by the server; the buyer must pick the rating (no pre-selected 5 stars).
import { ref, computed, watch } from 'vue'
import { Star } from 'lucide-vue-next'
import { OmButton, OmTextarea, OmEmptyState, OmErrorState, OmSkeleton, OmBadge, OmAlert, useToast, formatDate, formatNumber } from '@olmoa/ui'
import { useAuthStore } from '../../stores/auth'
import { API_BASE_URL, authHeader } from '../../config'

const props = defineProps<{ productId: string; loginTo: string }>()
const emit = defineEmits<{ summary: [{ count: number; average: number | null }] }>()
const auth = useAuthStore()
const toast = useToast()

const reviews = ref<any[]>([])
const average = ref<number | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)
const fit = ref<'ALL' | 'TRUE_TO_SIZE' | 'RUNS_SMALL' | 'RUNS_LARGE'>('ALL')
const FIT_LABEL: Record<string, string> = { TRUE_TO_SIZE: '정사이즈', RUNS_SMALL: '작게 나옴', RUNS_LARGE: '크게 나옴' }

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${encodeURIComponent(props.productId)}/reviews`)
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || `후기를 불러오지 못했습니다 (${res.status})`)
    reviews.value = Array.isArray(json.data) ? json.data : json.data?.reviews || []
    average.value = json.avg_rating ?? json.data?.summary?.average_rating ?? null
    emit('summary', { count: reviews.value.length, average: reviews.value.length ? average.value : null })
  } catch (e: any) {
    loadError.value = e?.message || '후기를 불러오지 못했습니다'
  } finally {
    loading.value = false
  }
}
watch(() => props.productId, load, { immediate: true })

const hasFit = computed(() => reviews.value.some((r) => r.fit_type && r.user_height_cm))
const fitCounts = computed(() => {
  const c: Record<string, number> = {}
  for (const r of reviews.value) if (r.fit_type) c[r.fit_type] = (c[r.fit_type] || 0) + 1
  return c
})
const visible = computed(() => (fit.value === 'ALL' ? reviews.value : reviews.value.filter((r) => r.fit_type === fit.value)))
const distribution = computed(() => [5, 4, 3, 2, 1].map((n) => {
  const count = reviews.value.filter((r) => Math.round(Number(r.rating)) === n).length
  return { n, count, pct: reviews.value.length ? Math.round((count * 100) / reviews.value.length) : 0 }
}))

// ---- write ------------------------------------------------------------------------------------------
const formOpen = ref(false)
const rating = ref<number | null>(null)
const content = ref('')
const height = ref<string>('')
const weight = ref<string>('')
const fitInput = ref<'' | 'TRUE_TO_SIZE' | 'RUNS_SMALL' | 'RUNS_LARGE'>('')
const submitting = ref(false)
const formError = ref<string | null>(null)

async function submit() {
  formError.value = null
  if (!rating.value) { formError.value = '별점을 선택해 주세요.'; return }
  if (!content.value.trim()) { formError.value = '후기 내용을 입력해 주세요.'; return }
  submitting.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${encodeURIComponent(props.productId)}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        rating: rating.value,
        content: content.value.trim(),
        user_height_cm: height.value ? Number(height.value) : null,
        user_weight_kg: weight.value ? Number(weight.value) : null,
        fit_type: fitInput.value || null
      })
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || `등록하지 못했습니다 (${res.status})`)
    toast.success('후기를 등록했습니다.')
    formOpen.value = false
    rating.value = null; content.value = ''; height.value = ''; weight.value = ''; fitInput.value = ''
    await load()
  } catch (e: any) {
    formError.value = e?.message || '등록하지 못했습니다'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div>
    <div v-if="loading" class="space-y-4"><OmSkeleton :lines="3" :count="3" /></div>
    <OmErrorState v-else-if="loadError" compact :message="loadError" @retry="load" />
    <template v-else>
      <div class="grid gap-6 md:grid-cols-[220px_1fr]">
        <div>
          <p class="text-4xl font-bold text-ink">{{ reviews.length && average != null ? Number(average).toFixed(1) : '-' }}</p>
          <p class="mt-1 text-sm text-ink-muted">{{ reviews.length ? `후기 ${formatNumber(reviews.length)}개` : '아직 후기가 없습니다' }}</p>
          <ul v-if="reviews.length" class="mt-3 space-y-1">
            <li v-for="d in distribution" :key="d.n" class="flex items-center gap-2 text-2xs text-ink-muted">
              <span class="w-6 tabular-nums">{{ d.n }}점</span>
              <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"><span class="block h-full rounded-full bg-highlight" :style="{ width: `${d.pct}%` }" /></span>
              <span class="w-6 text-right tabular-nums">{{ d.count }}</span>
            </li>
          </ul>
        </div>

        <div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div v-if="hasFit" class="flex flex-wrap gap-1.5" role="group" aria-label="사이즈 후기 필터">
              <button
                v-for="k in (['ALL', 'TRUE_TO_SIZE', 'RUNS_SMALL', 'RUNS_LARGE'] as const)"
                :key="k"
                type="button"
                :aria-pressed="fit === k"
                class="rounded-full border px-3 py-1 text-xs"
                :class="fit === k ? 'border-secondary bg-secondary text-secondary-on' : 'border-line text-ink hover:border-line-strong'"
                @click="fit = k"
              >{{ k === 'ALL' ? '전체' : FIT_LABEL[k] }}<span v-if="k !== 'ALL'" class="ml-1 tabular-nums opacity-70">{{ fitCounts[k] || 0 }}</span></button>
            </div>
            <span v-else />
            <OmButton v-if="auth.isAuthenticated" size="sm" variant="outline" @click="formOpen = !formOpen">{{ formOpen ? '작성 취소' : '후기 작성' }}</OmButton>
            <OmButton v-else size="sm" variant="ghost" :to="loginTo">로그인하고 후기 작성</OmButton>
          </div>

          <form v-if="formOpen" class="mt-4 space-y-3 rounded-lg border border-line bg-surface-2 p-4" @submit.prevent="submit">
            <p class="text-xs text-ink-muted">배송 완료된 주문이 있는 구매자만 주문당 한 번 작성할 수 있습니다. 작성자 이름은 일부 가려서 표시됩니다.</p>
            <fieldset>
              <legend class="mb-1 text-sm font-medium text-ink">별점 <span class="text-danger">*</span></legend>
              <div class="flex gap-1" role="radiogroup" aria-label="별점">
                <button
                  v-for="n in 5"
                  :key="n"
                  type="button"
                  role="radio"
                  :aria-checked="rating === n"
                  :aria-label="`${n}점`"
                  class="rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  @click="rating = n"
                ><Star class="h-7 w-7" :class="rating && n <= rating ? 'fill-highlight text-highlight' : 'text-line-strong'" /></button>
              </div>
            </fieldset>
            <OmTextarea v-model="content" label="후기 내용" required :rows="4" :maxlength="3000" placeholder="상품을 사용해 본 경험을 알려 주세요." />
            <details class="text-sm">
              <summary class="cursor-pointer text-ink-muted">체형·사이즈 정보 추가 (선택)</summary>
              <div class="mt-2 grid grid-cols-3 gap-2">
                <label class="text-xs text-ink-muted">키(cm)<input v-model="height" type="number" min="100" max="230" class="mt-1 h-9 w-full rounded border border-line bg-surface px-2 text-sm text-ink" /></label>
                <label class="text-xs text-ink-muted">몸무게(kg)<input v-model="weight" type="number" min="20" max="200" class="mt-1 h-9 w-full rounded border border-line bg-surface px-2 text-sm text-ink" /></label>
                <label class="text-xs text-ink-muted">사이즈
                  <select v-model="fitInput" class="mt-1 h-9 w-full rounded border border-line bg-surface px-2 text-sm text-ink">
                    <option value="">선택 안 함</option><option value="TRUE_TO_SIZE">정사이즈</option><option value="RUNS_SMALL">작게 나옴</option><option value="RUNS_LARGE">크게 나옴</option>
                  </select>
                </label>
              </div>
            </details>
            <OmAlert v-if="formError" tone="danger">{{ formError }}</OmAlert>
            <div class="flex justify-end"><OmButton type="submit" :loading="submitting">등록</OmButton></div>
          </form>

          <OmEmptyState v-if="!reviews.length" class="mt-4" compact title="아직 작성된 후기가 없습니다" description="배송 완료 후 구매자가 후기를 남길 수 있습니다." />
          <OmEmptyState v-else-if="!visible.length" class="mt-4" compact title="선택한 사이즈 후기가 없습니다" />
          <ul v-else class="mt-4 divide-y divide-line-divider">
            <li v-for="r in visible" :key="r.id" class="py-4">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span class="inline-flex" :aria-label="`별점 ${r.rating}점`">
                  <Star v-for="n in 5" :key="n" class="h-3.5 w-3.5" :class="n <= Math.round(Number(r.rating)) ? 'fill-highlight text-highlight' : 'text-line-strong'" aria-hidden="true" />
                </span>
                <span class="font-medium text-ink">{{ r.reviewer_name || r.customer_name || '구매자' }}</span>
                <OmBadge v-if="Number(r.is_verified_purchase) === 1 && r.order_id" tone="success">구매 확인</OmBadge>
                <span class="text-ink-subtle">{{ formatDate(r.created_at) }}</span>
              </div>
              <p v-if="r.sku_option_summary" class="mt-1 text-2xs text-ink-subtle">옵션: {{ r.sku_option_summary }}</p>
              <p v-if="r.user_height_cm || r.fit_type" class="mt-1 text-2xs text-ink-muted">
                <template v-if="r.user_height_cm">{{ r.user_height_cm }}cm</template><template v-if="r.user_weight_kg"> · {{ r.user_weight_kg }}kg</template><template v-if="r.fit_type"> · {{ FIT_LABEL[r.fit_type] || r.fit_type }}</template>
              </p>
              <p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">{{ r.content || r.comment }}</p>
              <div v-if="r.images?.length" class="mt-2 flex gap-2">
                <img v-for="(src, i) in r.images.slice(0, 4)" :key="i" :src="src" :alt="`후기 사진 ${i + 1}`" class="h-20 w-20 rounded object-cover" loading="lazy" />
              </div>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </div>
</template>
