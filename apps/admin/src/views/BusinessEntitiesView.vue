<script setup lang="ts">
// 운영 사업자 관리: 개인사업자 → 법인 전환. 기존 거래는 당시 사업자에 귀속된 채 보존되고, 전환 시점 이후 거래만 새 사업자에 귀속된다.
import { ref, onMounted } from 'vue'
import { adminApi, won } from '../config'

const entities = ref<any[]>([])
const loading = ref(true)
const msg = ref('')
const msgTone = ref<'ok' | 'err'>('ok')
const obligations = ref<Record<string, any>>({})
const showForm = ref(false)
const form = ref<any>({ entity_type: 'INDIVIDUAL', tax_type: 'GENERAL' })
const confirmReview = ref<Record<string, boolean>>({})

const FIELDS: [string, string, boolean][] = [
  ['legal_name', '상호(법인명)', true], ['representative_name', '대표자', true], ['business_reg_number', '사업자등록번호(10자리)', true],
  ['corporate_reg_number', '법인등록번호(법인만)', false], ['mail_order_reg_number', '통신판매업 신고번호', true], ['address', '사업장 주소', true],
  ['cs_phone', '고객센터 전화', true], ['cs_email', '고객센터 이메일', true], ['privacy_officer_name', '개인정보보호책임자', true],
  ['privacy_officer_email', '개인정보보호책임자 이메일', true], ['hosting_provider', '호스팅 제공자', false], ['pg_provider', 'PG사', false],
  ['pg_merchant_ref', 'PG 가맹점 계약 참조(키 아님)', false], ['escrow_service_ref', '구매안전서비스 가입 정보', false],
  ['settlement_bank_ref', '정산 계좌 참조(마스킹)', false], ['terms_version', '약관 버전', false]
]

function say(t: string, tone: 'ok' | 'err' = 'ok') { msg.value = t; msgTone.value = tone }

