<script setup lang="ts">
// Seller product list (4-2): status tabs, server search, one row per product
// with summed stock, row actions and bulk ops. Paging and filters run on the
// server; the table groups the returned SKU rows by product.
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { API_BASE_URL, STOREFRONT_URL, getPartnerHeaders } from '../../config'
import { userErrorMessage, useConfirm, useToast, OmDataTable, OmStatusTabs, OmSkeleton, OmBulkActionBar, OmSearchFilterBar, OmDateRangePicker, OmModal } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const router = useRouter()
const route = useRoute()

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
const fShipping = ref('')
const fIdentifiers = ref('')

// Bulk value forms.
const bulkPriceMode = ref('set')
const bulkPriceValue = ref('')
const bulkStockValue = ref('')
// 6-11: unassigned-product list + bulk assignment.
const policies = ref<any[]>([])
const bulkPolicyId = ref('')

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
        status: r.status, review_status: r.review_status, created_at: r.created_at, skus: [],
        shipping_policy_id: r.shipping_policy_id || null, description_html: r.description_html,
        notice_info_json: r.notice_info_json, brand: r.brand, hs_code: r.hs_code,
        country_origin: r.country_origin, kc_cert_number: r.kc_cert_number,
        identifiers_missing: Number(r.identifiers_missing) || 0
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
    if (fShipping.value) params.set('shipping', fShipping.value)
    if (fIdentifiers.value) params.set('identifiers', fIdentifiers.value)
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
  fQ.value = ''; fCategory.value = ''; fRange.value = ['', '']; fStockMin.value = ''; fStockMax.value = ''; fShipping.value = ''; fIdentifiers.value = ''
  page.value = 1; void load()
}

// 6-12: identifier backfill (missing list + CSV upload).
const idModalOpen = ref(false)
const idCsvText = ref('')
const idFileName = ref('')
const idApplying = ref(false)
const idResult = ref<any>(null)
const idError = ref('')
const ID_CSV_TEMPLATE = 'product_id,sku_id,brand,manufacturer,model_name,gtin,gtin_exempt_reason\nprod_001,sku_001,Acme,,,5901234123457,\nprod_001,sku_002,Acme,,,96385074,'
function downloadIdTemplate() {
  const blob = new Blob(['\uFEFF' + ID_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'olmoa_identifiers_template.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}
async function onIdFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  idFileName.value = f.name
  idCsvText.value = await f.text()
}
function parseIdCsv() {
  const lines = idCsvText.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim())
  const byProduct = new Map<string, any>()
  for (let i = 1; i < lines.length; i++) {
    const vals = (lines[i].match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || []).map((v) => v.trim().replace(/^"|"$/g, ''))
    const row: any = {}
    headers.forEach((h, idx) => { row[h] = vals[idx] || '' })
    if (!row.product_id) continue
    if (!byProduct.has(row.product_id)) byProduct.set(row.product_id, { product_id: row.product_id, skus: [] })
    const item = byProduct.get(row.product_id)
    if (row.brand) item.brand = row.brand
    if (row.manufacturer) item.manufacturer = row.manufacturer
    if (row.model_name) item.model_name = row.model_name
    if (row.sku_id) {
      item.skus.push({
        sku_id: row.sku_id,
        ...(row.gtin ? { gtin: row.gtin } : {}),
        ...(!row.gtin && row.gtin_exempt_reason ? { gtin_exempt_reason: row.gtin_exempt_reason } : {})
      })
    }
  }
  return [...byProduct.values()]
}
async function applyIdentifiers() {
  idError.value = ''
  idResult.value = null
  const items = parseIdCsv()
  if (!items.length) { idError.value = 'CSV에서 입력할 행을 찾지 못했습니다. 템플릿 양식에 맞게 작성해 주세요.'; return }
  idApplying.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/products/identifiers`, {
      method: 'POST', headers: getPartnerHeaders(), body: JSON.stringify({ items })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || '일괄 입력에 실패했습니다.')
    idResult.value = json.data || json
    void load()
  } catch (e: any) {
    idError.value = userErrorMessage(e, U)
  } finally {
    idApplying.value = false
  }
}

async function loadPolicies() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/shipping-policies`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => null)
    if (res.ok && json?.success && Array.isArray(json.data)) {
      policies.value = json.data
      const def = policies.value.find((p: any) => Number(p.is_default) === 1) || policies.value[0]
      if (def && !bulkPolicyId.value) bulkPolicyId.value = def.id
    }
  } catch { /* bulk assign stays unavailable */ }
}

