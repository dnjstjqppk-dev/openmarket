<script setup lang="ts">
// Seller cancellation history (4-5): pre-shipment cancels complete instantly
// (auto-refund, no seller approval step exists), so this screen is the
// read-only record with the same filters as the shipment list.
import { ref, onMounted, watch } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../../config'
import { userErrorMessage, OmDataTable, OmStatusTabs, OmSkeleton } from '@olmoa/ui'

const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const PER_PAGE = 30
const TABS = [
  { value: 'CANCELLED', label: '취소됨' },
  { value: 'EXPIRED', label: '만료됨' }
]
const columns = [
  { key: 'order', label: '주문', primary: true },
  { key: 'items', label: '상품/수량' },
  { key: 'amount', label: '환불액', align: 'right' as const },
  { key: 'date', label: '처리일', mobileHidden: true }
]

const tab = ref('CANCELLED')
const page = ref(1)
const total = ref(0)
const rows = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const fQ = ref('')
const fFrom = ref('')
const fTo = ref('')

const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`
function itemSummary(items: any[]) {
  if (!items?.length) return '-'
  const first = items[0]
  return items.length > 1 ? `${first.product_title} 외 ${items.length - 1}건` : `${first.product_title} × ${first.quantity}`
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const params = new URLSearchParams({ status: tab.value, page: String(page.value), per_page: String(PER_PAGE) })
    if (fQ.value.trim()) params.set('q', fQ.value.trim())
    params.set('date_field', 'paid')
    if (fFrom.value) params.set('from', fFrom.value)
    if (fTo.value) params.set('to', fTo.value)
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/orders?${params}`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '취소 내역을 불러오지 못했습니다.')
    rows.value = Array.isArray(json.data) ? json.data : []
    total.value = json.pagination?.total ?? rows.value.length
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}
function setTab(v: string) { tab.value = v; page.value = 1; void load() }
function applySearch() { page.value = 1; void load() }
watch(page, () => void load())

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold text-ink">취소 내역</h1>
      <p class="mt-1 text-xs text-ink-muted">출고 전 취소는 즉시 자동 처리(환불)되므로 승인 단계가 없습니다.</p>
    </div>
    <OmStatusTabs v-model="tab" :tabs="TABS.map((t) => ({ value: t.value, label: t.label }))" @update:model-value="setTab" />

    <div class="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface p-4 text-xs md:grid-cols-4">
      <input v-model="fQ" placeholder="주문·상품·수령인 검색" aria-label="키워드 검색" class="h-9 rounded-lg border border-line bg-surface px-3 text-ink focus:outline-none focus:ring-2 focus-visible:ring-focus md:col-span-2" @keyup.enter="applySearch" />
      <input v-model="fFrom" type="date" aria-label="시작일" class="h-9 rounded-lg border border-line bg-surface px-2 text-ink" />
      <input v-model="fTo" type="date" aria-label="종료일" class="h-9 rounded-lg border border-line bg-surface px-2 text-ink" />
      <div class="col-span-2 flex gap-2 md:col-span-4">
        <button type="button" class="h-9 rounded-lg bg-secondary px-4 font-bold text-secondary-on hover:bg-secondary-hover" @click="applySearch">검색</button>
      </div>
    </div>

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
        empty-title="취소 내역이 없습니다"
        empty-description="취소·만료된 주문이 이곳에 표시됩니다."
      >
        <template #cell-order="{ row }">
          <div class="min-w-0">
            <p class="truncate font-bold text-ink">{{ row.order_no }}</p>
            <p class="om-num truncate text-2xs text-ink-subtle">{{ row.sub_order_no }}</p>
          </div>
        </template>
        <template #cell-items="{ row }"><span class="text-ink-muted">{{ itemSummary(row.items) }}</span></template>
        <template #cell-amount="{ row }"><span class="om-num font-bold text-ink">{{ won(row.total_amount) }}</span></template>
        <template #cell-date="{ row }"><span class="om-num text-ink-muted">{{ String(row.updated_at || '').slice(0, 10) }}</span></template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !rows.length" title="취소 내역이 없습니다" description="취소·만료된 주문이 이곳에 표시됩니다." compact />
    </div>
  </div>
</template>
