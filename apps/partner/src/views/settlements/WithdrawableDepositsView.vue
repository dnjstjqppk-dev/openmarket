<script setup lang="ts">
// Withdrawable deposits (4-6): ELIGIBLE_FOR_PAYOUT settlements by month with
// per-statement adjustments, plus the rolling-reserve hold and its release.
import { ref, computed, onMounted } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../../config'
import { userErrorMessage, OmDataTable, OmSkeleton } from '@olmoa/ui'
import PayoutRequestModal from '../../components/settlement/PayoutRequestModal.vue'

const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const PER_PAGE = 20

const rows = ref<any[]>([])
const summary = ref<any>({})
const available = ref(0)
const accountLabel = ref('-')
const accountVerified = ref(false)
const loading = ref(true)
const loadError = ref('')
const page = ref(1)
const month = ref('')
const payoutOpen = ref(false)

const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`
const columns = [
  { key: 'order', label: '주문', primary: true },
  { key: 'gross', label: '매출', align: 'right' as const },
  { key: 'commission', label: '수수료', align: 'right' as const, mobileHidden: true },
  { key: 'adjust', label: '조정', align: 'right' as const },
  { key: 'net', label: '순지급', align: 'right' as const },
  { key: 'date', label: '정산일', mobileHidden: true }
]

const months = computed(() => {
  const set = new Set<string>()
  for (const s of rows.value) set.add(String(s.created_at || '').slice(0, 7))
  return [...set].filter(Boolean).sort().reverse()
})
const monthRows = computed(() => (!month.value ? rows.value : rows.value.filter((s) => String(s.created_at || '').startsWith(month.value))))
const paged = computed(() => monthRows.value.slice((page.value - 1) * PER_PAGE, page.value * PER_PAGE))
const monthTotal = computed(() => monthRows.value.reduce((a, s) => a + (Number(s.effective_net_payout ?? s.net_payout_amount) || 0), 0))

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/settlements`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '예치금을 불러오지 못했습니다.')
    const all = json.data?.settlements || json.settlements || []
    rows.value = all.filter((s: any) => s.status === 'ELIGIBLE_FOR_PAYOUT')
    summary.value = json.data?.summary || json.summary || {}
    const pr = await fetch(`${API_BASE_URL}/api/v1/partner/payout-requests`, { headers: getPartnerHeaders() }).then((r) => r.json().catch(() => null))
    available.value = pr?.data?.available_amount ?? pr?.available_amount ?? 0
    const prof = await fetch(`${API_BASE_URL}/api/v1/partner/profile`, { headers: getPartnerHeaders() }).then((r) => r.json().catch(() => null))
    accountLabel.value = prof?.data?.bank_account_number ? `${prof.data.bank_code || ''} ${prof.data.bank_account_number}` : '미등록'
    accountVerified.value = prof?.data?.payout_account_verified === true
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
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-ink">출금 가능 예치금</h1>
        <p class="mt-1 text-xs text-ink-muted">지급 보류 {{ won(summary.reserve_outstanding) }} · 다음 해제 {{ summary.next_reserve_release || '-' }}</p>
      </div>
      <button type="button" class="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="payoutOpen = true">출금 요청 ({{ won(available) }})</button>
    </div>

    <div class="flex items-center gap-2">
      <label class="text-xs font-bold text-ink-muted">월별
        <select v-model="month" class="ml-1 h-9 rounded-lg border border-line bg-surface px-2 text-ink" @change="page = 1">
          <option value="">전체</option>
          <option v-for="m in months" :key="m" :value="m">{{ m }}</option>
        </select>
      </label>
      <span class="om-num ml-auto text-sm font-bold text-primary">{{ won(monthTotal) }}</span>
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
        :rows="paged"
        row-key="id"
        v-model:page="page"
        :total="monthRows.length"
        :page-size="PER_PAGE"
        :loading="false"
        empty-title="출금 가능한 예치금이 없습니다"
        empty-description="정산 확정 건이 출금 가능 상태가 되면 이곳에 표시됩니다."
      >
        <template #cell-order="{ row }">
          <div class="min-w-0">
            <p class="truncate font-bold text-ink">{{ row.order_no }}</p>
            <p class="om-num truncate text-2xs text-ink-subtle">{{ row.sub_order_no }}</p>
          </div>
        </template>
        <template #cell-gross="{ row }"><span class="om-num text-ink-muted">{{ won(row.gross_amount) }}</span></template>
        <template #cell-commission="{ row }"><span class="om-num text-ink-muted">{{ won(row.commission_amount) }}</span></template>
        <template #cell-adjust="{ row }"><span class="om-num font-bold" :class="Number(row.adjustment_total) < 0 ? 'text-danger' : 'text-ink'">{{ Number(row.adjustment_total) > 0 ? '+' : '' }}{{ won(row.adjustment_total) }}</span></template>
        <template #cell-net="{ row }"><span class="om-num font-bold text-primary">{{ won(row.effective_net_payout ?? row.net_payout_amount) }}</span></template>
        <template #cell-date="{ row }"><span class="om-num text-ink-muted">{{ String(row.created_at || '').slice(0, 10) }}</span></template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !rows.length" title="출금 가능한 예치금이 없습니다" description="정산 확정 건이 출금 가능 상태가 되면 이곳에 표시됩니다." compact />
    </div>

    <PayoutRequestModal v-model:open="payoutOpen" :available="available" :account-label="accountLabel" :account-verified="accountVerified" @submitted="load" />
  </div>
</template>
