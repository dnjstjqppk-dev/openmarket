<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../config'
import { userErrorMessage, OmButton, OmEmptyState, useToast } from '@olmoa/ui'

const toastApi = useToast()

const settlements = ref<any[]>([])
// T-N01: payouts and adjustments come from /partner/settlements directly.
const payouts = ref<any[]>([])
const summary = ref<any>({ gross_sales: 0, total_commission: 0, net_payout: 0, paid_amount: 0, pending_amount: 0 })
const loading = ref(true)
const loadError = ref('')
// NEW-15: commission tax invoices issued for this seller.
const taxInvoices = ref<any[]>([])
const taxLoading = ref(false)
const taxError = ref('')

const loadSettlements = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/settlements`, {
      headers: getPartnerHeaders()
    })
    const json = await res.json()
    if (!res.ok || !json.success || !json.data) {
      throw new Error(json.error || '정산 내역을 불러오지 못했습니다.')
    }
    settlements.value = json.data.settlements || []
    payouts.value = json.data.payouts || []
    summary.value = json.data.summary || summary.value
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '정산 내역을 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    loading.value = false
  }
}

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

const exportSettlementCsv = () => {
  if (settlements.value.length === 0) {
    toastApi.error('내보낼 정산 내역이 없습니다.')
    return
  }
  const rows = ['id,order_id,gross_amount,commission_rate,commission_amount,shipping_fee,effective_net_payout,settlement_status,created_at']
  for (const s of settlements.value) {
    rows.push([
      csvCell(s.id), csvCell(s.order_id), csvCell(s.gross_amount), csvCell(s.commission_rate),
      csvCell(s.commission_amount), csvCell(s.shipping_fee), csvCell(s.effective_net_payout ?? s.net_payout_amount),
      csvCell(s.settlement_status), csvCell(s.created_at)
    ].join(','))
  }
  const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'partner_settlement_ledger.csv'
  a.click()
  URL.revokeObjectURL(url)
}

const settlementLabel = (status: string) =>
  status === 'PAID_OUT' ? '지급 완료' :
  status === 'ELIGIBLE_FOR_PAYOUT' ? '지급 대기' :
  status === 'PENDING' ? '정산 대기' :
  status === 'HOLD' ? '보류' :
  status === 'CANCELLED' ? '취소' : (status || '-')

const payoutLabel = (status: string) =>
  status === 'TRANSFERRED' ? '송금 완료' :
  status === 'APPROVED' ? '승인됨' :
  status === 'PENDING' ? '지급 대기' :
  status === 'CANCELLED' ? '취소' : (status || '-')

const loadTaxInvoices = async () => {
  taxLoading.value = true
  taxError.value = ''
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/tax-invoices`, {
      headers: getPartnerHeaders()
    })
    const json = await res.json()
    if (!res.ok || !json.success) throw new Error(json.error || '세금계산서 내역을 불러오지 못했습니다.')
    taxInvoices.value = json.data || []
  } catch (e: any) {
    taxError.value = userErrorMessage(e, '세금계산서 내역을 불러오지 못했습니다. 다시 시도해 주세요.')
  } finally {
    taxLoading.value = false
  }
}

const invoiceLabel = (status: string) =>
  status === 'ISSUED' ? '발행 완료' :
  status === 'REQUESTED' ? '발행 대기' :
  status === 'FAILED' ? '발행 실패' :
  status === 'CANCELLED' ? '취소' : (status || '-')

