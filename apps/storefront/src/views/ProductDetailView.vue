<script setup lang="ts">
// Product detail (3-4): 7:5 desktop split, gallery + photo strip + sticky
// section tabs on the left, sticky buy panel on the right, mobile bottom bar
// with a buy sheet. Prices, shipping, notice and review figures all come from
// the server; the order sheet re-checks everything.
import { ref, computed, watch, nextTick } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { Heart } from 'lucide-vue-next'
import { OmBreadcrumb, OmButton, OmIconButton, OmSkeleton, OmErrorState, OmEmptyState, OmModal, OmImageGallery, OmStickyTabs, OmKeyTakeaways, OmSpecTable, OmFaq, userErrorMessage, formatNumber, applyRouteHead, injectJsonLd } from '@olmoa/ui'
import { productHeadOf, productJsonLdOf, qaPageJsonLdOf, galleryAltOf } from '../lib/productSeo'
import ReviewsPanel from '../components/product/ReviewsPanel.vue'
import QnaPanel from '../components/product/QnaPanel.vue'
import ReviewHighlights from '../components/product/ReviewHighlights.vue'
import BuyPanel from '../components/product/BuyPanel.vue'
import MobileBuySheet from '../components/product/MobileBuySheet.vue'
import ProductCard from '../components/ProductCard.vue'
import { useBuySelection } from '../components/product/useBuySelection'
import { API_BASE_URL } from '../config'
import { RETURN_WINDOW_DAYS } from '../config/policy'

const route = useRoute()

const product = ref<any>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)
const notFound = ref(false)
const showVideo = ref(false)
const showSheet = ref(false)
const descOpen = ref(false)
const photoStrip = ref<any[]>([])
const reviewSummary = ref<{ count: number; average: number | null }>({ count: 0, average: null })
const qnaCount = ref(0)
const related = ref<any[]>([])

const skus = computed<any[]>(() => product.value?.skus || [])
const sel = useBuySelection(product, skus)
const loginTo = computed(() => `/login?redirect=${encodeURIComponent(route.fullPath)}`)

function recordRecentVisit(p: any) {
  try {
    const key = 'olmoa_recent_products'
    const raw: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    const list = (Array.isArray(raw) ? raw : []).filter((e: any) => e && typeof e.id === 'string' && e.id !== p.id)
    list.unshift({ id: p.id, title: p.title || '', thumb: p.thumbnail_url || '', at: Date.now() })
    localStorage.setItem(key, JSON.stringify(list.slice(0, 50)))
  } catch { /* storage unavailable: rail simply shows less */ }
}

