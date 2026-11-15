<script setup lang="ts">
// Seller product list (4-2): status tabs, server search, one row per product
// with summed stock, row actions and bulk ops. Paging and filters run on the
// server; the table groups the returned SKU rows by product.
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { API_BASE_URL, STOREFRONT_URL, getPartnerHeaders } from '../../config'
import { userErrorMessage, useConfirm, useToast, OmDataTable, OmStatusTabs, OmSkeleton, OmBulkActionBar, OmSearchFilterBar, OmDateRangePicker } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const router = useRouter()

const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const PER_PAGE = 30
const TABS = [
  { value: 'ALL', label: '전체' },
  { value: 'ACTIVE', label: '판매중' },
  { value: 'SOLDOUT', label: '품절' },
  { value: 'PENDING', label: '승인대기' },
  { value: 'REJECTED', label: '반려' },
  { value: 'HIDDEN', label: '판매중지' }
]

const tab = ref('ALL')
const page = ref(1)
const total = ref(0)
const rows = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const selected = ref<(string | number)[]>([])
const categories = ref<any[]>([])

// Search form (applied on button, not keystroke).
const fQ = ref('')
const fCategory = ref('')
const fRange = ref<[string, string]>(['', ''])
const fStockMin = ref('')
const fStockMax = ref('')

// Bulk value forms.
const bulkPriceMode = ref('set')
const bulkPriceValue = ref('')
const bulkStockValue = ref('')

