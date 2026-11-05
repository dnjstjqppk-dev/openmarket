<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { API_BASE_URL, getAdminHeaders } from '../config'
const router = useRouter()

const settlements = ref<any[]>([])
const inventoryLogs = ref<any[]>([])
const claims = ref<any[]>([])
const taxInvoices = ref<any[]>([])
const loading = ref(true)
const actionMsg = ref('')

const loadLedgers = async () => {
  loading.value = true
  try {
    const [res, claimRes, taxRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/admin/ledgers`, { headers: getAdminHeaders() }),
      fetch(`${API_BASE_URL}/api/v1/admin/claims`, { headers: getAdminHeaders() }),
      fetch(`${API_BASE_URL}/api/v1/finance/tax-invoices`, { headers: getAdminHeaders() }).catch(() => null)
    ])
    const json = await res.json()
    const claimJson = await claimRes.json()
    if (json.success) {
      settlements.value = (Array.isArray(json.data) ? json.data : (json.data.settlements || [])).map((s: any) => ({ ...s, settlement_status: s.status === 'PAID_OUT' ? 'PAID' : s.status }))
      inventoryLogs.value = Array.isArray(json.data) ? [] : (json.data.inventory_ledger || [])
    }
    if (claimJson.success) {
      claims.value = claimJson.data || []
    }
    if (taxRes && taxRes.ok) {
      const taxJson = await taxRes.json()
      if (taxJson.success) taxInvoices.value = taxJson.data || []
    }
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

const approveSettlement = async (_settlementId: string) => {
  // Individual settlement approval was replaced by per-seller payouts (with post-payout refund deductions).
  router.push('/reconciliation')
}

const resolveClaim = async (claimId: string, status: string) => {
  const res = await fetch(`${API_BASE_URL}/api/v1/admin/claims/${claimId}`, {
    method: 'PUT',
    headers: getAdminHeaders(),
    body: JSON.stringify(status === 'REJECTED' ? { decision: 'REJECT', notes: prompt('거절 사유') || '' } : { decision: 'APPROVE' })
  })
  const json = await res.json()
  actionMsg.value = json.success ? `✓ 클레임 ${claimId} 처리 완료 (${json.status})` : `⚠ ${json.error || '처리 실패'}`
  await loadLedgers()
}

onMounted(loadLedgers)
</script>

<template>
  <div class="space-y-8">
    <div v-if="actionMsg" class="p-4 rounded-xl bg-indigo-50 border border-indigo-200 text-xs font-bold text-indigo-800">
      {{ actionMsg }}
    </div>

    <div>
      <h2 class="text-xl font-black text-gray-900 mb-1">Partner Settlement Ledger & Escrow Payout Approval</h2>
      <p class="text-xs text-gray-500 mb-4">Approve pending partner settlements to release escrow payouts</p>

      <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="bg-gray-50 text-gray-500 border-b border-gray-200 uppercase">
              <th class="py-3.5 px-5 font-bold">Settlement ID</th>
              <th class="py-3.5 px-5 font-bold">Order ID</th>
              <th class="py-3.5 px-5 font-bold">Partner</th>
              <th class="py-3.5 px-5 font-bold">Gross</th>
              <th class="py-3.5 px-5 font-bold">Fee</th>
              <th class="py-3.5 px-5 font-bold">Net Payout</th>
              <th class="py-3.5 px-5 font-bold">Status / Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="s in settlements" :key="s.id" class="hover:bg-gray-50">
              <td class="py-3 px-5 font-mono font-bold">{{ s.id }}</td>
              <td class="py-3 px-5 font-mono text-gray-600">{{ s.order_id }}</td>
              <td class="py-3 px-5 font-bold">{{ s.partner_id }}</td>
              <td class="py-3 px-5 font-bold">₩{{ s.gross_amount?.toLocaleString() }}</td>
              <td class="py-3 px-5 text-red-600">-₩{{ s.commission_amount?.toLocaleString() }} ({{ s.commission_rate }}%)</td>
              <td class="py-3 px-5 font-black text-emerald-600">₩{{ s.net_payout_amount?.toLocaleString() }}</td>
              <td class="py-3 px-5 flex items-center gap-2">
                <span :class="['px-2 py-0.5 rounded font-bold', s.settlement_status === 'PAID' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700']">
                  {{ s.settlement_status }}
                </span>
                <button
                  v-if="s.settlement_status === 'ELIGIBLE_FOR_PAYOUT'"
                  @click="approveSettlement(s.id)"
                  class="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold cursor-pointer"
                >
                  Approve Payout
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Buyer Protection Claims Governance -->
    <div v-if="claims.length > 0">
      <h2 class="text-xl font-black text-gray-900 mb-1">Buyer Protection Claims (Return / Exchange / 30-Day Price Match)</h2>
      <p class="text-xs text-gray-500 mb-4">Audit and resolve customer return or price-adjustment requests</p>
      <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="bg-gray-50 text-gray-500 border-b border-gray-200 uppercase">
              <th class="py-3 px-5 font-bold">Claim ID</th>
              <th class="py-3 px-5 font-bold">Order ID</th>
              <th class="py-3 px-5 font-bold">Type</th>
              <th class="py-3 px-5 font-bold">Reason</th>
              <th class="py-3 px-5 font-bold">Refund Amount</th>
              <th class="py-3 px-5 font-bold">Status / Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="cl in claims" :key="cl.id">
              <td class="py-3 px-5 font-mono font-bold">{{ cl.id }}</td>
              <td class="py-3 px-5 font-mono">{{ cl.order_id }}</td>
              <td class="py-3 px-5 font-black text-indigo-600">{{ cl.type }}</td>
              <td class="py-3 px-5 text-gray-600">{{ cl.reason }}</td>
              <td class="py-3 px-5 font-bold">₩{{ Number(cl.refund_amount || 0).toLocaleString() }}</td>
              <td class="py-3 px-5 flex items-center gap-2">
                <span class="px-2 py-0.5 rounded bg-gray-100 font-bold">{{ cl.status }}</span>
                <button
                  v-if="cl.status === 'REQUESTED'"
                  @click="resolveClaim(cl.id, 'APPROVED')"
                  class="px-2.5 py-1 rounded bg-emerald-600 text-white text-[11px] font-bold cursor-pointer"
                >
                  Approve Refund
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <h2 class="text-xl font-black text-gray-900 mb-1">전자세금계산서 및 현금영수증 국세청(홈택스) 전송 원장</h2>
      <p class="text-xs text-gray-500 mb-4">주문 및 정산 건별 법정 전자세금계산서 승인번호 및 국세청 전송 상태를 실시간 감시합니다.</p>

      <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="bg-gray-50 text-gray-500 border-b border-gray-200 uppercase">
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
          <tbody class="divide-y divide-gray-100">
            <tr v-for="t in taxInvoices" :key="t.id" class="hover:bg-gray-50">
              <td class="py-3 px-5 font-mono font-bold text-indigo-700">{{ t.issue_number }}</td>
              <td class="py-3 px-5 font-mono">{{ t.order_id }}</td>
              <td class="py-3 px-5 font-bold">{{ t.seller_name || t.partner_id }}</td>
              <td class="py-3 px-5"><span class="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold">{{ t.tax_type }}</span></td>
              <td class="py-3 px-5 text-right">{{ Number(t.supply_amount || 0).toLocaleString() }}원</td>
              <td class="py-3 px-5 text-right">{{ Number(t.vat_amount || 0).toLocaleString() }}원</td>
              <td class="py-3 px-5 text-right font-black">{{ Number(t.total_amount || 0).toLocaleString() }}원</td>
              <td class="py-3 px-5 text-center">
                <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                  {{ t.nts_status === 'APPROVED' ? '✓ 국세청 승인' : t.nts_status }}
                </span>
              </td>
            </tr>
            <tr v-if="taxInvoices.length === 0">
              <td colspan="8" class="py-8 text-center text-gray-400">발행된 전자세금계산서 내역이 없습니다.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <h2 class="text-xl font-black text-gray-900 mb-1">Immutable Inventory Movement Ledger</h2>
      <p class="text-xs text-gray-500 mb-4">Every SKU stock deduction, restock, and cancellation rollback</p>

      <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="bg-gray-50 text-gray-500 border-b border-gray-200 uppercase">
              <th class="py-3.5 px-5 font-bold">Ledger ID</th>
              <th class="py-3.5 px-5 font-bold">SKU ID</th>
              <th class="py-3.5 px-5 font-bold">Change Type</th>
              <th class="py-3.5 px-5 font-bold">Delta</th>
              <th class="py-3.5 px-5 font-bold">Reason</th>
              <th class="py-3.5 px-5 font-bold">Timestamp</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="log in inventoryLogs" :key="log.id" class="hover:bg-gray-50">
              <td class="py-3 px-5 font-mono text-gray-600">{{ log.id }}</td>
              <td class="py-3 px-5 font-mono font-bold text-gray-900">{{ log.sku_id }}</td>
              <td class="py-3 px-5 font-bold">{{ log.change_type }}</td>
              <td :class="['py-3 px-5 font-black', log.quantity_delta < 0 ? 'text-red-600' : 'text-emerald-600']">
                {{ log.quantity_delta > 0 ? `+${log.quantity_delta}` : log.quantity_delta }}
              </td>
              <td class="py-3 px-5 text-gray-600">{{ log.reason }}</td>
              <td class="py-3 px-5 text-gray-400">{{ new Date(log.created_at).toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