onMounted(() => { loadSettlements(); loadTaxInvoices() })
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-xl font-black text-gray-900">파트너 정산 원장</h2>
        <p class="text-xs text-gray-500">주문별 실시간 수수료 정산과 에스크로 지급 상태입니다</p>
      </div>
      <button @click="exportSettlementCsv" class="px-4 py-2 rounded-xl bg-gray-900 text-white text-xs font-bold cursor-pointer">
        ⬇ 정산·세무 CSV 내보내기
      </button>
    </div>

    <div v-if="loading" class="bg-white rounded-2xl border border-gray-200 p-12 text-center">
      <div class="w-8 h-8 mx-auto mb-2 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
      <p class="text-xs text-gray-500 font-bold">정산 내역을 불러오는 중입니다...</p>
    </div>

    <div v-else-if="loadError" class="bg-white rounded-2xl border border-red-200 p-12 text-center">
      <div class="text-3xl mb-2">⚠️</div>
      <p class="text-sm font-bold text-gray-800">문제가 발생했습니다. 잠시 후 다시 시도해주세요.</p>
      <p class="text-xs text-gray-500 mt-1">{{ loadError }}</p>
      <button @click="loadSettlements" class="mt-4 px-5 py-2 rounded-xl bg-gray-900 text-white text-xs font-bold cursor-pointer">
        다시 불러오기
      </button>
    </div>

    <div v-else class="space-y-6">
      <!-- Summary KPI Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div class="bg-white rounded-2xl p-4 border border-gray-200">
          <div class="text-[11px] font-bold text-gray-400 uppercase">총 매출 (취소 제외)</div>
          <div class="text-xl font-black text-gray-900 mt-1">₩{{ Number(summary.gross_sales || 0).toLocaleString() }}</div>
        </div>
        <div class="bg-white rounded-2xl p-4 border border-gray-200">
          <div class="text-[11px] font-bold text-gray-400 uppercase">플랫폼 수수료</div>
          <div class="text-xl font-black text-red-600 mt-1">-₩{{ Number(summary.total_commission || 0).toLocaleString() }}</div>
        </div>
        <div class="bg-white rounded-2xl p-4 border border-gray-200">
          <div class="text-[11px] font-bold text-gray-400 uppercase">실지급액</div>
          <div class="text-xl font-black text-emerald-600 mt-1">₩{{ Number(summary.net_payout || 0).toLocaleString() }}</div>
        </div>
        <div class="bg-white rounded-2xl p-4 border border-gray-200">
          <div class="text-[11px] font-bold text-gray-400 uppercase">대기 / 지급</div>
          <div class="text-xs font-bold text-gray-700 mt-2">
            대기: <span class="text-amber-600">₩{{ Number(summary.pending_amount || 0).toLocaleString() }}</span> •
            지급: <span class="text-emerald-600">₩{{ Number(summary.paid_amount || 0).toLocaleString() }}</span>
          </div>
          <div v-if="summary.reserve_outstanding" class="text-[11px] text-gray-500 mt-1" data-testid="reserve-outstanding">
            롤링 리저브 보류 ₩{{ Number(summary.reserve_outstanding).toLocaleString() }} ({{ summary.rolling_reserve_pct }}%)
            · 다음 해제 {{ summary.next_reserve_release }} UTC — 보류 기간이 끝나면 다음 지급에 포함됩니다.
          </div>
        </div>
      </div>

      <OmEmptyState
        v-if="settlements.length === 0"
        title="정산 내역이 없습니다"
        description="구매확정된 주문이 생기면 정산 내역이 표시됩니다."
      >
        <OmButton size="sm" @click="loadSettlements">다시 불러오기</OmButton>
      </OmEmptyState>

      <div v-else class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="bg-gray-50 text-gray-500 border-b border-gray-200 uppercase">
              <th class="py-3.5 px-5 font-bold">정산 ID</th>
              <th class="py-3.5 px-5 font-bold">주문번호</th>
              <th class="py-3.5 px-5 font-bold">총 매출</th>
              <th class="py-3.5 px-5 font-bold">수수료</th>
              <th class="py-3.5 px-5 font-bold">배송비</th>
              <th class="py-3.5 px-5 font-bold">차감/조정</th>
              <th class="py-3.5 px-5 font-bold">실지급액</th>
              <th class="py-3.5 px-5 font-bold">정산 상태</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="s in settlements" :key="s.id" class="hover:bg-gray-50">
              <td class="py-3.5 px-5 font-mono font-bold text-gray-900">{{ s.id }}</td>
              <td class="py-3.5 px-5 font-mono text-gray-600">{{ s.order_id }}</td>
              <td class="py-3.5 px-5 font-bold">₩{{ Number(s.gross_amount || 0).toLocaleString() }}</td>
              <td class="py-3.5 px-5 text-red-600 font-semibold">-₩{{ Number(s.commission_amount || 0).toLocaleString() }} ({{ s.commission_rate }}%)</td>
              <td class="py-3.5 px-5 text-gray-600">+₩{{ Number(s.shipping_fee || 0).toLocaleString() }}</td>
              <td class="py-3.5 px-5 font-semibold" :class="Number(s.adjustment_total || 0) < 0 ? 'text-red-600' : 'text-gray-600'">{{ Number(s.adjustment_total || 0) < 0 ? '−' : '+' }}₩{{ Number(Math.abs(s.adjustment_total || 0)).toLocaleString() }}</td>
              <td class="py-3.5 px-5 font-black text-emerald-600 text-sm">₩{{ Number((s.effective_net_payout ?? s.net_payout_amount) || 0).toLocaleString() }}</td>
              <td class="py-3.5 px-5">
                <span
                  :class="[
                    'px-2.5 py-0.5 rounded-full text-[11px] font-black',
                    s.settlement_status === 'PAID_OUT' ? 'bg-emerald-50 text-emerald-700' :
                    s.settlement_status === 'ELIGIBLE_FOR_PAYOUT' ? 'bg-blue-50 text-blue-700' :
                    s.settlement_status === 'HOLD' ? 'bg-gray-100 text-gray-500' :
                    s.settlement_status === 'CANCELLED' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
                  ]"
                >
                  {{ settlementLabel(s.settlement_status) }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- T-N01: seller payouts (bank transfers by the operator) -->
      <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
        <div class="px-5 pt-4 pb-2">
          <h3 class="text-sm font-black text-gray-900">정산 지급 내역</h3>
          <p class="text-[11px] text-gray-500">운영자가 승인·송금한 정산 지급 건입니다. 송금 참조번호는 실제 이체 완료 후 표시됩니다.</p>
        </div>
        <OmEmptyState
          v-if="payouts.length === 0"
          compact
          title="아직 지급된 정산이 없습니다."
          description="운영자가 지급을 승인하면 이곳에 표시됩니다."
        >
          <OmButton size="sm" @click="loadSettlements">다시 불러오기</OmButton>
        </OmEmptyState>
        <table v-else class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="bg-gray-50 text-gray-500 border-b border-gray-200 uppercase">
              <th class="py-3.5 px-5 font-bold">지급 ID</th>
              <th class="py-3.5 px-5 font-bold">실지급액</th>
              <th class="py-3.5 px-5 font-bold">정산 합계(조정 포함)</th>
              <th class="py-3.5 px-5 font-bold">리저브 보류/해제</th>
              <th class="py-3.5 px-5 font-bold">상태</th>
              <th class="py-3.5 px-5 font-bold">송금 참조</th>
              <th class="py-3.5 px-5 font-bold">지급일</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="p in payouts" :key="p.id" class="hover:bg-gray-50">
              <td class="py-3.5 px-5 font-mono font-bold text-gray-900">{{ p.id }}</td>
              <td class="py-3.5 px-5 font-black text-emerald-600">₩{{ Number(p.amount || 0).toLocaleString() }}</td>
              <td class="py-3.5 px-5 text-gray-600">₩{{ Number(p.gross_amount || 0).toLocaleString() }}</td>
              <td class="py-3.5 px-5 text-gray-600">−₩{{ Number(p.reserve_held || 0).toLocaleString() }} / +₩{{ Number(p.reserve_released || 0).toLocaleString() }}</td>
              <td class="py-3.5 px-5">
                <span :class="['px-2.5 py-0.5 rounded-full text-[11px] font-black', p.status === 'TRANSFERRED' ? 'bg-emerald-50 text-emerald-700' : p.status === 'CANCELLED' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700']">
                  {{ payoutLabel(p.status) }}
                </span>
              </td>
              <td class="py-3.5 px-5 font-mono text-gray-600">{{ p.bank_transfer_ref || '-' }}</td>
              <td class="py-3.5 px-5 text-gray-600">{{ p.created_at ? String(p.created_at).slice(0, 10) : '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- NEW-15: commission tax invoices for this seller -->
      <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
        <div class="px-5 pt-4 pb-2">
          <h3 class="text-sm font-black text-gray-900">수수료 세금계산서</h3>
          <p class="text-[11px] text-gray-500">정산 기간별 플랫폼 수수료에 대해 운영자가 발행한 세금계산서입니다.</p>
        </div>
        <div v-if="taxLoading" class="p-8 text-center text-xs text-gray-500 font-bold">세금계산서 내역을 불러오는 중입니다...</div>
        <div v-else-if="taxError" class="p-8 text-center">
          <p class="text-xs text-red-600 font-bold">{{ taxError }}</p>
          <OmButton size="sm" @click="loadTaxInvoices">다시 불러오기</OmButton>
        </div>
        <OmEmptyState
          v-else-if="taxInvoices.length === 0"
          compact
          title="발행된 수수료 세금계산서가 없습니다."
          description="수수료 세금계산서가 발행되면 이곳에 표시됩니다."
        >
          <OmButton size="sm" @click="loadTaxInvoices">다시 불러오기</OmButton>
        </OmEmptyState>
        <table v-else class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="bg-gray-50 text-gray-500 border-b border-gray-200 uppercase">
              <th class="py-3.5 px-5 font-bold">정산 기간</th>
              <th class="py-3.5 px-5 font-bold">공급가액</th>
              <th class="py-3.5 px-5 font-bold">부가세</th>
              <th class="py-3.5 px-5 font-bold">합계</th>
              <th class="py-3.5 px-5 font-bold">상태</th>
              <th class="py-3.5 px-5 font-bold">국세청 승인번호</th>
              <th class="py-3.5 px-5 font-bold">발행일</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="t in taxInvoices" :key="t.id" class="hover:bg-gray-50">
              <td class="py-3.5 px-5 font-mono text-gray-600">{{ t.period_start }} ~ {{ t.period_end }}</td>
              <td class="py-3.5 px-5 font-bold">₩{{ Number(t.supply_amount || 0).toLocaleString() }}</td>
              <td class="py-3.5 px-5">₩{{ Number(t.vat_amount || 0).toLocaleString() }}</td>
              <td class="py-3.5 px-5 font-black">₩{{ Number(t.total_amount || 0).toLocaleString() }}</td>
              <td class="py-3.5 px-5">
                <span :class="['px-2.5 py-0.5 rounded-full text-[11px] font-black', t.issue_status === 'ISSUED' ? 'bg-emerald-50 text-emerald-700' : t.issue_status === 'FAILED' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700']">
                  {{ invoiceLabel(t.issue_status) }}
                </span>
              </td>
              <td class="py-3.5 px-5 font-mono text-gray-600">{{ t.hometax_approval_no || '-' }}</td>
              <td class="py-3.5 px-5 text-gray-600">{{ t.issued_at ? String(t.issued_at).slice(0, 10) : '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
