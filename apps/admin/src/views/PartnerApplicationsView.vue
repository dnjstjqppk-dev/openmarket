<script setup lang="ts">
// 입점 신청 심사 (O05). 서류 열람은 개인정보 접속기록에 남는다. 승인 = 수수료율 + 사업자 상태 확인 근거 필수.
import { ref, reactive, onMounted } from 'vue'
import { adminApi, API_BASE_URL, getAdminToken } from '../config'

const filter = ref('SUBMITTED')
const apps = ref<any[]>([])
const loading = ref(false)
const msg = ref('')
const err = ref('')
const forms = reactive<Record<string, any>>({})
const DOC_LABEL: Record<string, string> = { BUSINESS_REGISTRATION: '사업자등록증', MAIL_ORDER_REGISTRATION: '통신판매업 신고증', BANK_ACCOUNT_COPY: '통장 사본', OTHER: '기타' }
const STATUS_LABEL: Record<string, string> = { DRAFT: '작성 중', SUBMITTED: '심사 대기', RESUBMIT_REQUIRED: '보완 요청됨', APPROVED: '승인', REJECTED: '반려' }

async function load() {
  loading.value = true; err.value = ''
  const r = await adminApi(`/api/v1/admin/partner-applications?kyc_status=${filter.value}`)
  loading.value = false
  if (!r.ok) { err.value = r.data.error || '목록을 불러오지 못했습니다.'; return }
  apps.value = r.data.data || []
  for (const a of apps.value) {
    forms[a.partner_id] = forms[a.partner_id] || { commission_rate: '', business_status_evidence: '', confirm_documents_checked: false, note: '', rejected: [] as string[] }
  }
}

