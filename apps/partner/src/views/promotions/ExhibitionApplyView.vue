<script setup lang="ts">
// Seller exhibition status (4-7): exhibitions are operator-curated (there is
// no application workflow), so this screen shows the running shows and marks
// the seller's own placed products.
import { ref, onMounted } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../../config'
import { userErrorMessage, OmDataTable, OmSkeleton } from '@olmoa/ui'

const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const columns = [
  { key: 'show', label: '기획전', primary: true },
  { key: 'period', label: '기간', mobileHidden: true },
  { key: 'mine', label: '내 상품' }
]

const rows = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const partnerId = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [exRes, profRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/exhibitions`),
      fetch(`${API_BASE_URL}/api/v1/partner/profile`, { headers: getPartnerHeaders() })
    ])
    const ex = await exRes.json().catch(() => null)
    const prof = await profRes.json().catch(() => null)
    if (!exRes.ok || !ex?.success) throw new Error(ex?.error || '기획전 목록을 불러오지 못했습니다.')
    partnerId.value = prof?.data?.id || ''
    rows.value = Array.isArray(ex.data) ? ex.data : []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}
function myProducts(row: any) {
  return (row.products || []).filter((p: any) => p.partner_id === partnerId.value)
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold text-ink">기획전 현황</h1>
      <p class="mt-1 text-xs text-ink-muted">기획전 입점은 운영자 선정입니다. 선정된 상품은 아래에 표시됩니다.</p>
    </div>

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
        empty-title="진행 중인 기획전이 없습니다"
        empty-description="새 기획전이 열리면 이곳에 표시됩니다."
      >
        <template #cell-show="{ row }">
          <div class="min-w-0">
            <p class="truncate font-bold text-ink">{{ row.title }}</p>
            <p class="om-num truncate text-2xs text-ink-subtle">{{ (row.products || []).length }}개 상품</p>
          </div>
        </template>
        <template #cell-period="{ row }"><span class="om-num text-ink-muted">{{ String(row.starts_at || '').slice(0, 10) }} ~ {{ String(row.ends_at || '').slice(0, 10) }}</span></template>
        <template #cell-mine="{ row }">
          <span v-if="myProducts(row).length" class="font-bold text-primary">{{ myProducts(row).length }}개 입점</span>
          <span v-else class="text-ink-subtle">-</span>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !rows.length" title="진행 중인 기획전이 없습니다" description="새 기획전이 열리면 이곳에 표시됩니다." compact />
    </div>
  </div>
</template>