let seq = 0
async function load() {
  const my = ++seq
  loading.value = true
  loadError.value = null
  notFound.value = false
  descOpen.value = false
  photoStrip.value = []
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${encodeURIComponent(String(route.params.slug))}`)
    const json = await res.json().catch(() => null)
    if (my !== seq) return
    if (res.status === 404) { notFound.value = true; product.value = null; document.getElementById('olmoa-jsonld-product')?.remove(); document.getElementById('olmoa-jsonld-qa')?.remove(); return }
    if (!res.ok || !json?.success) throw new Error(json?.error || `상품을 불러오지 못했습니다`)
    product.value = json.data
    recordRecentVisit(json.data)
    applyProductHead(json.data)
    if (route.hash === '#reviews') {
      await nextTick()
      gotoReviews()
    }
    reviewSummary.value = { count: Number(json.data.review_count || 0), average: json.data.avg_rating ?? null }
    qnaCount.value = Number(json.data.qna_count || 0)
    sel.checkSurge(json.data.id)
    loadPhotos(json.data.id)
    loadRelated(json.data.id)
  } catch (e: any) {
    if (my === seq) { loadError.value = userErrorMessage(e, '상품을 불러오지 못했습니다'); document.getElementById('olmoa-jsonld-product')?.remove(); document.getElementById('olmoa-jsonld-qa')?.remove() }
  } finally {
    if (my === seq) loading.value = false
  }
}

// ---- SEO: per-product head + Product/Offer/Breadcrumb/QAPage JSON-LD (live rows only) ----------------
function applyProductHead(p: any) {
  const origin = window.location.origin
  applyRouteHead(productHeadOf(p, route.path, origin))
  injectJsonLd('olmoa-jsonld-product', productJsonLdOf(p, `${origin}${route.path}`, { windowDays: RETURN_WINDOW_DAYS }))
  const qa = qaPageJsonLdOf(`${origin}${route.path}`, p?.brief?.qna)
  if (qa) injectJsonLd('olmoa-jsonld-qa', qa)
  else document.getElementById('olmoa-jsonld-qa')?.remove()
}

async function loadPhotos(id: string) {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${encodeURIComponent(id)}/reviews?photos_only=true&per_page=8`)
    const json = await res.json().catch(() => null)
    if (product.value?.id !== id) return
    if (!res.ok || !json?.success) return
    const out: any[] = []
    for (const r of json.data?.reviews || []) {
      for (const src of r.images || []) {
        if (typeof src === 'string' && (src.startsWith('https://') || (src.startsWith('/') && !src.startsWith('//')))) out.push(src)
        if (out.length >= 8) break
      }
      if (out.length >= 8) break
    }
    photoStrip.value = out
  } catch { /* strip stays hidden */ }
}