async function bulkAssignPolicy() {
  const ids = selected.value.map(String)
  if (!ids.length) return
  if (!bulkPolicyId.value) { toastApi.error('지정할 배송정책을 선택해 주세요.'); return }
  if (!(await askConfirm({ title: '배송정책 일괄 지정', body: `${ids.length}개 상품에 선택한 배송정책을 지정합니다.` }))) return
  const res = await fetch(`${API_BASE_URL}/api/v1/partner/products/bulk-update`, {
    method: 'PUT', headers: getPartnerHeaders(),
    body: JSON.stringify({ updates: ids.map((product_id) => ({ product_id, shipping_policy_id: bulkPolicyId.value })) })
  })
  reportBulk(await res.json().catch(() => ({})), '배송정책 지정')
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
  if (!p.shipping_policy_id) { toastApi.error('배송정책이 지정되지 않은 상품은 복제할 수 없습니다. 먼저 배송정책을 지정해 주세요.'); return }
  const res = await fetch(`${API_BASE_URL}/api/v1/partner/products`, {
    method: 'POST', headers: getPartnerHeaders(),
    body: JSON.stringify({
      title: `${p.title} (복제)`, category_id: p.category_id, thumbnail_url: p.thumbnail_url,
      description_html: p.description_html, notice_info_json: p.notice_info_json, brand: p.brand,
      hs_code: p.hs_code, country_origin: p.country_origin, kc_cert_number: p.kc_cert_number,
      shipping_policy_id: p.shipping_policy_id,
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

onMounted(() => {
  // Dashboard notice link: /products?shipping=unassigned opens the bulk-assign list.
  const ship = String(route.query.shipping || '')
  if (ship === 'unassigned' || ship === 'assigned') fShipping.value = ship
  loadCategories(); loadPolicies(); void load()
})
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-bold text-ink">상품 목록</h1>
      <div class="flex gap-2">
        <button type="button" class="rounded-xl border border-line px-4 py-2 text-xs font-bold text-ink hover:bg-surface-2" @click="exportCsv">현재 목록 CSV 저장</button>
        <button type="button" class="rounded-xl border border-line px-4 py-2 text-xs font-bold text-ink hover:bg-surface-2" @click="idModalOpen = true; idResult = null; idError = ''">식별정보 일괄 입력</button>
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
        <div class="col-span-2"><OmDateRangePicker v-model="fRange" /></div>
        <div class="flex gap-1">
          <input v-model="fStockMin" type="number" min="0" placeholder="재고≥" aria-label="최소 재고" class="h-9 w-full rounded-lg border border-line bg-surface px-2 text-ink" />
          <input v-model="fStockMax" type="number" min="0" placeholder="≤" aria-label="최대 재고" class="h-9 w-full rounded-lg border border-line bg-surface px-2 text-ink" />
        </div>
        <select v-model="fShipping" aria-label="배송정책 지정 여부" class="h-9 rounded-lg border border-line bg-surface px-2 text-ink">
          <option value="">배송정책 전체</option>
          <option value="unassigned">배송정책 미지정</option>
          <option value="assigned">배송정책 지정됨</option>
        </select>
        <select v-model="fIdentifiers" aria-label="식별정보 완성 여부" class="h-9 rounded-lg border border-line bg-surface px-2 text-ink">
          <option value="">식별정보 전체</option>
          <option value="missing">식별정보 누락</option>
          <option value="complete">식별정보 완성</option>
        </select>
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
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="row.status === 'ACTIVE' ? 'bg-success-soft text-success' : row.status === 'HIDDEN' ? 'bg-surface-3 text-ink-muted' : 'bg-warning-soft text-warning'">{{ STATUS_LABEL[row.status] || row.status }}</span>
          <span v-if="!row.shipping_policy_id" class="ml-1 rounded-full bg-danger-soft px-2 py-0.5 text-2xs font-bold text-danger whitespace-nowrap">배송정책 미지정</span>
          <span v-if="Number(row.identifiers_missing) === 1" class="ml-1 rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-bold text-warning whitespace-nowrap">식별정보 누락</span>
        </template>
        <template #cell-review="{ row }">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="row.review_status === 'APPROVED' ? 'bg-success-soft text-success' : row.review_status === 'REJECTED' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'">{{ REVIEW_LABEL[row.review_status] || row.review_status }}</span>
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

    <OmModal v-model:open="idModalOpen" title="식별정보 일괄 입력">
      <div class="space-y-3 text-xs">
        <p class="text-ink-muted">CSV 컬럼: <span class="font-mono">product_id,sku_id,brand,manufacturer,model_name,gtin,gtin_exempt_reason</span> (최대 500행, 행별 적용/실패 분리)</p>
        <div class="flex gap-2">
          <button type="button" class="rounded-lg border border-line px-3 py-1.5 font-bold text-ink hover:bg-surface-2" @click="downloadIdTemplate">템플릿 받기</button>
          <label class="cursor-pointer rounded-lg bg-secondary px-3 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover">CSV 선택
            <input type="file" accept=".csv" class="hidden" @change="onIdFile" />
          </label>
          <span v-if="idFileName" class="self-center text-ink-muted">{{ idFileName }}</span>
        </div>
        <textarea v-model="idCsvText" rows="6" placeholder="또는 CSV 내용을 여기에 붙여넣기" aria-label="식별정보 CSV" class="w-full rounded-lg border border-line bg-surface p-3 font-mono text-ink" />
        <p v-if="idError" role="alert" class="font-bold text-danger">{{ idError }}</p>
        <div v-if="idResult" class="space-y-1">
          <p class="font-bold text-ink">적용 {{ idResult.applied?.length ?? 0 }}건 · 실패 {{ idResult.failed?.length ?? 0 }}건</p>
          <ul v-if="(idResult.failed || []).length" class="max-h-32 space-y-0.5 overflow-y-auto text-danger">
            <li v-for="(f, i) in idResult.failed" :key="i">{{ f.row }}행({{ f.product_id }}): {{ f.error }}</li>
          </ul>
          <ul v-if="(idResult.applied || []).flatMap((a: any) => a.warnings || []).length" class="max-h-32 space-y-0.5 overflow-y-auto text-warning">
            <li v-for="(w, i) in (idResult.applied || []).flatMap((a: any) => a.warnings || [])" :key="i">{{ w.message }}</li>
          </ul>
        </div>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="idModalOpen = false">닫기</button>
        <button type="button" :disabled="idApplying || !idCsvText.trim()" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="applyIdentifiers">{{ idApplying ? '적용 중…' : '일괄 적용' }}</button>
      </template>
    </OmModal>

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
      <span class="flex items-center gap-1 text-xs">
        <select v-model="bulkPolicyId" aria-label="일괄 지정 배송정책" class="h-8 max-w-44 rounded-lg border border-line bg-surface px-2 font-bold text-ink">
          <option value="" disabled>배송정책 선택</option>
          <option v-for="p in policies" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <button type="button" class="h-8 rounded-lg bg-secondary px-3 font-bold text-secondary-on hover:bg-secondary-hover" @click="bulkAssignPolicy">배송정책 지정</button>
      </span>
    </OmBulkActionBar>
  </div>
</template>
