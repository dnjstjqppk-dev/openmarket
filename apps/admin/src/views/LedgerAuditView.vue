<script setup lang="ts">
import { LoaderCircle } from 'lucide-vue-next'
import { ref, onMounted } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { API_BASE_URL, getAdminHeaders } from '../config'
const router = useRouter()

const settlements = ref<any[]>([])
const inventoryLogs = ref<any[]>([])
const taxInvoices = ref<any[]>([])
const loading = ref(true)
const actionMsg = ref('')
const loadError = ref('')

const loadLedgers = async () => {
  loading.value = true
  loadError.value = ''
  try {
    const [res, taxRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/admin/ledgers`, { headers: getAdminHeaders() }),
      fetch(`${API_BASE_URL}/api/v1/finance/tax-invoices`, { headers: getAdminHeaders() }).catch(() => null)
    ])
    if (!res.ok) throw new Error(`원장을 불러오지 못했습니다`)
    const json = await res.json()
    if (json.success) {
      settlements.value = (Array.isArray(json.data) ? json.data : (json.data.settlements || [])).map((s: any) => ({ ...s, settlement_status: s.status === 'PAID_OUT' ? 'PAID' : s.status }))
      inventoryLogs.value = Array.isArray(json.data) ? [] : (json.data.inventory_ledger || [])
    }
    if (taxRes && taxRes.ok) {
      const taxJson = await taxRes.json()
      if (taxJson.success) taxInvoices.value = taxJson.data || []
    }
  } catch (e) {
    console.error(e)
    loadError.value = '원장을 불러오지 못했습니다. 빈 표는 정산 완료가 아닙니다 — 다시 시도해 주세요.'
  } finally {
    loading.value = false
  }
}

// P1-A11: this button never approved anything — it navigates to the payout desk,
// carrying the partner so the pending payout is preselected there.
const approveSettlement = async (s: any) => {
  // Individual settlement approval was replaced by per-seller payouts (with post-payout refund deductions).
  router.push({ path: '/finance/batches', query: s?.partner_id ? { partner_id: s.partner_id } : {} })
}

onMounted(loadLedgers)
</script>

<template>
  <div class="space-y-8">
    <div v-if="actionMsg" class="p-4 rounded-xl bg-primary-soft border border-line text-xs font-bold text-primary-soft-ink">
      {{ actionMsg }}
    </div>

    <div v-if="loadError" role="alert" class="p-4 rounded-xl bg-danger-soft border border-line text-xs font-bold text-danger flex flex-wrap items-center justify-between gap-3">
      <span>문제가 발생했습니다. 잠시 후 다시 시도해주세요. ({{ loadError }})</span>
      <button @click="loadLedgers" class="px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary-hover text-secondary-on font-bold cursor-pointer">
        다시 시도
      </button>
    </div>

    <div v-if="loading" class="p-12 text-center text-ink-subtle text-xs">
      <LoaderCircle class="h-4 w-4 animate-spin mr-2" aria-hidden="true" />원장을 불러오는 중입니다...
    </div>

    <div v-if="!loading && !loadError" class="space-y-8">
    <div>
      <h2 class="text-xl font-bold text-ink mb-1">Partner Settlement Ledger & Escrow Payout Approval</h2>
      <p class="text-xs text-ink-muted mb-4">Approve pending partner settlements to release escrow payouts</p>

      <div class="bg-surface rounded-2xl border border-line overflow-hidden shadow-2xs">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="bg-surface-2 text-ink-muted border-b border-line uppercase">
              <th class="py-3.5 px-5 font-bold">Settlement ID</th>
              <th class="py-3.5 px-5 font-bold">Order ID</th>
              <th class="py-3.5 px-5 font-bold">Partner</th>
              <th class="py-3.5 px-5 font-bold">Gross</th>
              <th class="py-3.5 px-5 font-bold">Fee</th>
              <th class="py-3.5 px-5 font-bold">Net Payout</th>
              <th class="py-3.5 px-5 font-bold">Status / Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-for="s in settlements" :key="s.id" class="hover:bg-surface-2">
              <td class="py-3 px-5 font-mono font-bold text-ink">{{ s.id }}</td>
              <td class="py-3 px-5 font-mono text-ink-muted">{{ s.order_id }}</td>
              <td class="py-3 px-5 font-bold text-ink">{{ s.partner_id }}</td>
              <td class="py-3 px-5 font-bold text-ink">₩{{ s.gross_amount?.toLocaleString() }}</td>
              <td class="py-3 px-5 text-danger">-₩{{ s.commission_amount?.toLocaleString() }} ({{ s.commission_rate }}%)</td>
              <td class="py-3 px-5 font-bold text-success">₩{{ s.net_payout_amount?.toLocaleString() }}</td>
              <td class="py-3 px-5 flex items-center gap-2">
                <span :class="['px-2 py-0.5 rounded font-bold', s.settlement_status === 'PAID' ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning']">
                  {{ s.settlement_status }}
                </span>
                <button
                  v-if="s.settlement_status === 'ELIGIBLE_FOR_PAYOUT'"
                  @click="approveSettlement(s)"
                  class="px-2.5 py-1 rounded-lg bg-primary hover:bg-primary-hover text-primary-on text-[11px] font-bold cursor-pointer"
                >
                  지급 화면으로 이동
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <RouterLink to="/claims" class="text-xs font-bold text-primary hover:underline">분쟁 판정은 클레임 화면에서 처리합니다 →</RouterLink>
    </div>

    <div>
      <h2 class="text-xl font-bold text-ink mb-1">전자세금계산서 및 현금영수증 국세청(홈택스) 전송 원장</h2>
      <p class="text-xs text-ink-muted mb-4">주문 및 정산 건별 법정 전자세금계산서 승인번호 및 국세청 전송 상태를 실시간 감시합니다.</p>

      <div class="bg-surface rounded-2xl border border-line overflow-hidden shadow-2xs">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="bg-surface-2 text-ink-muted border-b border-line uppercase">
              <th class="py-3.5 px-5 font-bold">국세청 승인번호</th>
              <th class="py-3.5 px-5 font-bold">주문 ID</th>
              <th class="py-3.5 px-5 font-bold">공급자 (파트너)</th>
              <th class="py-3.5 px-5 font-bold">과세 구분</th>
              <th class="py-3.5 px-5 font-bold text-right">공급가액</th>
              <th class="py-3.5 px-5 font-bold text-right">세액</th>
              <th class="py-3.5 px-5 font-bold text-right">합계금액</th>
              <th class="py-3.5 px-5 font-bold text-center">전송 상태</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-for="t in taxInvoices" :key="t.id" class="hover:bg-surface-2">
              <td class="py-3 px-5 font-mono font-bold text-primary">{{ t.issue_number }}</td>
              <td class="py-3 px-5 font-mono text-ink">{{ t.order_id }}</td>
              <td class="py-3 px-5 font-bold text-ink">{{ t.seller_name || t.partner_id }}</td>
              <td class="py-3 px-5"><span class="px-2 py-0.5 rounded bg-surface-2 text-[10px] font-bold text-ink-muted">{{ t.tax_type }}</span></td>
              <td class="py-3 px-5 text-right text-ink">{{ Number(t.supply_amount || 0).toLocaleString() }}원</td>
              <td class="py-3 px-5 text-right text-ink">{{ Number(t.vat_amount || 0).toLocaleString() }}원</td>
              <td class="py-3 px-5 text-right font-bold text-ink">{{ Number(t.total_amount || 0).toLocaleString() }}원</td>
              <td class="py-3 px-5 text-center">
                <span class="px-2 py-0.5 rounded-full bg-success-soft text-success text-[10px] font-bold">
                  {{ t.nts_status === 'APPROVED' ? '✓ 국세청 승인' : t.nts_status }}
                </span>
              </td>
            </tr>
            <tr v-if="taxInvoices.length === 0">
              <td colspan="8" class="py-8 text-center text-ink-subtle">발행된 전자세금계산서 내역이 없습니다.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <h2 class="text-xl font-bold text-ink mb-1">Immutable Inventory Movement Ledger</h2>
      <p class="text-xs text-ink-muted mb-4">Every SKU stock deduction, restock, and cancellation rollback</p>

      <div class="bg-surface rounded-2xl border border-line overflow-hidden shadow-2xs">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="bg-surface-2 text-ink-muted border-b border-line uppercase">
              <th class="py-3.5 px-5 font-bold">Ledger ID</th>
              <th class="py-3.5 px-5 font-bold">SKU ID</th>
              <th class="py-3.5 px-5 font-bold">Change Type</th>
              <th class="py-3.5 px-5 font-bold">Delta</th>
              <th class="py-3.5 px-5 font-bold">Reason</th>
              <th class="py-3.5 px-5 font-bold">Timestamp</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line-divider">
            <tr v-for="log in inventoryLogs" :key="log.id" class="hover:bg-surface-2">
              <td class="py-3 px-5 font-mono text-ink-muted">{{ log.id }}</td>
              <td class="py-3 px-5 font-mono font-bold text-ink">{{ log.sku_id }}</td>
              <td class="py-3 px-5 font-bold text-ink">{{ log.change_type }}</td>
              <td :class="['py-3 px-5 font-bold', log.quantity_delta < 0 ? 'text-danger' : 'text-success']">
                {{ log.quantity_delta > 0 ? `+${log.quantity_delta}` : log.quantity_delta }}
              </td>
              <td class="py-3 px-5 text-ink-muted">{{ log.reason }}</td>
              <td class="py-3 px-5 text-ink-subtle">{{ new Date(log.created_at).toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    </div>
  </div>
</template>
