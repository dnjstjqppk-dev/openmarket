<script setup lang="ts">
// Seller directory (4-13): every partner with account, commission, tier and
// status. Detail actions live on the seller screen.
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { adminApi } from '../../config'
import { userErrorMessage, OmDataTable, OmSkeleton } from '@olmoa/ui'

const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const TIER_LABEL: Record<string, string> = { TIER_1_NORMAL: '정상', TIER_2_WATCH: '주의', TIER_3_HIGH_RISK: '고위험' }
const STATUS_LABEL: Record<string, string> = { PENDING: '심사 중', APPROVED: '정상', REJECTED: '반려', SUSPENDED: '정지' }

const rows = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')

const columns = [
  { key: 'biz', label: '상호', primary: true },
  { key: 'account', label: '정산 계좌', mobileHidden: true },
  { key: 'commission', label: '수수료', align: 'right' as const },
  { key: 'tier', label: '위험등급', mobileHidden: true },
  { key: 'status', label: '상태' }
]

function maskAcct(n?: string) {
  const t = String(n || '')
  return t ? `****${t.slice(-4)}` : '-'
}
const hasChange = (p: any) => !!p.payout_change_request_json

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi('/api/v1/admin/partners')
    if (!r.ok) throw new Error(r.data.error || '목록을 불러오지 못했습니다.')
    rows.value = Array.isArray(r.data.data) ? r.data.data : []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold text-ink">입점사 관리</h1>
      <p class="mt-1 text-xs text-ink-muted">정산 계좌 실명 확인, 수수료, 위험등급, 정지·해제는 셀러 상세에서 처리합니다.</p>
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
        empty-title="등록된 입점사가 없습니다"
        empty-description="입점 심사를 통과한 판매자가 이곳에 표시됩니다."
      >
        <template #cell-biz="{ row }">
          <div class="min-w-0">
            <RouterLink :to="`/partners/${row.id}`" class="truncate font-bold text-primary hover:underline">{{ row.business_name }}</RouterLink>
            <p class="om-num text-2xs text-ink-subtle">{{ row.business_reg_number }}</p>
          </div>
        </template>
        <template #cell-account="{ row }">
          <span class="om-num text-ink-muted">{{ row.bank_code || '-' }} {{ maskAcct(row.bank_account_number) }}</span>
          <span class="ml-1 rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="Number(row.payout_account_verified) === 1 ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'">{{ Number(row.payout_account_verified) === 1 ? '실명확인' : '미확인' }}</span>
          <span v-if="hasChange(row)" class="ml-1 rounded-full bg-info-soft px-2 py-0.5 text-2xs font-bold text-info whitespace-nowrap">변경요청</span>
        </template>
        <template #cell-commission="{ row }"><span class="om-num font-bold text-ink">{{ row.commission_rate }}%</span></template>
        <template #cell-tier="{ row }"><span class="text-ink-muted">{{ TIER_LABEL[row.risk_tier] || row.risk_tier || '정상' }} · {{ row.rolling_reserve_pct ?? 0 }}%</span></template>
        <template #cell-status="{ row }">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="row.status === 'APPROVED' ? 'bg-success-soft text-success' : row.status === 'PENDING' ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger'">{{ STATUS_LABEL[row.status] || row.status }}</span>
        </template>
        <template #actions="{ row }">
          <RouterLink :to="`/partners/${row.id}`" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2">상세</RouterLink>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !rows.length" title="등록된 입점사가 없습니다" description="입점 심사를 통과한 판매자가 이곳에 표시됩니다." compact />
    </div>
  </div>
</template>
