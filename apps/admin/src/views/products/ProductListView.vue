<script setup lang="ts">
// All-products console (4-14): seller/category/status/price/period filters,
// paging, CSV export and stop/resume.
import { ref, onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { adminApi, API_BASE_URL, getAdminHeaders } from '../../config'
import { userErrorMessage, useConfirm, useToast, OmDataTable, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const PER_PAGE = 50
const STATUS_LABEL: Record<string, string> = { ACTIVE: '판매중', HIDDEN: '판매 중지', DELETED: '삭제됨', DRAFT: '임시저장' }

const rows = ref<any[]>([])
const page = ref(1)
const total = ref(0)
const loading = ref(true)
const loadError = ref('')
const updatingId = ref<string | null>(null)
const sellers = ref<any[]>([])
const categories = ref<any[]>([])
const fSeller = ref('')
const fCategory = ref('')
const fStatus = ref('')
const fReview = ref('')
const fMin = ref('')
const fMax = ref('')
const fFrom = ref('')
const fTo = ref('')
const fShipping = ref('')
const fIdentifiers = ref('')

const columns = [
  { key: 'product', label: '상품', primary: true },
  { key: 'seller', label: '판매자', mobileHidden: true },
  { key: 'price', label: '판매가', align: 'right' as const },
  { key: 'stock', label: '재고', align: 'right' as const, mobileHidden: true },
  { key: 'status', label: '상태' }
]
const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`
const toastMsg = ref('')

function toast(msg: string, ms = 4000) {
  toastMsg.value = msg
  setTimeout(() => { toastMsg.value = '' }, ms)
}

function query(csv = false) {
  const params = new URLSearchParams({ page: String(page.value), per_page: String(PER_PAGE) })
  if (fSeller.value) params.set('partner_id', fSeller.value)
  if (fCategory.value) params.set('category', fCategory.value)
  if (fStatus.value) params.set('status', fStatus.value)
  if (fReview.value) params.set('review_status', fReview.value)
  if (fMin.value !== '') params.set('min_price', fMin.value)
  if (fMax.value !== '') params.set('max_price', fMax.value)
  if (fFrom.value) params.set('from', fFrom.value)
  if (fTo.value) params.set('to', fTo.value)
  if (fShipping.value) params.set('shipping', fShipping.value)
  if (fIdentifiers.value) params.set('identifiers', fIdentifiers.value)
  if (csv) params.set('format', 'csv')
  return params.toString()
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi(`/api/v1/admin/products?${query()}`)
    if (!r.ok) throw new Error(r.data.error || '상품 목록을 불러오지 못했습니다.')
    rows.value = Array.isArray(r.data.data) ? r.data.data : []
    total.value = r.data.pagination?.total ?? rows.value.length
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}
watch(page, () => void load())

async function loadRefs() {
  try {
    const [s, c] = await Promise.all([
      adminApi('/api/v1/admin/partners'),
      adminApi('/api/v1/categories')
    ])
    if (s.ok && Array.isArray(s.data.data)) sellers.value = s.data.data
    const flat: any[] = []
    const walk = (nodes: any[], depth: number) => {
      for (const n of nodes || []) {
        flat.push({ id: n.id, name: `${'—'.repeat(depth)} ${n.name}` })
        walk(n.children, depth + 1)
      }
    }
    walk(Array.isArray(c.data?.data) ? c.data.data : Array.isArray(c.data) ? c.data : [], 0)
    categories.value = flat
  } catch { /* filters stay empty */ }
}

async function exportCsv() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/products?${query(true)}`, { headers: getAdminHeaders() })
    if (!res.ok) throw new Error('CSV를 내려받지 못했습니다.')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'admin_products.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, 'CSV를 내려받지 못했습니다.'))
  }
}

async function updateStatus(p: any, newStatus: 'ACTIVE' | 'HIDDEN') {
  const label = newStatus === 'ACTIVE' ? '판매 재개(노출)' : '판매 중지(노출 중단)'
  if (!(await askConfirm({ title: '상품 상태 변경', body: `[${p.title}] 상품을 ${label} 처리합니다.`, danger: newStatus === 'HIDDEN' }))) return
  updatingId.value = p.id
  try {
    const r = await adminApi(`/api/v1/admin/products/${p.id}/status`, { method: 'PUT', json: { status: newStatus } })
    if (!r.ok) throw new Error(r.data.error || '상태를 변경하지 못했습니다. 잠시 후 다시 시도해주세요.')
    p.status = newStatus
    toast(`[${p.title}] ${label} 처리되었습니다.`, 3000)
  } catch (e: any) {
    toast(userErrorMessage(e, '요청 중 네트워크 오류가 발생했습니다. 다시 시도해 주세요.'))
  } finally {
    updatingId.value = null
  }
}