const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`
const STATUS_LABEL: Record<string, string> = { ACTIVE: '판매중', HIDDEN: '판매중지', DRAFT: '작성중', DELETED: '삭제됨' }
const REVIEW_LABEL: Record<string, string> = { PENDING: '심사중', APPROVED: '승인됨', REJECTED: '반려' }

const products = computed(() => {
  const map = new Map<string, any>()
  for (const r of rows.value) {
    if (!map.has(r.id)) {
      map.set(r.id, {
        id: r.id, title: r.title, thumbnail_url: r.thumbnail_url, category_name: r.category_name,
        category_id: r.category_id, lowest_sale_price: r.lowest_sale_price, stock_sum: 0,
        status: r.status, review_status: r.review_status, created_at: r.created_at, skus: []
      })
    }
    const p = map.get(r.id)
    if (r.sku_id) {
      p.stock_sum += Number(r.stock_quantity) || 0
      p.skus.push(r)
    }
  }
  return [...map.values()]
})

const columns = [
  { key: 'thumb', label: '이미지', width: '64px' },
  { key: 'name', label: '상품명', primary: true },
  { key: 'category', label: '카테고리', mobileHidden: true },
  { key: 'price', label: '판매가', align: 'right' as const },
  { key: 'stock', label: '재고합계', align: 'right' as const },
  { key: 'status', label: '상태' },
  { key: 'review', label: '심사', mobileHidden: true },
  { key: 'created', label: '등록일', mobileHidden: true }
]

async function loadCategories() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/categories`)
    const json = await res.json().catch(() => null)
    if (res.ok && json?.success && Array.isArray(json.data)) categories.value = json.data
  } catch { /* search still works without the directory */ }
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const params = new URLSearchParams({ status: tab.value, page: String(page.value), per_page: String(PER_PAGE) })
    if (fQ.value.trim()) params.set('q', fQ.value.trim())
    if (fCategory.value) params.set('category', fCategory.value)
    if (fRange.value[0]) params.set('from', fRange.value[0])
    if (fRange.value[1]) params.set('to', fRange.value[1])
    if (fStockMin.value !== '') params.set('stock_min', fStockMin.value)
    if (fStockMax.value !== '') params.set('stock_max', fStockMax.value)
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/products?${params}`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '상품 목록을 불러오지 못했습니다.')
    rows.value = Array.isArray(json.data) ? json.data : []
    total.value = json.pagination?.total ?? rows.value.length
    selected.value = []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

function applySearch() { page.value = 1; void load() }
function resetSearch() {
  fQ.value = ''; fCategory.value = ''; fRange.value = ['', '']; fStockMin.value = ''; fStockMax.value = ''
  page.value = 1; void load()
}
watch(tab, () => { page.value = 1; void load() })
watch(page, () => void load())

async function bulkStatus(status: 'HIDDEN' | 'ACTIVE') {
  const ids = selected.value.map(String)
  if (!ids.length) return
  const label = status === 'HIDDEN' ? '판매중지' : '판매 재개'
  if (!(await askConfirm({ title: `선택 ${label}`, body: `${ids.length}개 상품을 ${label}합니다.${status === 'ACTIVE' ? ' 심사 승인된 상품만 재개됩니다.' : ''}`, danger: status === 'HIDDEN' }))) return
  const res = await fetch(`${API_BASE_URL}/api/v1/partner/products/bulk-update`, {
    method: 'PUT', headers: getPartnerHeaders(),
    body: JSON.stringify({ updates: ids.map((product_id) => ({ product_id, status })) })
  })
  const json = await res.json().catch(() => ({}))
  reportBulk(json, label)
}

async function bulkPrice() {
  const ids = selected.value.map(String)
  const value = Number(bulkPriceValue.value)
  if (!ids.length || !Number.isInteger(value)) { toastApi.error('가격 값을 정수로 입력해 주세요.'); return }
  if (!(await askConfirm({ title: '가격 일괄 변경', body: `${ids.length}개 상품의 전 옵션 가격을 변경합니다.`, danger: true }))) return
  const res = await fetch(`${API_BASE_URL}/api/v1/partner/products/bulk-update`, {
    method: 'PUT', headers: getPartnerHeaders(),
    body: JSON.stringify({ updates: ids.map((product_id) => ({ product_id, price: { mode: bulkPriceMode.value, value } })) })
  })
  reportBulk(await res.json().catch(() => ({})), '가격 변경')
}

async function bulkStock() {
  const ids = selected.value.map(String)
  const value = Number(bulkStockValue.value)
  if (!ids.length || !Number.isInteger(value) || value < 0) { toastApi.error('재고를 0 이상의 정수로 입력해 주세요.'); return }
  if (!(await askConfirm({ title: '재고 일괄 변경', body: `${ids.length}개 상품의 전 옵션 재고를 ${value}개로 맞춥니다.`, danger: true }))) return
  const res = await fetch(`${API_BASE_URL}/api/v1/partner/products/bulk-update`, {
    method: 'PUT', headers: getPartnerHeaders(),
    body: JSON.stringify({ updates: ids.map((product_id) => ({ product_id, stock_quantity: value })) })
  })
  reportBulk(await res.json().catch(() => ({})), '재고 변경')
}

function reportBulk(json: any, label: string) {
  const ok = json.updated_count ?? 0
  const fail = json.failed_count ?? 0
  if (fail === 0) toastApi.success(`${label} 완료 (${ok}개)`)
  else toastApi.error(`${label} 부분 실패 — 성공 ${ok}개, 실패 ${fail}개${json.data?.failed?.[0] ? `: ${json.data.failed[0].error}` : ''}`)
  void load()
}

async function cloneProduct(p: any) {
  if (!(await askConfirm({ title: '상품 복제', body: `“${p.title}”을(를) 복제합니다. 복제본은 심사 대기 상태로 등록됩니다.` }))) return
  const skus = (p.skus || []).map((s: any) => {
    let combo: any = { 옵션: '기본' }
    try { combo = JSON.parse(s.option_combination_json || '{}') } catch { /* keep default */ }
    return { option_combination: combo, original_price: s.sku_original_price ?? s.original_price, sale_price: s.sale_price, stock_quantity: s.stock_quantity ?? 0 }
  })
  const res = await fetch(`${API_BASE_URL}/api/v1/partner/products`, {
    method: 'POST', headers: getPartnerHeaders(),
    body: JSON.stringify({
      title: `${p.title} (복제)`, category_id: p.category_id, thumbnail_url: p.thumbnail_url,
      description_html: p.description_html, notice_info_json: p.notice_info_json, brand: p.brand,
      hs_code: p.hs_code, country_origin: p.country_origin, kc_cert_number: p.kc_cert_number,
      skus: skus.length ? skus : [{ option_combination: { 옵션: '기본' }, sale_price: p.lowest_sale_price, stock_quantity: 0 }]
    })
  })
  const json = await res.json().catch(() => ({}))
  if (res.ok && json.success) { toastApi.success('복제본이 심사 대기 상태로 등록되었습니다.'); void load() }
  else toastApi.error(json.error || '복제에 실패했습니다.')
}

const csvCell = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
function exportCsv() {
  const head = ['상품ID', '상품명', '카테고리', '판매가', '재고합계', '상태', '심사', '등록일']
  const lines = [head.map(csvCell).join(',')]
  for (const p of products.value) {
    lines.push([p.id, p.title, p.category_name, p.lowest_sale_price, p.stock_sum, STATUS_LABEL[p.status] || p.status, REVIEW_LABEL[p.review_status] || p.review_status, p.created_at].map(csvCell).join(','))
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `products-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

