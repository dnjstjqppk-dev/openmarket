<script setup lang="ts">
// Seller settlement overview (4-6): monthly summary, settlement calendar,
// statement rows with server-computed figures, payout requests and the
// seller's commission tax invoices.
import { ref, computed, onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { API_BASE_URL, getPartnerHeaders } from '../../config'
import { userErrorMessage, useConfirm, OmDataTable, OmSkeleton, OmEmptyState } from '@olmoa/ui'
import PayoutRequestModal from '../../components/settlement/PayoutRequestModal.vue'

const { confirm: askConfirm } = useConfirm()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const PER_PAGE = 20

const settlements = ref<any[]>([])
const summary = ref<any>({})
const payouts = ref<any[]>([])
const invoices = ref<any[]>([])
const requests = ref<any[]>([])
const available = ref(0)
const accountLabel = ref('-')
const accountVerified = ref(false)
const loading = ref(true)
const loadError = ref('')
const page = ref(1)
const month = ref('')
const payoutOpen = ref(false)

const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`
const STATUS_LABEL: Record<string, string> = { PENDING: '확정 대기', ELIGIBLE_FOR_PAYOUT: '출금 가능', PAID_OUT: '지급됨', CANCELLED: '취소됨' }

const months = computed(() => {
  const set = new Set<string>()
  for (const s of settlements.value) set.add(String(s.created_at || '').slice(0, 7))
  return [...set].filter(Boolean).sort().reverse()
})
const monthRows = computed(() => (!month.value ? settlements.value : settlements.value.filter((s) => String(s.created_at || '').startsWith(month.value))))
const monthSummary = computed(() => {
  const rows = monthRows.value.filter((s) => s.status !== 'CANCELLED')
  const sum = (f: (s: any) => number) => rows.reduce((a, s) => a + (Number(f(s)) || 0), 0)
  return {
    gross: sum((s) => s.gross_amount),
    commission: sum((s) => s.commission_amount),
    net: sum((s) => s.effective_net_payout ?? s.net_payout_amount),
    pending: sum((s) => (s.status === 'PENDING' ? (s.effective_net_payout ?? s.net_payout_amount) : 0)),
    eligible: sum((s) => (s.status === 'ELIGIBLE_FOR_PAYOUT' ? (s.effective_net_payout ?? s.net_payout_amount) : 0))
  }
})
const paged = computed(() => monthRows.value.slice((page.value - 1) * PER_PAGE, page.value * PER_PAGE))

const calCells = computed(() => {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const first = new Date(y, m, 1).getDay()
  const days = new Date(y, m + 1, 0).getDate()
  const marks = new Map<string, Set<string>>()
  const mark = (d: any, k: string) => {
    const day = String(d || '').slice(0, 10)
    if (!day.startsWith(`${y}-${String(m + 1).padStart(2, '0')}`)) return
    if (!marks.has(day)) marks.set(day, new Set())
    marks.get(day)!.add(k)
  }
  for (const s of settlements.value) mark(s.created_at, '확정')
  for (const p of payouts.value) mark(p.created_at, '지급')
  const cells: ({ day: number } | null)[] = []
  for (let i = 0; i < first; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push({ day: d })
  const byDay = new Map<number, Set<string>>()
  for (const [day, kinds] of marks) byDay.set(Number(day.slice(8, 10)), kinds)
  return { cells, byDay, title: `${y}년 ${m + 1}월` }
})

const columns = [
  { key: 'order', label: '주문', primary: true },
  { key: 'gross', label: '매출', align: 'right' as const },
  { key: 'commission', label: '수수료', align: 'right' as const, mobileHidden: true },
  { key: 'net', label: '순지급', align: 'right' as const },
  { key: 'status', label: '상태' },
  { key: 'date', label: '정산일', mobileHidden: true }
]

async function loadSettlements() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/settlements`, { headers: getPartnerHeaders() })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '정산 내역을 불러오지 못했습니다.')
    settlements.value = json.data?.settlements || json.settlements || []
    summary.value = json.data?.summary || json.summary || {}
    payouts.value = json.data?.payouts || json.payouts || []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}