async function loadRelated(id: string) {
  related.value = []
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/recommendations/related?product_id=${encodeURIComponent(id)}&limit=8`)
    const j = await res.json().catch(() => null)
    if (product.value?.id !== id) return
    if (!res.ok || !j?.success || !Array.isArray(j.data)) return
    related.value = j.data
  } catch { /* section stays hidden */ }
}

// ---- description: strip active content (server stores seller HTML) ---------------------------------
const descriptionHtml = computed(() => {
  const raw = String(product.value?.description_html || '')
  return raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<\/?(iframe|object|embed|form|link|meta|style|base)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*(javascript|vbscript|data:text\/html)[^"']*\2/gi, '$1="#"')
})

// ---- notice table in template order; seller blanks read "상세페이지 참조" -----------------------------
const noticeRows = computed<[string, string][]>(() => {
  let items: any[] = []
  try {
    const raw = product.value?.notice_template?.items_json
    items = typeof raw === 'string' ? JSON.parse(raw) : (raw || [])
  } catch { items = [] }
  const vals = product.value?.notice_values && typeof product.value.notice_values === 'object' ? product.value.notice_values : {}
  const rows: [string, string][] = !items.length
    ? Object.entries(vals).map(([k, v]): [string, string] => [String(k), String(v ?? '')]).filter(([k, v]) => k !== '' && v !== '')
    : items.map((it): [string, string] => {
      const v = vals[it.key]
      return [String(it.label || it.key), v == null || String(v).trim() === '' ? '상세페이지 참조' : String(v)]
    })
  // NEW-11/12: certified products always show their KC row with the cert number.
  if (Number(product.value?.kc_certified) === 1) {
    const no = String(product.value?.kc_cert_number || '').trim()
    rows.push(['KC 인증', no ? `인증 대상 제품 (${no})` : '인증 대상 제품'])
  }
  return rows
})

const galleryImages = computed(() => {
  const rows = Array.isArray(product.value?.images) ? product.value.images : []
  const skus = Array.isArray(product.value?.skus) ? product.value.skus : []
  // 6-8: stored seller alt wins; otherwise product name + live options + position.
  if (rows.length) return rows.map((im: any, i: number) => ({
    src: im.image_url, alt: String(im.alt_text || '').trim() || galleryAltOf(product.value?.title, skus, i, rows.length)
  }))
  if (product.value?.thumbnail_url) return [{ src: product.value.thumbnail_url, alt: galleryAltOf(product.value?.title, skus, 0, 1) }]
  return []
})

const crumbs = computed(() => [
  { label: '홈', to: '/' },
  ...(product.value?.category_slug ? [{ label: product.value.category_name, to: `/category/${product.value.category_slug}` }] : []),
  { label: product.value?.title || '상품' }
])

const sectionTabs = computed(() => [
  { id: 'sec-info', label: '상품정보' },
  { id: 'sec-reviews', label: `리뷰(${formatNumber(reviewSummary.value.count)})` },
  { id: 'sec-qna', label: `문의(${formatNumber(qnaCount.value)})` },
  { id: 'sec-shipping', label: '배송/교환/반품' }
])
const activeSection = ref('sec-info')
function gotoReviews() {
  document.getElementById('sec-reviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const shipPolicy = computed(() => product.value?.shipping_policy || null)
const shipMethodLabel: Record<string, string> = { PARCEL: '택배', DIRECT: '직접 전달', OVERSEAS: '해외 배송' }

watch(() => route.params.slug, load, { immediate: true })
watch(() => route.hash, () => { if (route.hash === '#reviews') gotoReviews() })
</script>

<template>
  <div class="mx-auto max-w-container px-4 pb-28 pt-4 sm:px-6 lg:pb-12">
    <div v-if="loading">
      <OmSkeleton variant="detail" />
    </div>
    <OmEmptyState v-else-if="notFound" class="mt-8" title="상품을 찾을 수 없습니다" description="삭제되었거나 주소가 잘못되었습니다.">
      <OmButton to="/" variant="outline" size="sm">홈으로</OmButton>
    </OmEmptyState>
    <OmErrorState v-else-if="loadError" class="mt-8" :message="loadError" @retry="load" />

    <template v-else-if="product">
      <OmBreadcrumb :items="crumbs" />

      <div class="mt-3 grid gap-8 lg:grid-cols-[7fr_5fr] xl:gap-12">
        <!-- left (scroll) --------------------------------------------------------------------------------- -->
        <div class="min-w-0">
          <OmImageGallery :images="galleryImages" />
          <OmButton v-if="product.video_url" variant="outline" size="sm" block class="mt-3" @click="showVideo = true">판매자 등록 영상 보기</OmButton>

          <div v-if="photoStrip.length" class="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="포토 후기 미리보기">
            <button
              v-for="(src, i) in photoStrip"
              :key="i"
              type="button"
              class="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              :aria-label="`포토 후기 ${i + 1} 보기`"
              @click="gotoReviews"
            >
              <img :src="src" :alt="`포토 후기 ${i + 1}`" class="h-full w-full object-cover" loading="lazy" decoding="async" />
            </button>
          </div>

          <OmStickyTabs v-model="activeSection" :tabs="sectionTabs" offset-top="64px" />

          <section v-if="product.key_facts_html" aria-label="핵심 정보" class="mt-6 rounded-2xl border border-line bg-surface p-5">
            <h2 class="mb-3 text-base font-bold text-ink">핵심 정보</h2>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="key-facts text-sm" v-html="product.key_facts_html"></div>
          </section>

          <section v-if="product.brief" aria-label="상품 요약" class="mt-6 space-y-4">
            <OmKeyTakeaways :items="(product.brief.facts || []).map((f: any) => `${f.label}: ${f.value}`)" heading="핵심 정보" />
            <OmSpecTable v-if="(product.brief.specs || []).length" :rows="product.brief.specs" caption="스펙" />
            <OmFaq v-if="(product.brief.qna || []).length" :items="product.brief.qna" heading="Q&A 요약" />
          </section>

          <section id="sec-info" class="scroll-mt-32 pt-6" aria-label="상품정보">
            <div v-if="noticeRows.length" class="mb-8 overflow-x-auto">
              <h3 class="mb-2 text-md font-bold text-ink">상품정보제공고시</h3>
              <table class="w-full border-collapse text-sm">
                <tbody>
                  <tr v-for="[k, v] in noticeRows" :key="k" class="border-t border-line-divider">
                    <th scope="row" class="w-40 bg-surface-2 px-3 py-2 text-left font-medium text-ink-muted">{{ k }}</th>
                    <td class="px-3 py-2 text-ink">{{ v }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="descriptionHtml.trim()">
              <div :class="descOpen ? '' : 'max-h-[1200px] overflow-hidden'">
                <!-- eslint-disable-next-line vue/no-v-html -- seller HTML, active content stripped above -->
                <div class="om-prose text-md leading-relaxed text-ink [&_img]:mx-auto [&_img]:h-auto [&_img]:max-w-full" v-html="descriptionHtml" />
              </div>
              <OmButton variant="outline" size="sm" class="mt-3" :aria-expanded="descOpen" @click="descOpen = !descOpen">
                {{ descOpen ? '접기' : '상세 설명 더보기' }}
              </OmButton>
            </div>
            <OmEmptyState v-else compact title="판매자가 등록한 상세 설명이 없습니다" />
          </section>

          <section id="sec-reviews" class="scroll-mt-32 pt-10" aria-label="리뷰">
            <h3 class="mb-3 text-lg font-bold text-ink">리뷰 ({{ formatNumber(reviewSummary.count) }})</h3>
            <ReviewHighlights :product-id="product.id" />
            <div class="mt-6">
              <ReviewsPanel :product-id="product.id" :login-to="loginTo" @summary="reviewSummary = $event" />
            </div>
          </section>

          <section id="sec-qna" class="scroll-mt-32 pt-10" aria-label="문의">
            <h3 class="mb-3 text-lg font-bold text-ink">문의 ({{ formatNumber(qnaCount) }})</h3>
            <QnaPanel :product-id="product.id" :login-to="loginTo" @count="qnaCount = $event" />
          </section>

          <section id="sec-shipping" class="scroll-mt-32 pt-10" aria-label="배송/교환/반품">
            <h3 class="mb-3 text-lg font-bold text-ink">배송/교환/반품</h3>
            <table v-if="shipPolicy" class="w-full border-collapse text-sm">
              <tbody>
                <tr class="border-t border-line-divider">
                  <th scope="row" class="w-40 bg-surface-2 px-3 py-2 text-left font-medium text-ink-muted">배송방법</th>
                  <td class="px-3 py-2 text-ink">{{ shipMethodLabel[shipPolicy.method] || shipPolicy.method }}</td>
                </tr>
                <tr class="border-t border-line-divider">
                  <th scope="row" class="w-40 bg-surface-2 px-3 py-2 text-left font-medium text-ink-muted">배송비</th>
                  <td class="px-3 py-2 text-ink">{{ Number(shipPolicy.base_fee) === 0 ? '무료' : `${formatNumber(shipPolicy.base_fee)}원` }}</td>
                </tr>
                <tr v-if="Number(shipPolicy.free_threshold) > 0" class="border-t border-line-divider">
                  <th scope="row" class="w-40 bg-surface-2 px-3 py-2 text-left font-medium text-ink-muted">무료 조건</th>
                  <td class="px-3 py-2 text-ink">{{ formatNumber(shipPolicy.free_threshold) }}원 이상 구매 시 무료</td>
                </tr>
                <tr v-if="shipPolicy.remote_surcharge !== null && shipPolicy.remote_surcharge !== undefined" class="border-t border-line-divider">
                  <th scope="row" class="w-40 bg-surface-2 px-3 py-2 text-left font-medium text-ink-muted">도서산간 추가비</th>
                  <td class="px-3 py-2 text-ink">{{ formatNumber(shipPolicy.remote_surcharge) }}원</td>
                </tr>
                <tr class="border-t border-line-divider">
                  <th scope="row" class="w-40 bg-surface-2 px-3 py-2 text-left font-medium text-ink-muted">출고 소요일</th>
                  <td class="px-3 py-2 text-ink">{{ shipPolicy.processing_days }}일</td>
                </tr>
                <tr class="border-t border-line-divider">
                  <th scope="row" class="w-40 bg-surface-2 px-3 py-2 text-left font-medium text-ink-muted">반품·교환 배송비</th>
                  <td class="px-3 py-2 text-ink">반품 {{ formatNumber(shipPolicy.return_fee) }}원 · 교환 {{ formatNumber(shipPolicy.exchange_fee) }}원</td>
                </tr>
                <tr v-if="shipPolicy.return_address" class="border-t border-line-divider">
                  <th scope="row" class="w-40 bg-surface-2 px-3 py-2 text-left font-medium text-ink-muted">반품지</th>
                  <td class="px-3 py-2 text-ink">{{ shipPolicy.return_address }}</td>
                </tr>
                <tr class="border-t border-line-divider">
                  <th scope="row" class="w-40 bg-surface-2 px-3 py-2 text-left font-medium text-ink-muted">청약철회 제한</th>
                  <td class="px-3 py-2 text-ink">주문제작·신선식품·개봉 시 가치 상실 상품 등은 철회가 제한됩니다. <RouterLink to="/legal/refund" class="underline underline-offset-2">자세히</RouterLink></td>
                </tr>
              </tbody>
            </table>
            <p v-else class="text-sm text-ink-muted">판매자가 등록한 배송 정책이 없습니다. 반품은 배송 완료 후 {{ RETURN_WINDOW_DAYS }}일 이내에 신청할 수 있습니다.</p>
          </section>

          <section v-if="related.length" class="mt-12" aria-labelledby="related-heading">
            <h2 id="related-heading" class="mb-4 text-lg font-bold">연관 상품</h2>
            <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <li v-for="p in related" :key="p.id"><ProductCard :product="p" /></li>
            </ul>
          </section>
        </div>

        <!-- right (sticky buy panel) ------------------------------------------------------------------------ -->
        <div class="hidden min-w-0 lg:block">
          <div class="sticky top-24">
            <BuyPanel :product="product" :sel="sel" @reviews="gotoReviews" />
          </div>
        </div>
      </div>

      <!-- mobile purchase bar ------------------------------------------------------------------------------- -->
      <div class="fixed inset-x-0 bottom-0 z-sticky flex items-center gap-2 border-t border-line bg-surface/95 px-3 pt-2 backdrop-blur lg:hidden" style="padding-bottom: max(0.5rem, env(safe-area-inset-bottom))">
        <OmIconButton :label="sel.wished ? '찜 해제' : '찜하기'" variant="outline" @click="sel.toggleWish">
          <Heart class="h-5 w-5" :class="sel.wished ? 'fill-accent text-accent' : ''" />
        </OmIconButton>
        <OmButton variant="primary" class="flex-1" data-testid="mobile-buy" @click="showSheet = true">구매하기</OmButton>
      </div>
      <MobileBuySheet v-model:open="showSheet" :product="product" :sel="sel" />

      <OmModal v-if="product.video_url" v-model:open="showVideo" title="판매자 등록 영상" size="lg">
        <video v-if="showVideo" :src="product.video_url" controls playsinline class="aspect-video w-full rounded bg-overlay" />
      </OmModal>
    </template>
  </div>
</template>

<style scoped>
/* 6-4: server-rendered key-facts <dl> (same markup the Edge summary_html reuses). */
.key-facts :deep(dl) {
  display: grid;
  gap: 0.5rem 1rem;
}
.key-facts :deep(dl > div) {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid rgb(var(--om-divider));
}
.key-facts :deep(dl > div:last-child) {
  border-bottom: 0;
}
.key-facts :deep(dt) {
  color: rgb(var(--om-text-muted));
  flex-shrink: 0;
}
.key-facts :deep(dd) {
  margin: 0;
  text-align: right;
  color: rgb(var(--om-text));
  font-weight: 600;
}
</style>
