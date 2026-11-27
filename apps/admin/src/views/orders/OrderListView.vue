<script setup lang="ts">
// Admin order list (4-16): status tabs, period, keyword search across
// order/member/seller/product, paging and CSV export.
import { ref, onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { adminApi, API_BASE_URL, getAdminHeaders } from '../../config'
import { userErrorMessage, useToast, OmDataTable, OmStatusTabs, OmSkeleton } from '@olmoa/ui'

const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const PER_PAGE = 50
const STATUS_LABEL: Record<string, string> = { READY: '결제 대기', PAID: '결제완료', FAILED: '결제실패', CANCELLED: '취소', PARTIAL_REFUNDED: '부분환불', DELIVERED: '배송완료' }

const tab = ref('')
const from = ref('')
const to = ref('')
const q = ref('')
const rows = ref<any[]>([])
const page = ref(1)
const total = ref(0)
const loading = ref(true)
const loadError = ref('')

const columns = [
  { key: 'order', label: '주문번호', primary: true },
  { key: 'buyer', label: '구매자', mobileHidden: true },
  { key: 'amount', label: '결제금액', align: 'right' as const },
  { key: 'status', label: '상태' },
  { key: 'date', label: '주문일', mobileHidden: true }
]
const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`

function query(csv = false) {
  const params = new URLSearchParams({ page: String(page.value), per_page: String(PER_PAGE) })
  if (tab.value) params.set('status', tab.value)
  if (from.value) params.set('from', from.value)
  if (to.value) params.set('to', to.value)
  if (q.value.trim()) params.set('q', q.value.trim())
  if (csv) params.set('format', 'csv')
  return params.toString()
}

async function loadOrders() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi(`/api/v1/admin/orders?${query()}`)
    if (!r.ok) throw new Error(r.data.error || '주문 목록을 불러오지 못했습니다.')
    rows.value = Array.isArray(r.data.data) ? r.data.data : []
    total.value = r.data.pagination?.total ?? rows.value.length
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '주문 목록을 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}
watch(page, () => void loadOrders())
function setTab(v: string) { tab.value = v; page.value = 1; void loadOrders() }

async function exportCsv() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/orders?${query(true)}`, { headers: getAdminHeaders() })
    if (!res.ok) throw new Error('CSV를 내려받지 못했습니다.')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'admin_orders.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, 'CSV를 내려받지 못했습니다.'))
  }
}

onMounted(() => void loadOrders())
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-ink">주문 관리</h1>
        <p class="mt-1 text-xs text-ink-muted">주문번호·회원·판매자·상품으로 검색합니다.</p>
      </div>
      <button type="button" class="h-9 rounded-lg bg-secondary px-4 text-xs font-bold text-secondary-on hover:bg-secondary-hover" @click="exportCsv">CSV 내보내기</button>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <OmStatusTabs
        v-model="tab"
        :tabs="[
          { value: '', label: '전체' },
          { value: 'PAID', label: '결제완료' },
          { value: 'PARTIAL_REFUNDED', label: '부분환불' },
          { value: 'DELIVERED', label: '배송완료' },
          { value: 'CANCELLED', label: '취소' },
          { value: 'FAILED', label: '결제실패' }
        ]"
        @update:model-value="setTab"
      />
      <input v-model="from" type="date" aria-label="주문 시작일" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="page = 1; loadOrders()" />
      <span class="text-xs text-ink-subtle">~</span>
      <input v-model="to" type="date" aria-label="주문 종료일" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="page = 1; loadOrders()" />
      <input v-model="q" type="search" placeholder="주문번호·회원·판매자·상품" aria-label="주문 검색" class="h-9 w-64 rounded-lg border border-line bg-surface px-3 text-xs text-ink" @keyup.enter="page = 1; loadOrders()" />
      <button type="button" class="h-9 rounded-lg bg-secondary px-4 text-xs font-bold text-secondary-on hover:bg-secondary-hover" @click="page = 1; loadOrders()">검색</button>
    </div>

    <div v-if="loading && !rows.length" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="8" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="loadOrders">다시 시도</button>
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
        empty-title="선택한 조건에 맞는 주문이 없습니다."
        empty-description="상태·기간·검색어를 바꾸거나 잠시 후 다시 확인해 보세요."
      >
        <template #cell-order="{ row }">
          <RouterLink :to="`/orders/${row.order_no || row.id}`" class="om-num font-bold text-primary hover:underline">{{ row.order_no || row.id }}</RouterLink>
        </template>
        <template #cell-buyer="{ row }"><span class="text-ink-muted">{{ row.buyer_email || row.customer_id }}</span></template>
        <template #cell-amount="{ row }"><span class="om-num font-bold text-ink">{{ won(row.total_pay_amount) }}</span></template>
        <template #cell-status="{ row }">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="row.payment_status === 'PAID' ? 'bg-warning-soft text-warning' : row.payment_status === 'CANCELLED' || row.payment_status === 'FAILED' ? 'bg-danger-soft text-danger' : row.payment_status === 'DELIVERED' ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted'">{{ STATUS_LABEL[row.payment_status] || row.payment_status }}</span>
        </template>
        <template #cell-date="{ row }"><span class="om-num text-ink-muted">{{ String(row.created_at || '').slice(0, 10) }}</span></template>
        <template #actions="{ row }">
          <RouterLink :to="`/orders/${row.order_no || row.id}`" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2">상세</RouterLink>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !rows.length" title="선택한 조건에 맞는 주문이 없습니다." description="상태·기간·검색어를 바꾸거나 잠시 후 다시 확인해 보세요." data-empty compact />
    </div>
  </div>
</template>