async function loadSide() {
  try {
    const [pr, inv, prof] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/partner/payout-requests`, { headers: getPartnerHeaders() }).then((r) => r.json().catch(() => null)),
      fetch(`${API_BASE_URL}/api/v1/partner/tax-invoices`, { headers: getPartnerHeaders() }).then((r) => r.json().catch(() => null)),
      fetch(`${API_BASE_URL}/api/v1/partner/profile`, { headers: getPartnerHeaders() }).then((r) => r.json().catch(() => null))
    ])
    requests.value = pr?.data?.requests || pr?.requests || []
    available.value = pr?.data?.available_amount ?? pr?.available_amount ?? 0
    invoices.value = Array.isArray(inv?.data) ? inv.data : []
    accountLabel.value = prof?.data?.bank_account_number ? `${prof.data.bank_code || ''} ${prof.data.bank_account_number}` : '미등록'
    accountVerified.value = prof?.data?.payout_account_verified === true
  } catch { /* side panels hide on failure; main table already loaded */ }
}

async function cancelRequest(id: string) {
  if (!(await askConfirm({ title: '출금 요청 취소', body: '대기 중인 출금 요청을 취소합니다.', danger: true }))) return
  const res = await fetch(`${API_BASE_URL}/api/v1/partner/payout-requests/${id}/cancel`, { method: 'POST', headers: getPartnerHeaders() })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.success) return
  void loadSide()
}

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
function exportCsv() {
  const head = 'order_no,sub_order_no,status,gross_amount,commission_amount,effective_net_payout,settlement_status'.split(',')
  const lines = [head.map(csvCell).join(',')]
  for (const s of monthRows.value) {
    lines.push([s.order_no, s.sub_order_no, s.status, s.gross_amount, s.commission_amount, s.effective_net_payout ?? s.net_payout_amount, s.status].map(csvCell).join(','))
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `settlements-${month.value || 'all'}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

watch(month, () => { page.value = 1 })
onMounted(async () => { await loadSettlements(); void loadSide() })
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-bold text-ink">정산 개요</h1>
      <div class="flex gap-2">
        <RouterLink to="/settlements/deposits" class="rounded-xl border border-line px-4 py-2 text-xs font-bold text-ink hover:bg-surface-2">출금 가능 예치금</RouterLink>
        <button type="button" class="rounded-xl border border-line px-4 py-2 text-xs font-bold text-ink hover:bg-surface-2" @click="monthRows.length ? exportCsv() : null" :title="monthRows.length ? '' : '내보낼 정산 내역이 없습니다'">CSV 저장</button>
        <button type="button" class="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="payoutOpen = true">출금 요청</button>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-3 md:grid-cols-5">
      <div class="rounded-2xl border border-line bg-surface p-4"><p class="text-xs text-ink-muted">{{ month || '전체' }} 매출</p><p class="om-num mt-1 text-lg font-bold text-ink">{{ won(monthSummary.gross) }}</p></div>
      <div class="rounded-2xl border border-line bg-surface p-4"><p class="text-xs text-ink-muted">수수료</p><p class="om-num mt-1 text-lg font-bold text-ink">{{ won(monthSummary.commission) }}</p></div>
      <div class="rounded-2xl border border-line bg-surface p-4"><p class="text-xs text-ink-muted">순지급</p><p class="om-num mt-1 text-lg font-bold text-primary">{{ won(monthSummary.net) }}</p></div>
      <div class="rounded-2xl border border-line bg-surface p-4"><p class="text-xs text-ink-muted">송금 대기</p><p class="om-num mt-1 text-lg font-bold text-ink">{{ won(monthSummary.eligible) }}</p></div>
      <div class="rounded-2xl border border-line bg-surface p-4"><p class="text-xs text-ink-muted">확정 대기</p><p class="om-num mt-1 text-lg font-bold text-ink">{{ won(monthSummary.pending) }}</p></div>
    </div>
    <p class="om-num -mt-3 text-xs text-ink-muted">지급 보류(롤링 리저브) {{ won(summary.reserve_outstanding) }} · 다음 해제 {{ summary.next_reserve_release || '-' }} · 지급 주기: 출금 신청제</p>

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div class="rounded-2xl border border-line bg-surface p-5">
        <h2 class="mb-3 text-sm font-bold text-ink">정산 캘린더 ({{ calCells.title }})</h2>
        <div class="grid grid-cols-7 gap-1 text-center text-2xs">
          <span v-for="d in ['일', '월', '화', '수', '목', '금', '토']" :key="d" class="font-bold text-ink-subtle">{{ d }}</span>
          <template v-for="(c, i) in calCells.cells" :key="i">
            <span v-if="!c" />
            <span v-else class="rounded-lg border border-line-divider py-1.5">
              <span class="om-num block font-bold text-ink">{{ c.day }}</span>
              <span class="mt-0.5 flex justify-center gap-0.5">
                <span v-if="calCells.byDay.get(c.day)?.has('확정')" class="h-1.5 w-1.5 rounded-full bg-primary" title="확정" />
                <span v-if="calCells.byDay.get(c.day)?.has('지급')" class="h-1.5 w-1.5 rounded-full bg-success" title="지급" />
              </span>
            </span>
          </template>
        </div>
        <p class="mt-2 text-2xs text-ink-muted"><span class="mr-3"><span class="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary" />확정</span><span><span class="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-success" />지급</span></p>
      </div>

      <div class="space-y-3 rounded-2xl border border-line bg-surface p-5 lg:col-span-2">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-bold text-ink">출금 요청 내역</h2>
          <span class="om-num text-xs text-ink-muted">출금 가능 {{ won(available) }}</span>
        </div>
        <ul v-if="requests.length" class="divide-y divide-line-divider text-xs">
          <li v-for="r in requests.slice(0, 5)" :key="r.id" class="flex items-center justify-between gap-2 py-2">
            <span class="om-num font-bold text-ink">{{ won(r.amount) }}</span>
            <span class="text-ink-muted">{{ r.status }}</span>
            <span class="om-num text-ink-subtle">{{ String(r.created_at || '').slice(0, 10) }}</span>
            <button v-if="r.status === 'REQUESTED' || r.status === 'PENDING'" type="button" class="rounded-lg border border-line px-2.5 py-1 font-bold text-ink-muted hover:bg-surface-2" @click="cancelRequest(r.id)">취소</button>
          </li>
        </ul>
        <p v-else class="text-xs text-ink-muted">출금 요청 내역이 없습니다.</p>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <label class="text-xs font-bold text-ink-muted">월별
        <select v-model="month" class="ml-1 h-9 rounded-lg border border-line bg-surface px-2 text-ink">
          <option value="">전체</option>
          <option v-for="m in months" :key="m" :value="m">{{ m }}</option>
        </select>
      </label>
    </div>

    <div v-if="loading" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">정산 내역을 불러오는 중…</p>
      <OmSkeleton variant="row" :count="8" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">문제가 발생했습니다. 잠시 후 다시 시도해주세요.</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="loadSettlements">다시 불러오기</button>
    </div>
    <div v-else>
      <h2 class="mb-2 text-sm font-bold text-ink">정산 원장</h2>
      <OmDataTable
        :columns="columns"
        :rows="paged"
        row-key="id"
        v-model:page="page"
        :total="monthRows.length"
        :page-size="PER_PAGE"
        :loading="false"
        empty-title="정산 내역이 없습니다"
        empty-description="정산 확정 건이 이곳에 표시됩니다."
      >
        <template #cell-order="{ row }">
          <div class="min-w-0">
            <p class="truncate font-bold text-ink">{{ row.order_no }}</p>
            <p class="om-num truncate text-2xs text-ink-subtle">{{ row.sub_order_no }}</p>
          </div>
        </template>
        <template #cell-gross="{ row }"><span class="om-num text-ink-muted">{{ won(row.gross_amount) }}</span></template>
        <template #cell-commission="{ row }"><span class="om-num text-ink-muted">{{ won(row.commission_amount) }}</span></template>
        <template #cell-net="{ row }"><span class="om-num font-bold text-primary">{{ won(row.effective_net_payout ?? row.net_payout_amount) }}</span></template>
        <template #cell-status="{ row }">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold" :class="row.status === 'PAID_OUT' ? 'bg-success-soft text-success' : row.status === 'ELIGIBLE_FOR_PAYOUT' ? 'bg-primary-soft text-primary-soft-ink' : 'bg-warning-soft text-warning'">{{ STATUS_LABEL[row.status] || row.status }}</span>
        </template>
        <template #cell-date="{ row }"><span class="om-num text-ink-muted">{{ String(row.created_at || '').slice(0, 10) }}</span></template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && settlements.length === 0" title="정산 내역이 없습니다" description="정산 확정 건이 이곳에 표시됩니다." compact />
      <p v-if="monthRows.length" class="om-num mt-2 text-xs text-ink-muted">총 매출 {{ won(monthSummary.gross) }} · 플랫폼 수수료 {{ won(monthSummary.commission) }} · 실지급액 {{ won(monthSummary.net) }} (정산 상태별 합계)</p>
    </div>

    <div class="rounded-2xl border border-line bg-surface p-5">
      <h2 class="mb-3 text-sm font-bold text-ink">세금계산서</h2>
      <ul v-if="invoices.length" class="divide-y divide-line-divider text-xs">
        <li v-for="inv in invoices" :key="inv.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
          <span class="font-bold text-ink">{{ inv.item_title || inv.id }}</span>
          <span class="om-num text-ink-muted">공급 {{ won(inv.supply_amount) }} · 세 {{ won(inv.vat_amount) }}</span>
          <span class="text-ink-muted">{{ inv.issue_status }}{{ inv.hometax_approval_no ? ` · ${inv.hometax_approval_no}` : '' }}</span>
        </li>
      </ul>
      <p v-else class="text-xs text-ink-muted">발행된 세금계산서가 없습니다.</p>
    </div>

    <PayoutRequestModal v-model:open="payoutOpen" :available="available" :account-label="accountLabel" :account-verified="accountVerified" @submitted="loadSide" />
  </div>
</template>