async function openDoc(fileId: string) {
  const res = await fetch(`${API_BASE_URL}/api/v1/storage/file/${fileId}`, { headers: { Authorization: `Bearer ${getAdminToken()}` } })
  if (!res.ok) { err.value = '서류를 열 수 없습니다.'; return }
  const url = URL.createObjectURL(await res.blob())
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function review(a: any, decision: 'APPROVE' | 'REJECT' | 'REQUEST_RESUBMIT') {
  const f = forms[a.partner_id]
  const label = { APPROVE: '승인', REJECT: '반려', REQUEST_RESUBMIT: '보완 요청' }[decision]
  if (!confirm(`${a.business_name} 입점 신청을 ${label}합니다.`)) return
  const body: any = { decision, note: f.note || undefined }
  if (decision === 'APPROVE') Object.assign(body, { commission_rate: f.commission_rate === '' ? undefined : Number(f.commission_rate), business_status_evidence: f.business_status_evidence, confirm_documents_checked: f.confirm_documents_checked })
  if (decision === 'REQUEST_RESUBMIT') body.rejected_document_ids = f.rejected
  const r = await adminApi(`/api/v1/admin/partner-applications/${a.partner_id}/review`, { method: 'POST', json: body })
  if (!r.ok) { err.value = r.data.error || '처리하지 못했습니다.'; return }
  msg.value = `${a.business_name}: ${label} 완료.${r.data.next_step ? ' ' + r.data.next_step : ''}`
  load()
}
onMounted(load)
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-6 space-y-4 text-xs">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-black">입점 신청 심사</h1>
        <p class="text-slate-500 mt-1">서류 원본 대조, 국세청 사업자 상태 조회, 수수료율 확정 후 승인합니다. 정산 계좌 실명 확인은 승인 후 '입점사 관리'에서 별도로 합니다.</p>
      </div>
      <div class="flex gap-2">
        <select v-model="filter" class="h-9 px-2 rounded-lg border" @change="load">
          <option value="SUBMITTED">심사 대기</option><option value="RESUBMIT_REQUIRED">보완 요청됨</option><option value="DRAFT">작성 중</option>
          <option value="APPROVED">승인</option><option value="REJECTED">반려</option><option value="ALL">전체</option>
        </select>
        <button class="h-9 px-4 rounded-lg bg-slate-900 text-white font-bold" :disabled="loading" @click="load">새로고침</button>
      </div>
    </div>
    <p v-if="err" role="alert" class="p-3 rounded-lg bg-red-50 text-red-700 font-bold">{{ err }}</p>
    <p v-if="msg" role="status" class="p-3 rounded-lg bg-indigo-50 text-indigo-900 font-bold">{{ msg }}</p>
    <p v-if="!loading && !apps.length" class="p-6 text-center text-slate-400 bg-white rounded-xl border">해당 상태의 입점 신청이 없습니다.</p>

    <article v-for="a in apps" :key="a.partner_id" class="bg-white rounded-xl border border-slate-200 p-4 space-y-3" data-testid="application-card">
      <div class="flex flex-wrap justify-between gap-2">
        <div>
          <h2 class="text-sm font-black">{{ a.business_name }} <span class="ml-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold">{{ STATUS_LABEL[a.kyc_status] || a.kyc_status }}</span></h2>
          <p class="text-slate-500">사업자 {{ a.business_reg_number }} · 대표 {{ a.representative_name }} · 통신판매업 {{ a.mail_order_reg_number || `면제: ${a.mail_order_exempt_reason}` }}</p>
          <p class="text-slate-500">담당 {{ a.contact_name }} ({{ a.contact_email }}, {{ a.contact_phone }}) · 고객센터 {{ a.customer_service_phone }}</p>
          <p class="text-slate-500">정산 계좌 {{ a.bank_code }} {{ a.bank_account_number }} ({{ a.bank_account_holder }}) · 반품지 {{ a.return_shipping_address }}</p>
        </div>
        <div class="text-slate-400 text-right">신청 {{ a.applied_at }}<br />심사 요청 {{ a.submitted_at || '-' }}</div>
      </div>

      <div class="overflow-x-auto"><table class="w-full min-w-[480px]">
        <thead class="text-slate-500"><tr><th class="text-left p-1">서류</th><th class="text-left p-1">파일</th><th class="text-left p-1">상태</th><th v-if="a.kyc_status === 'SUBMITTED'" class="text-left p-1">보완 요청</th></tr></thead>
        <tbody><tr v-for="d in a.documents.filter((x: any) => x.status !== 'SUPERSEDED')" :key="d.id" class="border-t">
          <td class="p-1 font-bold">{{ DOC_LABEL[d.doc_type] }}</td>
          <td class="p-1"><button type="button" class="underline text-indigo-700" @click="openDoc(d.file_id)">{{ d.original_name }}</button> <span class="text-slate-400">{{ Math.round(d.byte_size / 1024) }}KB</span></td>
          <td class="p-1">{{ d.status }}</td>
          <td v-if="a.kyc_status === 'SUBMITTED'" class="p-1"><input v-model="forms[a.partner_id].rejected" type="checkbox" :value="d.id" :aria-label="`${DOC_LABEL[d.doc_type]} 보완 요청`" /></td>
        </tr></tbody>
      </table></div>
      <p v-if="a.missing_documents.length" class="text-amber-700 font-bold">누락: {{ a.missing_documents.map((x: string) => DOC_LABEL[x]).join(', ') }}</p>
      <p v-if="a.review_note" class="text-slate-600">최근 심사 의견: {{ a.review_note }}</p>

      <div v-if="a.kyc_status === 'SUBMITTED'" class="grid md:grid-cols-2 gap-3 pt-3 border-t">
        <div class="space-y-2">
          <label class="block"><span class="font-bold">수수료율 (%)</span>
            <input v-model="forms[a.partner_id].commission_rate" type="number" min="0" max="50" step="0.01" class="w-full h-9 px-2 rounded border" /></label>
          <label class="block"><span class="font-bold">사업자 상태 확인 근거</span>
            <input v-model="forms[a.partner_id].business_status_evidence" placeholder="예: 2026-11-05 국세청 조회 — 계속사업자(일반과세자)" class="w-full h-9 px-2 rounded border" /></label>
          <label class="flex items-center gap-2"><input v-model="forms[a.partner_id].confirm_documents_checked" type="checkbox" /> 제출 서류와 신청서 내용(상호·대표자·사업자번호·예금주)을 대조했습니다</label>
        </div>
        <div class="space-y-2">
          <label class="block"><span class="font-bold">신청자에게 보일 의견 (반려·보완 시 필수)</span>
            <textarea v-model="forms[a.partner_id].note" rows="3" class="w-full p-2 rounded border"></textarea></label>
          <div class="flex flex-wrap gap-2 justify-end">
            <button class="h-9 px-3 rounded border border-red-300 text-red-700 font-bold" @click="review(a, 'REJECT')">반려</button>
            <button class="h-9 px-3 rounded border border-amber-400 text-amber-800 font-bold" @click="review(a, 'REQUEST_RESUBMIT')">보완 요청</button>
            <button class="h-9 px-4 rounded bg-indigo-600 text-white font-bold disabled:opacity-40"
              :disabled="!forms[a.partner_id].confirm_documents_checked || forms[a.partner_id].commission_rate === '' || !forms[a.partner_id].business_status_evidence || a.missing_documents.length > 0"
              @click="review(a, 'APPROVE')">승인</button>
          </div>
        </div>
      </div>
    </article>
  </div>
</template>
