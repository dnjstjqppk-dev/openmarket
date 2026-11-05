<script setup lang="ts">
// 입점 신청 현황 · 서류 제출 · 심사 요청 (O05). 서류는 비공개 저장소(kyb)에만 올라간다.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { API_BASE_URL, getPartnerHeaders, getPartnerToken, setPartnerStatus, clearPartnerSession } from '../config'

const router = useRouter()
const app = ref<any>(null)
const error = ref('')
const msg = ref('')
const busy = ref('')

const DOC_LABEL: Record<string, string> = {
  BUSINESS_REGISTRATION: '사업자등록증', MAIL_ORDER_REGISTRATION: '통신판매업 신고증', BANK_ACCOUNT_COPY: '정산 계좌 통장 사본', OTHER: '기타 서류'
}
const KYC_LABEL: Record<string, string> = {
  DRAFT: '작성 중 — 서류를 올리고 심사를 요청하세요', SUBMITTED: '심사 중 — 결과는 이 화면에서 확인할 수 있습니다',
  RESUBMIT_REQUIRED: '보완 요청 — 아래 사유를 확인하고 서류를 다시 올려 주세요', APPROVED: '승인 완료', REJECTED: '반려'
}
const docTypes = computed(() => (app.value ? [...app.value.required_documents, 'OTHER'] : []))
const latest = (t: string) => (app.value?.documents || []).find((d: any) => d.doc_type === t && d.status !== 'SUPERSEDED')

async function load() {
  error.value = ''
  const res = await fetch(`${API_BASE_URL}/api/v1/partner/application`, { headers: getPartnerHeaders() })
  if (res.status === 401) { clearPartnerSession(); router.replace('/login?expired=1'); return }
  const json = await res.json().catch(() => ({}))
  if (!json.success) { error.value = json.error || '신청 정보를 불러오지 못했습니다.'; return }
  app.value = json.data
  setPartnerStatus(json.data.status)
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(new Error('파일을 읽지 못했습니다.'))
    r.readAsDataURL(file)
  })
}

async function uploadDoc(docType: string, ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) { error.value = 'PDF, JPG, PNG 파일만 올릴 수 있습니다.'; return }
  if (file.size > 10 * 1024 * 1024) { error.value = '10MB 이하 파일만 올릴 수 있습니다.'; return }
  busy.value = docType; error.value = ''; msg.value = ''
  try {
    const up = await fetch(`${API_BASE_URL}/api/v1/storage/upload`, {
      method: 'POST', headers: getPartnerHeaders(),
      body: JSON.stringify({ file_name: file.name, content_type: file.type, folder: 'kyb', file_data: await toBase64(file) })
    }).then((r) => r.json())
    if (!up.success) throw new Error(up.error || '업로드에 실패했습니다.')
    const at = await fetch(`${API_BASE_URL}/api/v1/partner/application/documents`, {
      method: 'POST', headers: getPartnerHeaders(), body: JSON.stringify({ doc_type: docType, file_id: up.data.file_id })
    }).then((r) => r.json())
    if (!at.success) throw new Error(at.error || '서류를 첨부하지 못했습니다.')
    app.value = at.data
    msg.value = `${DOC_LABEL[docType]}를 올렸습니다.`
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = ''
  }
}