onMounted(() => { void load(); void loadRefs() })
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-ink">전체 상품</h1>
        <p class="mt-1 text-xs text-ink-muted">심사 대기 상품은 <RouterLink to="/products/review-queue" class="font-bold text-primary hover:underline">검수 대기열</RouterLink>에서 판정합니다.</p>
      </div>
      <button type="button" class="h-9 rounded-lg bg-secondary px-4 text-xs font-bold text-secondary-on hover:bg-secondary-hover" @click="exportCsv">CSV 내보내기</button>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <select v-model="fSeller" aria-label="판매자" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="page = 1; load()">
        <option value="">전체 판매자</option>
        <option v-for="s in sellers" :key="s.id" :value="s.id">{{ s.business_name }}</option>
      </select>
      <select v-model="fCategory" aria-label="카테고리" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="page = 1; load()">
        <option value="">전체 카테고리</option>
        <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <select v-model="fStatus" aria-label="판매 상태" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="page = 1; load()">
        <option value="">전체 상태</option>
        <option value="ACTIVE">판매중</option>
        <option value="HIDDEN">판매 중지</option>
        <option value="DELETED">삭제됨</option>
        <option value="DRAFT">임시저장</option>
      </select>
      <select v-model="fReview" aria-label="심사 상태" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="page = 1; load()">
        <option value="">전체 심사</option>
        <option value="PENDING">심사 대기</option>
        <option value="APPROVED">승인</option>
        <option value="REJECTED">반려</option>
      </select>
      <select v-model="fShipping" aria-label="배송정책 지정 여부" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="page = 1; load()">
        <option value="">배송정책 전체</option>
        <option value="unassigned">배송정책 미지정</option>
        <option value="assigned">배송정책 지정됨</option>
      </select>
      <select v-model="fIdentifiers" aria-label="식별정보 상태" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="page = 1; load()">
        <option value="">식별정보 전체</option>
        <option value="missing">식별정보 누락</option>
        <option value="conflict">바코드 중복</option>
        <option value="complete">식별정보 완성</option>
      </select>
      <input v-model="fMin" type="number" min="0" placeholder="최저가" aria-label="최저 판매가" class="h-9 w-28 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @keyup.enter="page = 1; load()" />
      <span class="text-xs text-ink-subtle">~</span>
      <input v-model="fMax" type="number" min="0" placeholder="최고가" aria-label="최고 판매가" class="h-9 w-28 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @keyup.enter="page = 1; load()" />
      <input v-model="fFrom" type="date" aria-label="등록 시작일" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="page = 1; load()" />
      <span class="text-xs text-ink-subtle">~</span>
      <input v-model="fTo" type="date" aria-label="등록 종료일" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="page = 1; load()" />
    </div>

    <div v-if="toastMsg" role="status" class="rounded-xl bg-secondary p-3 text-xs font-bold text-secondary-on">{{ toastMsg }}</div>

    <div v-if="loading && !rows.length" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="8" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="load">다시 불러오기</button>
    </div>
    <div v-else>
      <OmDataTable
        :columns="columns"
        :rows="rows"
        row-key="id"
        v-model:page="page"
        :total="total"
        :page-size="PER_PAGE"
        :loading="loading"
        empty-title="조건에 맞는 상품이 없습니다"
        empty-description="필터를 바꾸거나 잠시 후 다시 확인해 보세요."
      >
        <template #cell-product="{ row }">
          <div class="min-w-0">
            <p class="truncate font-bold text-ink">{{ row.title }}</p>
            <p class="mt-0.5 text-2xs text-ink-subtle">{{ row.category_name || '미분류' }} · SKU {{ row.sku_count || 1 }}개</p>
          </div>
        </template>
        <template #cell-seller="{ row }"><span class="text-ink-muted">{{ row.business_name || '직영점' }}</span></template>
        <template #cell-price="{ row }"><span class="om-num font-bold text-ink">{{ won(row.lowest_sale_price) }}</span></template>
        <template #cell-stock="{ row }"><span class="om-num" :class="Number(row.total_stock) <= 0 ? 'font-bold text-danger' : 'text-ink-muted'">{{ row.total_stock ?? 0 }}개</span></template>
        <template #cell-status="{ row }">
          <span v-if="row.review_status === 'PENDING'" class="rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-bold text-warning">심사 대기</span>
          <span v-else-if="row.review_status === 'REJECTED'" class="rounded-full bg-danger-soft px-2 py-0.5 text-2xs font-bold text-danger">반려</span>
          <span v-else class="rounded-full px-2 py-0.5 text-2xs font-bold" :class="row.status === 'ACTIVE' ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted'">{{ STATUS_LABEL[row.status] || row.status }}</span>
          <span v-if="!row.shipping_policy_id" class="ml-1 rounded-full bg-danger-soft px-2 py-0.5 text-2xs font-bold text-danger">배송정책 미지정</span>
          <span v-if="Number(row.identifiers_missing) === 1" class="ml-1 rounded-full bg-warning-soft px-2 py-0.5 text-2xs font-bold text-warning">식별정보 누락</span>
          <span v-if="Number(row.gtin_conflict) === 1" class="ml-1 rounded-full bg-danger-soft px-2 py-0.5 text-2xs font-bold text-danger">바코드 중복</span>
        </template>
        <template #actions="{ row }">
          <RouterLink v-if="row.review_status === 'PENDING'" to="/products/review-queue" class="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-on hover:bg-primary-hover">심사</RouterLink>
          <button v-else-if="row.status !== 'ACTIVE' && row.review_status === 'APPROVED'" type="button" :disabled="updatingId === row.id" class="rounded-lg bg-success px-2.5 py-1.5 text-xs font-bold text-primary-on disabled:opacity-50" @click="updateStatus(row, 'ACTIVE')">판매 재개</button>
          <button v-else-if="row.status === 'ACTIVE'" type="button" :disabled="updatingId === row.id" class="rounded-lg bg-danger px-2.5 py-1.5 text-xs font-bold text-primary-on disabled:opacity-50" @click="updateStatus(row, 'HIDDEN')">판매 중지</button>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !rows.length" title="조건에 맞는 상품이 없습니다" description="필터를 바꾸거나 잠시 후 다시 확인해 보세요." compact />
    </div>
  </div>
</template>
