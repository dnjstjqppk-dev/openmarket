<script setup lang="ts">
// Seller flash-sale applications (4-7): open campaigns with my application
// state, plus per-SKU apply (deal below sale, allocation within stock).
import { ref, onMounted } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../../config'
import { userErrorMessage, OmDataTable, OmModal, OmSkeleton } from '@olmoa/ui'

const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const columns = [
  { key: 'campaign', label: '캠페인', primary: true },
  { key: 'period', label: '기간', mobileHidden: true },
  { key: 'mine', label: '내 신청' },
  { key: 'status', label: '상태' }
]
const APP_LABEL: Record<string, string> = { REQUESTED: '심사중', APPROVED: '승인됨', REJECTED: '반려됨' }

const rows = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const applyOpen = ref(false)
const applyCamp = ref<any>(null)
const skus = ref<any[]>([])
const applySku = ref('')
const applyDeal = ref('')
const applyAlloc = ref('')
const applyBusy = ref(false)
const applyError = ref('')
const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/flash-sales`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '특가 목록을 불러오지 못했습니다.')
    rows.value = Array.isArray(json.data) ? json.data : []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

async function openApply(camp: any) {
  applyCamp.value = camp
  applySku.value = ''
  applyDeal.value = ''
  applyAlloc.value = ''
  applyError.value = ''
  applyOpen.value = true
  skus.value = []
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/products?per_page=200`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => null)
    const flat = Array.isArray(json?.data) ? json.data : []
    skus.value = flat.filter((r: any) => r.sku_id).map((r: any) => ({
      id: r.sku_id, label: `${r.title} · ${r.option_summary || r.sku_code || ''}`.trim(),
      sale_price: r.sale_price, stock: r.stock_quantity ?? 0
    }))
  } catch (e: any) {
    applyError.value = userErrorMessage(e, '상품 목록을 불러오지 못했습니다.')
  }
}

async function submitApply() {
  if (!applyCamp.value || !applySku.value) { applyError.value = '옵션을 선택해 주세요.'; return }
  applyBusy.value = true
  applyError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/flash-sales/${applyCamp.value.id}/apply`, {
      method: 'POST', headers: getPartnerHeaders(),
      body: JSON.stringify({ sku_id: applySku.value, deal_price: Number(applyDeal.value), allocated_stock: Number(applyAlloc.value) })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || '신청에 실패했습니다.')
    applyOpen.value = false
  } catch (e: any) {
    applyError.value = userErrorMessage(e, '신청에 실패했습니다.')
  } finally {
    applyBusy.value = false
  }
  void load()
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold text-ink">번개특가 신청</h1>

    <div v-if="loading && !rows.length" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="6" />
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
        empty-title="진행 중인 특가 캠페인이 없습니다"
        empty-description="새 캠페인이 열리면 이곳에 표시됩니다."
      >
        <template #cell-campaign="{ row }">
          <div class="min-w-0">
            <p class="truncate font-bold text-ink">{{ row.title }}</p>
            <p class="om-num truncate text-2xs text-ink-subtle">{{ row.id }}</p>
          </div>
        </template>
        <template #cell-period="{ row }"><span class="om-num text-ink-muted">{{ String(row.starts_at || '').slice(0, 10) }} ~ {{ String(row.ends_at || '').slice(0, 10) }}</span></template>
        <template #cell-mine="{ row }">
          <span v-if="row.my_application" class="text-ink-muted">{{ won(row.my_application.deal_price) }} · {{ row.my_application.allocated_stock }}개</span>
          <span v-else class="text-ink-subtle">-</span>
        </template>
        <template #cell-status="{ row }">
          <span v-if="row.my_application" class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="row.my_application.status === 'APPROVED' ? 'bg-success-soft text-success' : row.my_application.status === 'REJECTED' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'">{{ APP_LABEL[row.my_application.status] || row.my_application.status }}</span>
          <span v-else class="rounded-full bg-surface-3 px-2 py-0.5 text-2xs font-bold text-ink-muted whitespace-nowrap">{{ row.status === 'ENDED' ? '종료' : '모집중' }}</span>
        </template>
        <template #actions="{ row }">
          <button v-if="row.status !== 'ENDED'" type="button" class="rounded-lg bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="openApply(row)">신청</button>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !rows.length" title="진행 중인 특가 캠페인이 없습니다" description="새 캠페인이 열리면 이곳에 표시됩니다." compact />
    </div>

    <OmModal v-model:open="applyOpen" :title="`특가 신청 · ${applyCamp?.title || ''}`">
      <div class="space-y-3 text-xs">
        <label class="block space-y-1">옵션
          <select v-model="applySku" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink">
            <option value="" disabled>선택해 주세요</option>
            <option v-for="s in skus" :key="s.id" :value="s.id">{{ s.label }} ({{ won(s.sale_price) }} · 재고 {{ s.stock }}개)</option>
          </select>
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1">딜가 (판매가보다 낮게)<input v-model="applyDeal" type="number" min="100" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
          <label class="space-y-1">배정 수량 (재고 이내)<input v-model="applyAlloc" type="number" min="1" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        </div>
        <p v-if="applyError" role="alert" class="font-bold text-danger">{{ applyError }}</p>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="applyOpen = false">취소</button>
        <button type="button" :disabled="applyBusy" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitApply">{{ applyBusy ? '신청 중…' : '신청' }}</button>
      </template>
    </OmModal>
  </div>
</template>
