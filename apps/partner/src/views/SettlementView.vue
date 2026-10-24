<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../config'

const settlements = ref<any[]>([])
const summary = ref<any>({ gross_sales: 0, total_commission: 0, net_payout: 0, paid_amount: 0, pending_amount: 0 })
const loading = ref(true)

const loadSettlements = async () => {
  loading.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/settlements`, {
      headers: getPartnerHeaders()
    })
    const json = await res.json()
    if (json.success && json.data) {
      settlements.value = json.data.settlements || []
      summary.value = json.data.summary || summary.value
    }
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

const exportSettlementCsv = () => {
  const rows = ['id,order_id,gross_amount,commission_rate,commission_amount,shipping_fee,net_payout_amount,settlement_status,created_at']
  for (const s of settlements.value) {
    rows.push(`${s.id},${s.order_id},${s.gross_amount},${s.commission_rate},${s.commission_amount},${s.shipping_fee},${s.net_payout_amount},${s.settlement_status},${s.created_at}`)
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'partner_settlement_ledger.csv'
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(loadSettlements)
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-xl font-black text-gray-900">Automated Partner Settlement Ledger (Live D1)</h2>
        <p class="text-xs text-gray-500">Real-time commission calculation and escrow payout status per order</p>
      </div>
      <button @click="exportSettlementCsv" class="px-4 py-2 rounded-xl bg-gray-900 text-white text-xs font-bold cursor-pointer">
        ⬇ Export Tax & Settlement CSV
      </button>
    </div>

    <!-- Summary KPI Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-4 gap-4">
      <div class="bg-white rounded-2xl p-4 border border-gray-200">
        <div class="text-[11px] font-bold text-gray-400 uppercase">Gross Non-Cancelled Sales</div>
        <div class="text-xl font-black text-gray-900 mt-1">₩{{ Number(summary.gross_sales || 0).toLocaleString() }}</div>
      </div>
      <div class="bg-white rounded-2xl p-4 border border-gray-200">
        <div class="text-[11px] font-bold text-gray-400 uppercase">Platform Commission</div>
        <div class="text-xl font-black text-red-600 mt-1">-₩{{ Number(summary.total_commission || 0).toLocaleString() }}</div>
      </div>
      <div class="bg-white rounded-2xl p-4 border border-gray-200">
        <div class="text-[11px] font-bold text-gray-400 uppercase">Net Partner Payout</div>
        <div class="text-xl font-black text-emerald-600 mt-1">₩{{ Number(summary.net_payout || 0).toLocaleString() }}</div>
      </div>
      <div class="bg-white rounded-2xl p-4 border border-gray-200">
        <div class="text-[11px] font-bold text-gray-400 uppercase">Escrow Pending / Paid</div>
        <div class="text-xs font-bold text-gray-700 mt-2">
          Pending: <span class="text-amber-600">₩{{ Number(summary.pending_amount || 0).toLocaleString() }}</span> •
          Paid: <span class="text-emerald-600">₩{{ Number(summary.paid_amount || 0).toLocaleString() }}</span>
        </div>
      </div>
    </div>

    <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
      <table class="w-full text-left border-collapse text-xs">
        <thead>
          <tr class="bg-gray-50 text-gray-500 border-b border-gray-200 uppercase">
            <th class="py-3.5 px-5 font-bold">Settlement ID</th>
            <th class="py-3.5 px-5 font-bold">Order ID</th>
            <th class="py-3.5 px-5 font-bold">Gross Sales</th>
            <th class="py-3.5 px-5 font-bold">Commission</th>
            <th class="py-3.5 px-5 font-bold">Shipping Fee</th>
            <th class="py-3.5 px-5 font-bold">Net Payout</th>
            <th class="py-3.5 px-5 font-bold">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="s in settlements" :key="s.id" class="hover:bg-gray-50">
            <td class="py-3.5 px-5 font-mono font-bold text-gray-900">{{ s.id }}</td>
            <td class="py-3.5 px-5 font-mono text-gray-600">{{ s.order_id }}</td>
            <td class="py-3.5 px-5 font-bold">₩{{ Number(s.gross_amount || 0).toLocaleString() }}</td>
            <td class="py-3.5 px-5 text-red-600 font-semibold">-₩{{ Number(s.commission_amount || 0).toLocaleString() }} ({{ s.commission_rate }}%)</td>
            <td class="py-3.5 px-5 text-gray-600">+₩{{ Number(s.shipping_fee || 0).toLocaleString() }}</td>
            <td class="py-3.5 px-5 font-black text-emerald-600 text-sm">₩{{ Number(s.net_payout_amount || 0).toLocaleString() }}</td>
            <td class="py-3.5 px-5">
              <span
                :class="[
                  'px-2.5 py-0.5 rounded-full text-[11px] font-black',
                  s.settlement_status === 'PAID' ? 'bg-emerald-50 text-emerald-700' :
                  s.settlement_status === 'CANCELLED' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
                ]"
              >
                {{ s.settlement_status }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
