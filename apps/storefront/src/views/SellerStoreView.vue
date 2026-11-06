<script setup lang="ts">
// Seller store (PHASE 2 redesign). /partners/:id/store — only APPROVED sellers have a public store (404 otherwise).
// The store endpoint does not return per-product shipping fields, so the seller's own policy is applied to each
// card (otherwise ProductCard would fall back to the 3,000 / 30,000 defaults and could show free shipping wrongly).
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Store } from 'lucide-vue-next'
import { OmBreadcrumb, OmBadge, OmSkeleton, OmEmptyState, OmErrorState, OmButton, formatNumber, formatDate } from '@olmoa/ui'
import ProductCard from '../components/ProductCard.vue'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL } from '../config'

const route = useRoute()
const locale = useLocaleStore()
const store = ref<any>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)
const notFound = ref(false)

let seq = 0
async function load() {
  const my = ++seq
  loading.value = true
  loadError.value = null
  notFound.value = false
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partners/${encodeURIComponent(String(route.params.id))}/store`)
    const json = await res.json().catch(() => null)
    if (my !== seq) return
    if (res.status === 404) { notFound.value = true; store.value = null; return }
    if (!res.ok || !json?.success) throw new Error(json?.error || `스토어를 불러오지 못했습니다 (${res.status})`)
    store.value = json.data
  } catch (e: any) {
    if (my === seq) loadError.value = e?.message || '스토어를 불러오지 못했습니다'
  } finally {
    if (my === seq) loading.value = false
  }
}
onMounted(load)
watch(() => route.params.id, load)

const policy = computed(() => store.value?.shipping_policy || {})
const products = computed(() =>
  (store.value?.products || []).map((p: any) => ({
    ...p,
    business_name: store.value.partner.company_name,
    base_shipping_fee: policy.value.base_fee,
    free_shipping_threshold: policy.value.free_shipping_threshold
  }))
)
const m = computed(() => store.value?.metrics || {})
</script>

<template>
  <div class="mx-auto max-w-container px-4 py-6 sm:px-6">
    <OmBreadcrumb :items="[{ label: '홈', to: '/' }, { label: store?.partner?.company_name || '판매자 스토어' }]" />

    <div v-if="loading" class="mt-3 space-y-6">
      <OmSkeleton variant="rect" height="h-36" />
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"><OmSkeleton variant="card" :count="5" /></div>
    </div>
    <OmEmptyState v-else-if="notFound" class="mt-6" title="스토어를 찾을 수 없습니다" description="심사를 통과하지 않았거나 운영이 중단된 판매자입니다.">
      <OmButton to="/" variant="outline" size="sm">홈으로</OmButton>
    </OmEmptyState>
    <OmErrorState v-else-if="loadError" class="mt-6" :message="loadError" @retry="load" />

    <template v-else-if="store">
      <header class="mt-3 grid gap-5 rounded-xl border border-line bg-surface p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
        <div class="flex items-start gap-4">
          <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary" aria-hidden="true"><Store class="h-7 w-7" /></span>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-2xl font-bold text-ink">{{ store.partner.company_name }}</h1>
              <OmBadge tone="success">입점 심사 승인</OmBadge>
            </div>
            <dl class="mt-2 grid gap-x-4 gap-y-1 text-sm text-ink-muted sm:grid-cols-[auto_1fr]">
              <template v-if="store.partner.business_number"><dt class="text-ink-subtle">사업자등록번호</dt><dd>{{ store.partner.business_number }}</dd></template>
              <dt class="text-ink-subtle">배송비</dt>
              <dd>
                {{ Number(policy.base_fee) === 0 ? '무료' : locale.formatPrice(policy.base_fee ?? 3000) }}
                <template v-if="Number(policy.base_fee) !== 0 && Number(policy.free_shipping_threshold) > 0"> · 이 판매자 상품 {{ locale.formatPrice(policy.free_shipping_threshold) }} 이상 구매 시 무료</template>
              </dd>
              <template v-if="store.partner.created_at"><dt class="text-ink-subtle">입점일</dt><dd>{{ formatDate(store.partner.created_at) }}</dd></template>
            </dl>
          </div>
        </div>
        <dl class="grid grid-cols-3 gap-2 text-center">
          <div class="rounded-lg bg-surface-2 px-4 py-3">
            <dt class="text-2xs text-ink-muted">스토어 평점</dt>
            <dd class="mt-0.5 text-lg font-bold text-ink">{{ m.review_count > 0 && m.avg_rating != null ? Number(m.avg_rating).toFixed(1) : '-' }}</dd>
            <dd class="text-2xs text-ink-subtle">{{ m.review_count > 0 ? `후기 ${formatNumber(m.review_count)}개` : '후기 없음' }}</dd>
          </div>
          <div class="rounded-lg bg-surface-2 px-4 py-3">
            <dt class="text-2xs text-ink-muted">판매 중 상품</dt>
            <dd class="mt-0.5 text-lg font-bold text-ink">{{ formatNumber(m.product_count) }}</dd>
          </div>
          <div class="rounded-lg bg-surface-2 px-4 py-3">
            <dt class="text-2xs text-ink-muted">누적 주문 수량</dt>
            <dd class="mt-0.5 text-lg font-bold text-ink">{{ formatNumber(m.total_sold || 0) }}</dd>
          </div>
        </dl>
      </header>

      <section class="mt-8" aria-labelledby="store-products">
        <h2 id="store-products" class="mb-4 text-xl font-bold text-ink">판매 중인 상품</h2>
        <OmEmptyState v-if="!products.length" title="판매 중인 상품이 없습니다" compact />
        <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          <ProductCard v-for="(p, i) in products" :key="p.id" :product="p" :eager="i < 5" />
        </div>
      </section>
    </template>
  </div>
</template>