async function load() {
  loading.value = true
  const r = await adminApi('/api/v1/admin/business-entities')
  entities.value = r.data.data || []
  loading.value = false
  for (const e of entities.value) if (e.status !== 'DRAFT') loadObligations(e.id)
}
async function loadObligations(id: string) {
  const r = await adminApi(`/api/v1/admin/business-entities/${id}/obligations`)
  if (r.ok) obligations.value = { ...obligations.value, [id]: r.data.data }
}
async function create() {
  const r = await adminApi('/api/v1/admin/business-entities', { method: 'POST', json: form.value })
  if (!r.ok) return say(r.data.error || '등록 실패', 'err')
  say('사업자 정보가 DRAFT(등록 대기)로 저장되었습니다. 검토 후 활성화하세요.')
  showForm.value = false
  form.value = { entity_type: 'INDIVIDUAL', tax_type: 'GENERAL' }
  load()
}
async function activate(e: any) {
  if (!confirmReview.value[e.id]) return say('세무·법률·PG 계약 검토 완료를 확인해 주세요.', 'err')
  if (!confirm(`${e.legal_name}을(를) 현재 운영 사업자로 전환합니다. 이후 모든 신규 주문·정산이 이 사업자에 귀속됩니다. 진행할까요?`)) return
  const r = await adminApi(`/api/v1/admin/business-entities/${e.id}/activate`, { method: 'POST', json: { confirm_legal_review: true, note: '관리자 콘솔 전환' } })
  if (!r.ok) return say(r.data.error || '전환 실패', 'err')
  say(`전환 완료 (${r.data.data.effective_at}). 이전 사업자의 미결 채무를 아래에서 확인하세요.`)
  load()
}
onMounted(load)
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 py-6 space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-black">운영 사업자 · 법인 전환</h1>
        <p class="text-xs text-slate-500 mt-1">거래 기록은 발생 당시의 운영 사업자에 귀속되며 일괄 변경할 수 없습니다(DB 트리거로 강제).</p>
      </div>
      <button class="h-10 px-4 rounded-lg bg-indigo-600 text-white text-xs font-black" @click="showForm = !showForm">+ 사업자 등록</button>
    </div>

    <div v-if="msg" role="status" class="p-3 rounded-lg text-xs font-bold" :class="msgTone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'">{{ msg }}</div>

    <form v-if="showForm" class="bg-white rounded-xl border border-slate-200 p-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs" @submit.prevent="create">
      <label class="block"><span class="font-bold">사업자 유형</span>
        <select v-model="form.entity_type" class="mt-1 w-full h-9 px-2 rounded border border-slate-300"><option value="INDIVIDUAL">개인사업자</option><option value="CORPORATION">법인사업자</option></select></label>
      <label class="block"><span class="font-bold">과세 유형</span>
        <select v-model="form.tax_type" class="mt-1 w-full h-9 px-2 rounded border border-slate-300"><option value="GENERAL">일반과세자</option><option value="SIMPLIFIED">간이과세자</option><option value="TAX_EXEMPT">면세사업자</option></select></label>
      <label v-for="[k, l, req] in FIELDS" :key="k" class="block"><span class="font-bold">{{ l }}<span v-if="req" class="text-red-600">*</span></span>
        <input v-model="form[k]" class="mt-1 w-full h-9 px-2 rounded border border-slate-300" /></label>
      <div class="sm:col-span-2 lg:col-span-3 flex justify-end"><button class="h-10 px-5 rounded-lg bg-slate-900 text-white font-black">DRAFT 저장</button></div>
    </form>

    <div v-if="loading" class="text-xs text-slate-500">불러오는 중...</div>
    <div v-else-if="!entities.length" class="bg-amber-50 border border-amber-200 rounded-xl p-5 text-xs text-amber-900 font-bold">
      등록된 운영 사업자가 없습니다. 사업자 정보를 등록·활성화하기 전에는 주문을 받을 수 없습니다.
    </div>

    <div v-for="e in entities" :key="e.id" class="bg-white rounded-xl border p-5 text-xs" :class="e.status === 'ACTIVE' ? 'border-emerald-400' : 'border-slate-200'">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="text-sm font-black">{{ e.legal_name }}
          <span class="ml-1 px-2 py-0.5 rounded text-[10px]" :class="e.entity_type === 'CORPORATION' ? 'bg-indigo-50 text-indigo-700' : 'bg-orange-50 text-orange-700'">{{ e.entity_type === 'CORPORATION' ? '법인' : '개인' }}</span>
          <span class="ml-1 px-2 py-0.5 rounded text-[10px]" :class="{ 'bg-emerald-100 text-emerald-800': e.status === 'ACTIVE', 'bg-slate-100 text-slate-600': e.status === 'RETIRED', 'bg-amber-100 text-amber-800': e.status === 'DRAFT' }">{{ e.status }}</span>
        </div>
        <div class="text-slate-500">운영기간 {{ e.operating_from || '-' }} ~ {{ e.operating_to || (e.status === 'ACTIVE' ? '현재' : '-') }}</div>
      </div>
      <div class="mt-2 grid sm:grid-cols-3 gap-1 text-slate-600">
        <div>사업자번호 {{ e.business_reg_number }}</div><div>대표 {{ e.representative_name }}</div><div>통신판매업 {{ e.mail_order_reg_number || '미등록' }}</div>
      </div>
      <div v-if="e.status === 'DRAFT'" class="mt-4 flex flex-wrap items-center gap-3 border-t pt-3">
        <label class="flex items-center gap-2"><input type="checkbox" v-model="confirmReview[e.id]" /> 세무·법률·PG·판매자 계약 승계 검토를 완료했습니다</label>
        <button class="h-9 px-4 rounded-lg bg-emerald-600 text-white font-black" @click="activate(e)">현재 운영 사업자로 전환</button>
      </div>
      <div v-if="obligations[e.id]" class="mt-4 border-t pt-3 grid sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <div class="p-2 rounded bg-slate-50"><div class="text-slate-500">결제대기 주문</div><b>{{ obligations[e.id].unpaid_orders.c }}건</b></div>
        <div class="p-2 rounded bg-slate-50"><div class="text-slate-500">진행중 배송</div><b>{{ obligations[e.id].open_fulfilment_sub_orders }}건</b></div>
        <div class="p-2 rounded bg-slate-50"><div class="text-slate-500">환불 가능 잔액</div><b>{{ won(obligations[e.id].refundable_to_customers.pg) }}</b></div>
        <div class="p-2 rounded bg-slate-50"><div class="text-slate-500">미지급 판매자 정산</div><b>{{ won(obligations[e.id].seller_payables.amount) }}</b></div>
        <div class="p-2 rounded bg-slate-50"><div class="text-slate-500">미결 발주</div><b>{{ obligations[e.id].open_purchase_orders }}건</b></div>
        <div class="p-2 rounded bg-slate-50"><div class="text-slate-500">미결 클레임</div><b>{{ obligations[e.id].open_claims }}건</b></div>
      </div>
    </div>
  </div>
</template>
