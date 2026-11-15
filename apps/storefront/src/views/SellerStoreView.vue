<script setup lang="ts">
// Seller store (3-10): banner header with follow, home/products/reviews/info
// tabs, and the cart free-shipping fill section (?first_min=).
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { Store } from 'lucide-vue-next'
import { userErrorMessage, OmBreadcrumb, OmBadge, OmSkeleton, OmEmptyState, OmErrorState, OmButton, OmStatusTabs, OmImage, formatNumber } from '@olmoa/ui'
import ProductCard from '../components/ProductCard.vue'
import PlpLayout from '../components/plp/PlpLayout.vue'
import { useAuthStore } from '../stores/auth'
import { API_BASE_URL, authHeader } from '../config'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const store = ref<any>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)
const notFound = ref(false)
const tab = ref('home')
const followBusy = ref(false)
const followError = ref('')

const partnerId = computed(() => String(route.params.id))
const fillMin = computed(() => {
  const n = Number(route.query.first_min)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
})

let seq = 0
async function load() {
  const my = ++seq
  loading.value = true
  loadError.value = null
  notFound.value = false
  followError.value = ''
  try {
    const headers: Record<string, string> = auth.isAuthenticated ? { ...authHeader() } : {}
    const res = await fetch(`${API_BASE_URL}/api/v1/partners/${encodeURIComponent(partnerId.value)}/store`, { headers })
    const json = await res.json().catch(() => null)
    if (my !== seq) return
    if (res.status === 404) { notFound.value = true; store.value = null; return }
    if (!res.ok || !json?.success) throw new Error(json?.error || `스토어를 불러오지 못했습니다`)
    store.value = json.data
  } catch (e: any) {
    if (my === seq) loadError.value = userErrorMessage(e, '스토어를 불러오지 못했습니다')
  } finally {
    if (my === seq) loading.value = false
  }
}
onMounted(load)
watch(() => route.params.id, () => { tab.value = 'home'; reviewsLoaded.value = false; load() })

const policy = computed(() => store.value?.shipping_policy || {})
const freeThreshold = computed(() => policy.value.free_threshold ?? policy.value.free_shipping_threshold ?? 0)
const products = computed(() =>
  (store.value?.products || []).map((p: any) => ({
    ...p,
    business_name: store.value.partner.company_name,
    base_shipping_fee: policy.value.base_fee,
    free_shipping_threshold: freeThreshold.value
  }))
)
const m = computed(() => store.value?.metrics || {})
const stats = computed(() => store.value?.stats || {})
const profile = computed(() => store.value?.profile || {})

const featured = computed(() => {
  let ids: string[] = []
  try {
    const raw = JSON.parse(profile.value.featured_product_ids_json || '[]')
    if (Array.isArray(raw)) ids = raw.map(String)
  } catch { /* unconfigured or corrupt: fall back to best sellers */ }
  const byId = new Map(products.value.map((p: any) => [String(p.id), p]))
  const picked = ids.map((id) => byId.get(id)).filter(Boolean)
  return (picked.length ? picked : products.value).slice(0, 8)
})

const fillProducts = computed(() => {
  if (fillMin.value === null) return []
  return products.value
    .filter((p: any) => Number(p.lowest_sale_price) >= (fillMin.value as number))
    .sort((a: any, b: any) => Number(a.lowest_sale_price) - Number(b.lowest_sale_price))
})

async function toggleFollow() {
  if (!auth.isAuthenticated) {
    router.push({ path: '/login', query: { redirect: route.fullPath } })
    return
  }
  followBusy.value = true
  followError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/stores/${encodeURIComponent(partnerId.value)}/follow`, {
      method: store.value.following ? 'DELETE' : 'POST',
      headers: { ...authHeader() }
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || '팔로우 처리에 실패했습니다.')
    await load()
  } catch (e: any) {
    followError.value = userErrorMessage(e, '팔로우 처리에 실패했습니다.')
  } finally {
    followBusy.value = false
  }
}

// ---- reviews tab (lazy) -----------------------------------------------------------------
const reviews = ref<any[]>([])
const reviewsPage = ref(1)
const reviewsPages = ref(1)
const reviewsLoading = ref(false)
const reviewsError = ref('')
const reviewsLoaded = ref(false)

async function loadReviews(page: number) {
  reviewsLoading.value = true
  reviewsError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/stores/${encodeURIComponent(partnerId.value)}/reviews?page=${page}&per_page=10`)
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '리뷰를 불러오지 못했습니다.')
    reviews.value = page === 1 ? json.data.reviews : [...reviews.value, ...json.data.reviews]
    reviewsPage.value = json.data.pagination.page
    reviewsPages.value = json.data.pagination.total_pages
    reviewsLoaded.value = true
  } catch (e: any) {
    reviewsError.value = userErrorMessage(e, '리뷰를 불러오지 못했습니다.')
  } finally {
    reviewsLoading.value = false
  }
}
watch(tab, (t) => { if (t === 'reviews' && !reviewsLoaded.value) void loadReviews(1) })

