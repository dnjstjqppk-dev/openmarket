<script setup lang="ts">
// 입점 신청 현황 · 서류 제출 · 심사 요청 (O05). 서류는 비공개 저장소(kyb)에만 올라간다.
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { API_BASE_URL, getPartnerHeaders, setPartnerStatus, clearPartnerSession } from '../config'

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
  // Private file: fetched with the cookie session, shown from a local blob URL (never a shareable link).
  const res = await fetch(`${API_BASE_URL}/api/v1/storage/file/${fileId}`)
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
  <div class="min-h-screen bg-surface-2 px-4 py-8">
    <div class="mx-auto max-w-2xl space-y-4 text-xs">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-bold text-ink">입점 신청 현황</h1>
        <button type="button" class="text-ink-muted underline" @click="logout">로그아웃</button>
      </div>
      <ol class="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs font-bold" aria-label="입점 진행 단계">
        <li><span class="rounded-full bg-success-soft px-2.5 py-1 text-success">1 신청서 완료</span></li>
        <li aria-hidden="true" class="text-ink-subtle">→</li>
        <li><span class="rounded-full px-2.5 py-1" :class="!app || app.kyc_status === 'DRAFT' || app.kyc_status === 'RESUBMIT_REQUIRED' ? 'bg-primary-soft text-primary-soft-ink' : 'bg-success-soft text-success'">2 서류 제출</span></li>
        <li aria-hidden="true" class="text-ink-subtle">→</li>
        <li><span class="rounded-full px-2.5 py-1" :class="app && (app.kyc_status === 'SUBMITTED' || app.kyc_status === 'REJECTED') ? 'bg-primary-soft text-primary-soft-ink' : app && app.kyc_status === 'APPROVED' ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted'">3 심사</span></li>
        <li aria-hidden="true" class="text-ink-subtle">→</li>
        <li><span class="rounded-full px-2.5 py-1" :class="app && app.kyc_status === 'APPROVED' ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted'">4 완료</span></li>
      </ol>
      <p v-if="error" role="alert" class="rounded-xl border border-danger bg-danger-soft p-3 font-bold text-danger">{{ error }}</p>
      <p v-if="msg" role="status" class="rounded-xl border border-success bg-success-soft p-3 font-bold text-success">{{ msg }}</p>

      <section v-if="app" class="space-y-2 rounded-2xl bg-surface p-5 shadow-sm" data-testid="application-status">
        <div class="text-base font-bold" :class="{ 'text-success': app.kyc_status === 'APPROVED', 'text-danger': app.kyc_status === 'REJECTED', 'text-warning': app.kyc_status === 'RESUBMIT_REQUIRED' }">
          {{ KYC_LABEL[app.kyc_status] || app.kyc_status }}
        </div>
        <p class="text-ink-muted">{{ app.business_name }} · 사업자등록번호 {{ app.business_reg_number }} · 대표 {{ app.representative_name }}</p>
        <p v-if="app.review_note" class="rounded-xl border border-warning bg-warning-soft p-3 text-warning"><b>심사 의견:</b> {{ app.review_note }}</p>
        <router-link v-if="app.status === 'APPROVED'" to="/" class="mt-2 inline-block h-10 rounded-xl bg-primary px-4 font-bold leading-10 text-primary-on">판매자 센터로 이동</router-link>
        <p v-if="app.status === 'APPROVED'" class="text-ink-muted">정산 계좌 실명 확인이 끝나야 판매 대금이 지급됩니다.</p>
      </section>

      <section v-if="app && app.kyc_status !== 'APPROVED'" class="space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
        <h2 class="text-sm font-bold">제출 서류 <span class="font-normal text-ink-subtle">(PDF·JPG·PNG, 10MB 이하 · 운영자만 열람)</span></h2>
        <ul class="divide-y divide-line-divider">
          <li v-for="t in docTypes" :key="t" class="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <div class="font-bold">{{ DOC_LABEL[t] }} <span v-if="app.required_documents.includes(t)" class="text-danger">*</span></div>
              <div v-if="latest(t)" class="text-ink-muted">
                <button type="button" class="underline" @click="openDoc(latest(t).file_id)">{{ latest(t).original_name }}</button>
                · <span :class="latest(t).status === 'REJECTED' ? 'font-bold text-danger' : ''">{{ { SUBMITTED: '제출됨', ACCEPTED: '확인 완료', REJECTED: '보완 필요' }[latest(t).status as string] || latest(t).status }}</span>
                <span v-if="latest(t).status === 'REJECTED' && latest(t).review_note"> — {{ latest(t).review_note }}</span>
              </div>
              <div v-else class="text-ink-subtle">아직 올리지 않았습니다.</div>
            </div>
            <label v-if="app.editable" class="h-9 cursor-pointer rounded-lg border border-line px-3 font-bold leading-9 hover:border-line-strong">
              {{ busy === t ? '올리는 중...' : (latest(t) ? '다시 올리기' : '파일 선택') }}
              <input type="file" accept="application/pdf,image/jpeg,image/png" class="sr-only" :disabled="Boolean(busy)" @change="uploadDoc(t, $event)" />
            </label>
          </li>
        </ul>
        <p v-if="app.missing_documents.length" class="text-warning">남은 필수 서류: {{ app.missing_documents.map((d: string) => DOC_LABEL[d]).join(', ') }}</p>
        <button v-if="app.editable" type="button" :disabled="Boolean(busy) || app.missing_documents.length > 0"
          class="h-12 w-full rounded-xl bg-secondary text-sm font-bold text-secondary-on disabled:opacity-40" @click="submitForReview">
          {{ busy === 'submit' ? '요청 중...' : '심사 요청하기' }}
        </button>
      </section>
    </div>
  </div>
</template>