async function openDoc(fileId: string) {
  // Private file: fetched with the session token, shown from a local blob URL (never a shareable link).
  const res = await fetch(`${API_BASE_URL}/api/v1/storage/file/${fileId}`, { headers: { Authorization: `Bearer ${getPartnerToken()}` } })
  if (!res.ok) { error.value = '파일을 열 수 없습니다.'; return }
  const url = URL.createObjectURL(await res.blob())
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function submitForReview() {
  busy.value = 'submit'; error.value = ''
  const json = await fetch(`${API_BASE_URL}/api/v1/partner/application/submit`, { method: 'POST', headers: getPartnerHeaders() }).then((r) => r.json()).catch(() => ({}))
  busy.value = ''
  if (!json.success) { error.value = json.error || '심사 요청에 실패했습니다.'; return }
  app.value = json.data
  msg.value = '심사 요청이 접수되었습니다.'
}

function logout() { clearPartnerSession(); router.push('/login') }
onMounted(load)
</script>

<template>
  <div class="min-h-screen bg-slate-100 py-8 px-4">
    <div class="max-w-2xl mx-auto space-y-4 text-xs">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-black text-gray-900">입점 신청 현황</h1>
        <button type="button" class="text-gray-500 underline" @click="logout">로그아웃</button>
      </div>
      <p v-if="error" role="alert" class="p-3 rounded-xl bg-red-50 text-red-700 font-bold">{{ error }}</p>
      <p v-if="msg" role="status" class="p-3 rounded-xl bg-emerald-50 text-emerald-800 font-bold">{{ msg }}</p>

      <section v-if="app" class="bg-white rounded-2xl p-5 shadow-sm space-y-2" data-testid="application-status">
        <div class="text-base font-black" :class="{ 'text-emerald-700': app.kyc_status === 'APPROVED', 'text-red-700': app.kyc_status === 'REJECTED', 'text-amber-700': app.kyc_status === 'RESUBMIT_REQUIRED' }">
          {{ KYC_LABEL[app.kyc_status] || app.kyc_status }}
        </div>
        <p class="text-gray-600">{{ app.business_name }} · 사업자등록번호 {{ app.business_reg_number }} · 대표 {{ app.representative_name }}</p>
        <p v-if="app.review_note" class="p-3 rounded-xl bg-amber-50 text-amber-900"><b>심사 의견:</b> {{ app.review_note }}</p>
        <router-link v-if="app.status === 'APPROVED'" to="/" class="inline-block mt-2 h-10 leading-10 px-4 rounded-xl bg-[#FF5000] text-white font-black">판매자 센터로 이동</router-link>
        <p v-if="app.status === 'APPROVED'" class="text-gray-500">정산 계좌 실명 확인이 끝나야 판매 대금이 지급됩니다.</p>
      </section>

      <section v-if="app && app.kyc_status !== 'APPROVED'" class="bg-white rounded-2xl p-5 shadow-sm space-y-3">
        <h2 class="font-black text-sm">제출 서류 <span class="font-normal text-gray-400">(PDF·JPG·PNG, 10MB 이하 · 운영자만 열람)</span></h2>
        <ul class="divide-y">
          <li v-for="t in docTypes" :key="t" class="py-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div class="font-bold">{{ DOC_LABEL[t] }} <span v-if="app.required_documents.includes(t)" class="text-red-600">*</span></div>
              <div v-if="latest(t)" class="text-gray-500">
                <button type="button" class="underline" @click="openDoc(latest(t).file_id)">{{ latest(t).original_name }}</button>
                · <span :class="latest(t).status === 'REJECTED' ? 'text-red-600 font-bold' : ''">{{ { SUBMITTED: '제출됨', ACCEPTED: '확인 완료', REJECTED: '보완 필요' }[latest(t).status as string] || latest(t).status }}</span>
                <span v-if="latest(t).status === 'REJECTED' && latest(t).review_note"> — {{ latest(t).review_note }}</span>
              </div>
              <div v-else class="text-gray-400">아직 올리지 않았습니다.</div>
            </div>
            <label v-if="app.editable" class="h-9 leading-9 px-3 rounded-lg border border-gray-300 font-bold cursor-pointer hover:border-gray-900">
              {{ busy === t ? '올리는 중...' : (latest(t) ? '다시 올리기' : '파일 선택') }}
              <input type="file" accept="application/pdf,image/jpeg,image/png" class="sr-only" :disabled="Boolean(busy)" @change="uploadDoc(t, $event)" />
            </label>
          </li>
        </ul>
        <p v-if="app.missing_documents.length" class="text-amber-700">남은 필수 서류: {{ app.missing_documents.map((d: string) => DOC_LABEL[d]).join(', ') }}</p>
        <button v-if="app.editable" type="button" :disabled="Boolean(busy) || app.missing_documents.length > 0"
          class="w-full h-12 rounded-xl bg-slate-900 text-white font-black text-sm disabled:opacity-40" @click="submitForReview">
          {{ busy === 'submit' ? '요청 중...' : '심사 요청하기' }}
        </button>
      </section>
    </div>
  </div>
</template>
