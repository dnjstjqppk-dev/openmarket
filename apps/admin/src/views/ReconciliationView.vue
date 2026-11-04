<script setup lang="ts">
// 데이터 대사(R01~R17) · 시산표 · 판매자 지급. 모든 수치는 원장/DB 실데이터에서 계산된다.
import { ref, onMounted, computed } from 'vue'
import { adminApi, won } from '../config'

const recon = ref<any>(null)
const trial = ref<any[]>([])
const payouts = ref<any>({ payouts: [], pending: [] })
const loading = ref(false)
const msg = ref('')
const failing = computed(() => (recon.value?.checks || []).filter((c: any) => !c.ok))

async function load() {
  loading.value = true
  const [a, b, c] = await Promise.all([adminApi('/api/v1/admin/reconciliation'), adminApi('/api/v1/admin/finance/trial-balance'), adminApi('/api/v1/admin/finance/payouts')])
  recon.value = a.data.data
  trial.value = b.data.data || []
  payouts.value = c.data.data || { payouts: [], pending: [] }
  loading.value = false
}
async function pay(p: any) {
  if (!confirm(`${p.business_name}에 ${won(p.amount)} 지급을 승인합니다. 실제 이체는 은행에서 별도로 진행합니다.`)) return
  const r = await adminApi('/api/v1/admin/finance/payouts', { method: 'POST', json: { partner_id: p.partner_id } })
  msg.value = r.ok ? `지급 승인 ${r.data.data.payout_id} · ${won(r.data.data.amount)} — 이체 후 참조번호를 기록하세요.` : (r.data.error || '지급 실패')
  load()
}
async function markTransferred(po: any) {
  const ref = prompt('은행 이체 참조번호')
  if (!ref) return
  const r = await adminApi(`/api/v1/admin/finance/payouts/${po.id}/transferred`, { method: 'POST', json: { bank_transfer_ref: ref } })
  msg.value = r.ok ? '이체 완료로 기록되었습니다.' : (r.data.error || '기록 실패')
  load()
}
onMounted(load)
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 py-6 space-y-5 text-xs">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div><h1 class="text-xl font-black">데이터 대사 · 원장 · 판매자 지급</h1>
        <p class="text-slate-500 mt-1">주문·결제·환불·정산·재고·적립금을 복식부기 원장과 교차 검증합니다.</p></div>
      <button class="h-9 px-4 rounded-lg bg-slate-900 text-white font-bold" :disabled="loading" @click="load">{{ loading ? '검증 중...' : '다시 검증' }}</button>
    </div>
    <div v-if="msg" role="status" class="p-3 rounded-lg bg-indigo-50 text-indigo-900 font-bold">{{ msg }}</div>

    <section v-if="recon" class="bg-white rounded-xl border p-4" :class="recon.ok ? 'border-emerald-300' : 'border-red-300'">
      <div class="text-sm font-black" :class="recon.ok ? 'text-emerald-700' : 'text-red-700'" data-testid="recon-status">
        {{ recon.ok ? `전체 ${recon.checks.length}개 검증 통과` : `${failing.length}개 검증 실패` }} <span class="font-normal text-slate-400">({{ recon.checked_at }})</span>
      </div>
      <ul class="mt-3 grid sm:grid-cols-2 gap-1">
        <li v-for="c in recon.checks" :key="c.id" class="flex gap-2"><span :class="c.ok ? 'text-emerald-600' : 'text-red-600'">{{ c.ok ? '✓' : '✗' }}</span><span><b>{{ c.id }}</b> {{ c.name }}<span v-if="!c.ok" class="text-red-600"> — {{ c.violation_count }}건</span></span></li>
      </ul>
      <pre v-for="c in failing" :key="c.id + 'v'" class="mt-2 p-2 bg-red-50 rounded overflow-x-auto text-[10px]">{{ c.id }} {{ JSON.stringify(c.violations, null, 1) }}</pre>
    </section>

    <section class="bg-white rounded-xl border border-slate-200 p-4">
      <h2 class="font-black text-sm mb-2">판매자 지급 대기</h2>
      <table class="w-full"><thead class="text-slate-500"><tr><th class="text-left p-1">판매자</th><th class="text-right p-1">정산 건</th><th class="text-right p-1">이월 차감</th><th class="text-right p-1">지급액</th><th></th></tr></thead>
        <tbody><tr v-for="p in payouts.pending" :key="p.partner_id" class="border-t">
          <td class="p-1">{{ p.business_name }}</td><td class="p-1 text-right">{{ p.settlements }}</td><td class="p-1 text-right">{{ p.carried_adjustments }}</td>
          <td class="p-1 text-right font-bold" :class="p.amount <= 0 ? 'text-red-600' : ''">{{ won(p.amount) }}</td>
          <td class="p-1 text-right"><button :disabled="p.amount <= 0" class="px-3 py-1 rounded bg-indigo-600 disabled:bg-slate-300 text-white font-bold" @click="pay(p)">지급 승인</button></td>
        </tr><tr v-if="!payouts.pending.length"><td colspan="5" class="p-3 text-center text-slate-400">구매확정된 지급 대상이 없습니다.</td></tr></tbody></table>
      <h3 class="font-bold mt-4 mb-1">지급 이력</h3>
      <table class="w-full"><tbody><tr v-for="po in payouts.payouts" :key="po.id" class="border-t">
        <td class="p-1 font-mono">{{ po.id.slice(0, 14) }}</td><td class="p-1">{{ po.business_name }}</td><td class="p-1 text-right">{{ won(po.amount) }}</td>
        <td class="p-1">{{ po.status === 'TRANSFERRED' ? `이체 완료 (${po.bank_transfer_ref})` : '승인 · 이체 대기' }}</td>
        <td class="p-1 text-right"><button v-if="po.status === 'APPROVED'" class="px-2 py-1 rounded border" @click="markTransferred(po)">이체 기록</button></td>
      </tr></tbody></table>
    </section>

    <section class="bg-white rounded-xl border border-slate-200 p-4 overflow-x-auto">
      <h2 class="font-black text-sm mb-2">시산표 (사업자별 계정 잔액)</h2>
      <table class="w-full min-w-[600px]"><thead class="text-slate-500"><tr><th class="text-left p-1">사업자</th><th class="text-left p-1">계정</th><th class="text-right p-1">차변</th><th class="text-right p-1">대변</th><th class="text-right p-1">잔액(차-대)</th></tr></thead>
        <tbody><tr v-for="r in trial" :key="(r.entity_id || '-') + r.account_code" class="border-t">
          <td class="p-1 font-mono">{{ r.entity_id || '(개시잔액)' }}</td><td class="p-1">{{ r.account_code }}</td>
          <td class="p-1 text-right">{{ won(r.debit) }}</td><td class="p-1 text-right">{{ won(r.credit) }}</td><td class="p-1 text-right font-bold">{{ won(r.balance) }}</td>
        </tr></tbody></table>
    </section>
  </div>
</template>