onMounted(() => { loadCategories(); void load() })
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-bold text-ink">상품 목록</h1>
      <div class="flex gap-2">
        <button type="button" class="rounded-xl border border-line px-4 py-2 text-xs font-bold text-ink hover:bg-surface-2" @click="exportCsv">현재 목록 CSV 저장</button>
        <button type="button" class="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="router.push('/products/new')">상품 등록</button>
      </div>
    </div>

    <OmStatusTabs v-model="tab" :tabs="TABS.map((t) => ({ value: t.value, label: t.label }))" />

    <OmSearchFilterBar title="상품 검색">
      <div class="grid grid-cols-2 gap-2 text-xs md:grid-cols-6">
        <input v-model="fQ" placeholder="상품명·ID·SKU 검색" aria-label="키워드 검색" class="h-9 rounded-lg border border-line bg-surface px-3 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus md:col-span-2" @keyup.enter="applySearch" />
        <select v-model="fCategory" aria-label="카테고리" class="h-9 rounded-lg border border-line bg-surface px-2 text-ink">
          <option value="">전체 카테고리</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <div class="md:col-span-2"><OmDateRangePicker v-model="fRange" /></div>
        <div class="flex gap-1">
          <input v-model="fStockMin" type="number" min="0" placeholder="재고≥" aria-label="최소 재고" class="h-9 w-full rounded-lg border border-line bg-surface px-2 text-ink" />
          <input v-model="fStockMax" type="number" min="0" placeholder="≤" aria-label="최대 재고" class="h-9 w-full rounded-lg border border-line bg-surface px-2 text-ink" />
        </div>
      </div>
      <template #actions>
        <button type="button" class="h-9 rounded-lg border border-line px-4 font-bold text-ink-muted hover:bg-surface-2" @click="resetSearch">초기화</button>
        <button type="button" class="h-9 rounded-lg bg-secondary px-4 font-bold text-secondary-on hover:bg-secondary-hover" @click="applySearch">검색</button>
      </template>
    </OmSearchFilterBar>

    <div v-if="loading && !products.length" data-loading class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">상품을 불러오는 중입니다...</p>
      <OmSkeleton variant="row" :count="6" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="load">다시 불러오기</button>
    </div>
    <div v-else data-row>
      <OmDataTable
        :columns="columns"
        :rows="products"
        row-key="id"
        v-model:page="page"
        :total="total"
        :page-size="PER_PAGE"
        :loading="loading"
        selectable
        v-model:selected="selected"
        empty-title="등록된 상품이 없습니다"
        empty-description="상품을 등록하면 이곳에 표시됩니다."
      >
        <template #empty>
          <span data-empty class="hidden" aria-hidden="true" />
          <button type="button" class="rounded-full bg-primary px-5 py-2.5 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="router.push('/products/new')">상품 등록</button>
        </template>
        <template #cell-thumb="{ row }">
          <img v-if="row.thumbnail_url" :src="row.thumbnail_url" :alt="row.title" loading="lazy" decoding="async" class="h-10 w-10 rounded-lg border border-line object-cover" />
          <span v-else class="block h-10 w-10 rounded-lg bg-surface-3" />
        </template>
        <template #cell-name="{ row }">
          <div class="min-w-0">
            <p class="truncate font-bold text-ink">{{ row.title }}</p>
            <p class="om-num truncate text-2xs text-ink-subtle">{{ row.id }}</p>
            <a :href="`${STOREFRONT_URL}/product/${row.id}`" target="_blank" rel="noopener" class="text-2xs font-bold text-primary hover:underline">스토어 미리보기</a>
          </div>
        </template>
        <template #cell-category="{ row }"><span class="text-ink-muted">{{ row.category_name || '-' }}</span></template>
        <template #cell-price="{ row }"><span class="om-num font-bold text-ink">{{ won(row.lowest_sale_price) }}</span></template>
        <template #cell-stock="{ row }"><span class="om-num font-bold" :class="Number(row.stock_sum) > 0 ? 'text-ink' : 'text-danger'">{{ Number(row.stock_sum).toLocaleString('ko-KR') }}</span></template>
        <template #cell-status="{ row }">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold" :class="row.status === 'ACTIVE' ? 'bg-success-soft text-success' : row.status === 'HIDDEN' ? 'bg-surface-3 text-ink-muted' : 'bg-warning-soft text-warning'">{{ STATUS_LABEL[row.status] || row.status }}</span>
        </template>
        <template #cell-review="{ row }">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold" :class="row.review_status === 'APPROVED' ? 'bg-success-soft text-success' : row.review_status === 'REJECTED' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'">{{ REVIEW_LABEL[row.review_status] || row.review_status }}</span>
        </template>
        <template #cell-created="{ row }"><span class="om-num text-ink-muted">{{ String(row.created_at || '').slice(0, 10) }}</span></template>
        <template #actions="{ row }">
          <div class="flex gap-1">
            <button type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2" @click="router.push(`/products/${row.id}/edit`)">수정</button>
            <button type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2" @click="cloneProduct(row)">복제</button>
          </div>
        </template>
      </OmDataTable>
    </div>

    <OmBulkActionBar :count="selected.length" @clear="selected = []">
      <button type="button" class="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-ink hover:bg-surface-2" @click="bulkStatus('HIDDEN')">판매중지</button>
      <button type="button" class="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-ink hover:bg-surface-2" @click="bulkStatus('ACTIVE')">판매 재개</button>
      <span class="flex items-center gap-1 text-xs">
        <select v-model="bulkPriceMode" aria-label="가격 변경 방식" class="h-8 rounded-lg border border-line bg-surface px-2 font-bold text-ink">
          <option value="set">지정가</option>
          <option value="ratio">비율%</option>
          <option value="delta">증감액</option>
        </select>
        <input v-model="bulkPriceValue" type="number" placeholder="값" aria-label="가격 값" class="h-8 w-24 rounded-lg border border-line bg-surface px-2 text-ink" />
        <button type="button" class="h-8 rounded-lg bg-secondary px-3 font-bold text-secondary-on hover:bg-secondary-hover" @click="bulkPrice">가격 적용</button>
      </span>
      <span class="flex items-center gap-1 text-xs">
        <input v-model="bulkStockValue" type="number" min="0" placeholder="재고" aria-label="재고 값" class="h-8 w-20 rounded-lg border border-line bg-surface px-2 text-ink" />
        <button type="button" class="h-8 rounded-lg bg-secondary px-3 font-bold text-secondary-on hover:bg-secondary-hover" @click="bulkStock">재고 적용</button>
      </span>
    </OmBulkActionBar>
  </div>
</template>