const METHOD_LABEL: Record<string, string> = { PARCEL: '택배', DIRECT: '직접배송', OVERSEAS: '해외배송' }
const formatDateOnly = (dStr?: string) => {
  if (!dStr) return '-'
  const d = new Date(dStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}
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
      <header class="mt-3 overflow-hidden rounded-xl border border-line bg-surface">
        <img
          v-if="profile.banner_url"
          :src="profile.banner_url"
          :alt="`${store.partner.company_name} 배너`"
          fetchpriority="high"
          class="h-36 w-full object-cover sm:h-44"
        />
        <div v-else class="h-24 bg-surface-2 sm:h-28" aria-hidden="true" />
        <div class="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div class="flex items-start gap-4">
            <img
              v-if="profile.logo_url"
              :src="profile.logo_url"
              :alt="`${store.partner.company_name} 로고`"
              loading="eager"
              decoding="async"
              class="h-14 w-14 shrink-0 rounded-lg border border-line object-cover"
            />
            <span v-else class="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary" aria-hidden="true"><Store class="h-7 w-7" /></span>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h1 class="text-2xl font-bold text-ink">{{ store.partner.company_name }}</h1>
                <OmBadge v-if="stats.grade" tone="primary">{{ stats.grade }} 등급</OmBadge>
              </div>
              <p v-if="profile.intro" class="mt-1 text-sm text-ink-muted">{{ profile.intro }}</p>
              <p class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
                <span v-if="m.review_count > 0">평점 {{ Number(m.avg_rating).toFixed(1) }} · 후기 {{ formatNumber(m.review_count) }}개</span>
                <span v-else>아직 후기가 없습니다</span>
                <span data-testid="follower-count">팔로워 {{ formatNumber(stats.followers || 0) }}명</span>
              </p>
              <p v-if="followError" role="alert" class="mt-2 text-xs font-bold text-danger">{{ followError }}</p>
            </div>
          </div>
          <div class="flex gap-2">
            <OmButton size="sm" :variant="store.following ? 'outline' : 'primary'" :disabled="followBusy" data-testid="follow-toggle" @click="toggleFollow">
              {{ store.following ? '팔로잉' : '팔로우' }}
            </OmButton>
            <OmButton size="sm" variant="outline" to="/support">문의하기</OmButton>
          </div>
        </div>
      </header>

      <div class="mt-6">
        <OmStatusTabs
          v-model="tab"
          :tabs="[
            { value: 'home', label: '홈' },
            { value: 'products', label: '전체상품', count: stats.product_count },
            { value: 'reviews', label: '리뷰', count: m.review_count },
            { value: 'info', label: '스토어 정보' }
          ]"
        />
      </div>

      <!-- Home: fill section, notice, featured -->
      <div v-if="tab === 'home'" class="mt-6 space-y-8">
        <section v-if="fillMin !== null" aria-label="무료배송 채우기">
          <h2 class="mb-1 text-xl font-bold text-ink">이 상품을 담으면 무료배송</h2>
          <p class="mb-4 text-sm text-ink-muted">{{ formatNumber(fillMin) }}원 이상 상품부터 보여드립니다.</p>
          <OmEmptyState v-if="!fillProducts.length" :title="`${formatNumber(fillMin)}원 이상 상품이 없습니다`" compact />
          <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            <ProductCard v-for="(p, i) in fillProducts.slice(0, 8)" :key="p.id" :product="p" :eager="i < 5" />
          </div>
          <button
            v-if="fillProducts.length > 8"
            type="button"
            class="mt-3 text-sm font-bold text-primary hover:underline"
            @click="tab = 'products'"
          >
            외 {{ formatNumber(fillProducts.length - 8) }}개 전체상품에서 보기
          </button>
        </section>

        <section v-if="profile.notice" class="rounded-xl border border-line bg-surface p-5" aria-label="스토어 공지">
          <h2 class="mb-2 text-base font-bold text-ink">공지</h2>
          <p class="whitespace-pre-wrap text-sm text-ink-muted">{{ profile.notice }}</p>
        </section>

        <section aria-labelledby="store-featured">
          <h2 id="store-featured" class="mb-4 text-xl font-bold text-ink">대표 상품</h2>
          <OmEmptyState v-if="!featured.length" title="판매 중인 상품이 없습니다" compact />
          <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            <ProductCard v-for="(p, i) in featured" :key="p.id" :product="p" :eager="i < 5" />
          </div>
        </section>
      </div>

      <!-- All products: shared PLP locked to this seller -->
      <div v-if="tab === 'products'" class="mt-6">
        <PlpLayout :locked-partner="partnerId" title="전체상품" />
      </div>

      <!-- Reviews -->
      <div v-if="tab === 'reviews'" class="mt-6 space-y-3">
        <div v-if="reviewsLoading && !reviews.length"><OmSkeleton variant="row" :count="4" /></div>
        <OmErrorState v-else-if="reviewsError && !reviews.length" :message="reviewsError" @retry="loadReviews(1)" />
        <template v-else>
          <ul v-if="reviews.length" class="space-y-3">
            <li v-for="r in reviews" :key="r.id" class="space-y-2 rounded-2xl border border-line bg-surface p-4">
              <div class="flex items-center gap-3">
                <OmImage :src="r.thumbnail_url" :alt="r.product_title" ratio="h-12 w-12 shrink-0 rounded-xl border border-line" />
                <div class="min-w-0">
                  <RouterLink :to="`/product/${r.product_id}`" class="block truncate text-sm font-bold text-ink hover:underline">{{ r.product_title }}</RouterLink>
                  <p class="mt-0.5 flex items-center gap-2 text-2xs text-ink-subtle">
                    <span :aria-label="`별점 ${r.rating}점`">
                      <span v-for="i in 5" :key="i" :class="i <= Number(r.rating) ? 'text-rating' : 'text-ink-subtle'">★</span>
                    </span>
                    <span>{{ r.customer_name }}</span>
                    <span class="om-num">{{ formatDateOnly(r.created_at) }}</span>
                  </p>
                </div>
              </div>
              <p class="whitespace-pre-wrap text-sm text-ink">{{ r.content }}</p>
              <div v-if="r.images && r.images.length" class="flex flex-wrap gap-2">
                <OmImage v-for="(img, i) in r.images" :key="i" :src="img" :alt="`리뷰 사진 ${i + 1}`" ratio="h-16 w-16 rounded-lg border border-line" />
              </div>
              <div v-if="r.reply" class="rounded-xl bg-surface-2 p-3 text-xs">
                <p class="font-bold text-ink">판매자 답글</p>
                <p class="mt-1 text-ink-muted">{{ r.reply.body }}</p>
              </div>
            </li>
          </ul>
          <OmEmptyState v-else title="아직 작성된 리뷰가 없습니다" compact />
          <div v-if="reviewsPage < reviewsPages" class="pt-2 text-center">
            <OmButton variant="outline" size="sm" :disabled="reviewsLoading" @click="loadReviews(reviewsPage + 1)">
              {{ reviewsLoading ? '불러오는 중...' : '리뷰 더 보기' }}
            </OmButton>
          </div>
        </template>
      </div>

      <!-- Store info: legal disclosure, return address, shipping policy -->
      <section v-if="tab === 'info'" class="mt-6 rounded-xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="store-seller-info">
        <h2 id="store-seller-info" class="mb-4 text-xl font-bold text-ink">판매자 정보</h2>
        <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div class="flex justify-between gap-4 border-b border-line-divider py-2"><dt class="text-ink-subtle">상호</dt><dd class="text-right text-ink">{{ store.partner.company_name }}</dd></div>
          <div class="flex justify-between gap-4 border-b border-line-divider py-2"><dt class="text-ink-subtle">대표자명</dt><dd class="text-right text-ink">{{ store.partner.representative_name || '미등록' }}</dd></div>
          <div class="flex justify-between gap-4 border-b border-line-divider py-2"><dt class="text-ink-subtle">사업자등록번호</dt><dd class="text-right text-ink">{{ store.partner.business_number || '미등록' }}</dd></div>
          <div class="flex justify-between gap-4 border-b border-line-divider py-2"><dt class="text-ink-subtle">통신판매업 신고번호</dt><dd class="text-right text-ink">{{ store.partner.mail_order_reg_number || '미등록' }}</dd></div>
          <div class="flex justify-between gap-4 border-b border-line-divider py-2"><dt class="text-ink-subtle">사업장 주소</dt><dd class="text-right text-ink">{{ store.partner.business_address || '미등록' }}</dd></div>
          <div class="flex justify-between gap-4 border-b border-line-divider py-2"><dt class="text-ink-subtle">고객센터 전화</dt><dd class="text-right text-ink">{{ store.partner.customer_service_phone || '미등록' }}</dd></div>
          <div class="flex justify-between gap-4 border-b border-line-divider py-2 sm:col-span-2"><dt class="text-ink-subtle">고객센터 이메일</dt><dd class="text-right text-ink">{{ store.partner.cs_email || '미등록' }}</dd></div>
        </dl>
        <h3 class="mb-2 mt-6 text-base font-bold text-ink">배송·반품 정책 ({{ policy.name || '기본 정책' }})</h3>
        <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div class="flex justify-between gap-4 border-b border-line-divider py-2"><dt class="text-ink-subtle">배송방법</dt><dd class="text-right text-ink">{{ METHOD_LABEL[policy.method] || '미등록' }}</dd></div>
          <div class="flex justify-between gap-4 border-b border-line-divider py-2"><dt class="text-ink-subtle">기본 배송비</dt><dd class="om-num text-right text-ink">{{ Number(policy.base_fee) === 0 ? '무료' : `${formatNumber(policy.base_fee)}원` }}</dd></div>
          <div class="flex justify-between gap-4 border-b border-line-divider py-2"><dt class="text-ink-subtle">무료배송 기준</dt><dd class="om-num text-right text-ink">{{ Number(freeThreshold) > 0 ? `${formatNumber(freeThreshold)}원 이상` : '없음' }}</dd></div>
          <div class="flex justify-between gap-4 border-b border-line-divider py-2"><dt class="text-ink-subtle">도서산간 추가비</dt><dd class="om-num text-right text-ink">{{ policy.remote_surcharge != null ? `${formatNumber(policy.remote_surcharge)}원` : '미등록' }}</dd></div>
          <div class="flex justify-between gap-4 border-b border-line-divider py-2"><dt class="text-ink-subtle">반품 배송비</dt><dd class="om-num text-right text-ink">{{ policy.return_fee != null ? `${formatNumber(policy.return_fee)}원` : '미등록' }}</dd></div>
          <div class="flex justify-between gap-4 border-b border-line-divider py-2"><dt class="text-ink-subtle">교환 배송비</dt><dd class="om-num text-right text-ink">{{ policy.exchange_fee != null ? `${formatNumber(policy.exchange_fee)}원` : '미등록' }}</dd></div>
          <div class="flex justify-between gap-4 border-b border-line-divider py-2"><dt class="text-ink-subtle">출고 소요일</dt><dd class="om-num text-right text-ink">{{ policy.processing_days != null ? `${policy.processing_days}일` : '미등록' }}</dd></div>
          <div class="flex justify-between gap-4 border-b border-line-divider py-2"><dt class="text-ink-subtle">오늘출발 마감</dt><dd class="om-num text-right text-ink">{{ policy.today_cutoff || '미등록' }}</dd></div>
          <div class="flex justify-between gap-4 border-b border-line-divider py-2 sm:col-span-2"><dt class="text-ink-subtle">반품지</dt><dd class="text-right text-ink">{{ policy.return_address || '미등록' }}</dd></div>
        </dl>
      </section>
    </template>
  </div>
</template>
