<script setup lang="ts">
// Application review detail (4-13): application + documents on the left,
// diligence checklist + risk/reserve + the ruling on the right.
import { ref, computed, onMounted } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { adminApi, API_BASE_URL } from '../../config'
import { userErrorMessage, useConfirm, useToast, OmSkeleton } from '@olmoa/ui'

const route = useRoute()
const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const DOC_LABEL: Record<string, string> = { BUSINESS_REGISTRATION: '사업자등록증', MAIL_ORDER_REGISTRATION: '통신판매업 신고증', BANK_ACCOUNT_COPY: '통장 사본', OTHER: '기타' }
const STATUS_LABEL: Record<string, string> = { DRAFT: '작성 중', SUBMITTED: '심사 대기', RESUBMIT_REQUIRED: '보완 요청됨', APPROVED: '승인', REJECTED: '반려' }
const TIER_LABEL: Record<string, string> = { TIER_1_NORMAL: '정상', TIER_2_WATCH: '주의', TIER_3_HIGH_RISK: '고위험' }

const app = ref<any>(null)
const loading = ref(true)
const loadError = ref('')
const ruling = ref(false)
const ruleError = ref('')
const commission = ref('')
const evidence = ref('')
const note = ref('')
const rejected = ref<string[]>([])
const checks = ref({ brn: false, mailOrder: false, account: false, docs: false })
const riskTier = ref('TIER_1_NORMAL')
const reservePct = ref(0)
const tierBusy = ref(false)

const id = computed(() => String(route.params.id || ''))
const canRule = computed(() => app.value?.kyc_status === 'SUBMITTED')
const checksDone = computed(() => checks.value.brn && checks.value.mailOrder && checks.value.account && checks.value.docs)
const canApprove = computed(() => canRule.value && checksDone.value && commission.value !== '' && evidence.value.trim() !== '' && !(app.value?.missing_documents || []).length)

function maskAcct(n?: string) {
  const t = String(n || '')
  if (!t || t === '-') return '-'
  if (t.startsWith('****')) return t
  return `****${t.slice(-4)}`
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi(`/api/v1/admin/partner-applications/${id.value}`)
    if (!r.ok) throw new Error(r.data.error || '신청 정보를 불러오지 못했습니다.')
    app.value = r.data.data
    riskTier.value = app.value.risk_tier || 'TIER_1_NORMAL'
    reservePct.value = Number(app.value.rolling_reserve_pct || 0)
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

async function openDoc(fileId: string) {
  const res = await fetch(`${API_BASE_URL}/api/v1/storage/file/${fileId}`)
  if (!res.ok) { toastApi.error('서류를 열 수 없습니다.'); return }
  const url = URL.createObjectURL(await res.blob())
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function saveTier() {
  tierBusy.value = true
  try {
    const reserve = riskTier.value === 'TIER_3_HIGH_RISK' ? 10.0 : riskTier.value === 'TIER_2_WATCH' ? 5.0 : 0.0
    const r = await adminApi(`/api/v1/admin/partners/${id.value}/verify`, {
      method: 'PUT', json: { status: app.value.status, risk_tier: riskTier.value, rolling_reserve_pct: reserve }
    })
    if (!r.ok) throw new Error(r.data.error || '저장에 실패했습니다.')
    reservePct.value = reserve
    toastApi.success(`위험등급 ${TIER_LABEL[riskTier.value]} · 유보금 ${reserve}%로 저장되었습니다.`)
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '저장에 실패했습니다.'))
  } finally {
    tierBusy.value = false
  }
}

async function rule(decision: 'APPROVE' | 'REJECT' | 'REQUEST_RESUBMIT') {
  ruleError.value = ''
  const label = { APPROVE: '승인', REJECT: '반려', REQUEST_RESUBMIT: '보완 요청' }[decision]
  if ((decision === 'REJECT' || decision === 'REQUEST_RESUBMIT') && !note.value.trim()) {
    ruleError.value = '신청자에게 보일 사유를 입력해 주세요.'
    return
  }
  const ok = await askConfirm({ title: '입점 심사', body: `${app.value.business_name} 입점 신청을 ${label}합니다.`, danger: decision === 'REJECT' })
  if (!ok) return
  ruling.value = true
  try {
    const body: any = { decision, note: note.value.trim() || undefined }
    if (decision === 'APPROVE') {
      Object.assign(body, { commission_rate: Number(commission.value), business_status_evidence: evidence.value.trim(), confirm_documents_checked: checksDone.value })
    }
    if (decision === 'REQUEST_RESUBMIT') body.rejected_document_ids = rejected.value
    const r = await adminApi(`/api/v1/admin/partner-applications/${id.value}/review`, { method: 'POST', json: body })
    if (!r.ok) throw new Error(r.data.error || '처리하지 못했습니다.')
    toastApi.success(`${app.value.business_name}: ${label} 완료.${r.data.next_step ? ' ' + r.data.next_step : ''}`)
    await load()
  } catch (e: any) {
    ruleError.value = userErrorMessage(e, '처리하지 못했습니다.')
  } finally {
    ruling.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <RouterLink to="/partner-applications" class="text-xs font-bold text-primary hover:underline">← 심사 목록으로</RouterLink>

    <div v-if="loading" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="8" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="load">다시 불러오기</button>
    </div>

    <div v-else-if="app" class="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div class="space-y-4 lg:col-span-3">
        <section class="space-y-2 rounded-2xl border border-line bg-surface p-5" data-testid="application-card">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h1 class="text-lg font-bold text-ink">{{ app.business_name }}</h1>
            <span class="rounded-full px-2 py-0.5 text-2xs font-bold" :class="app.kyc_status === 'APPROVED' ? 'bg-success-soft text-success' : app.kyc_status === 'REJECTED' ? 'bg-danger-soft text-danger' : app.kyc_status === 'SUBMITTED' ? 'bg-warning-soft text-warning' : 'bg-surface-3 text-ink-muted'">{{ STATUS_LABEL[app.kyc_status] || app.kyc_status }}</span>
          </div>
          <dl class="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
            <div><dt class="text-ink-subtle">사업자등록번호</dt><dd class="om-num font-bold text-ink">{{ app.business_reg_number }}</dd></div>
            <div><dt class="text-ink-subtle">대표자</dt><dd class="font-bold text-ink">{{ app.representative_name }}</dd></div>
            <div><dt class="text-ink-subtle">통신판매업</dt><dd class="font-bold text-ink">{{ app.mail_order_reg_number || `면제: ${app.mail_order_exempt_reason}` }}</dd></div>
            <div><dt class="text-ink-subtle">사업장 주소</dt><dd class="text-ink">{{ app.business_address || '-' }}</dd></div>
            <div><dt class="text-ink-subtle">담당자</dt><dd class="text-ink">{{ app.contact_name }} ({{ app.contact_email }}, {{ app.contact_phone }})</dd></div>
            <div><dt class="text-ink-subtle">고객센터</dt><dd class="text-ink">{{ app.customer_service_phone }} · {{ app.cs_email }}</dd></div>
            <div><dt class="text-ink-subtle">정산 계좌</dt><dd class="om-num text-ink">{{ app.bank_code }} {{ maskAcct(app.bank_account_number) }} ({{ app.bank_account_holder }})</dd></div>
            <div><dt class="text-ink-subtle">반품지</dt><dd class="text-ink">{{ app.return_shipping_address }}</dd></div>
            <div><dt class="text-ink-subtle">신청</dt><dd class="om-num text-ink-muted">{{ String(app.applied_at || '').slice(0, 10) }} · 심사 요청 {{ String(app.submitted_at || '-').slice(0, 10) }}</dd></div>
          </dl>
          <p v-if="app.review_note" class="rounded-xl border border-line bg-surface-2 p-3 text-xs text-ink-muted"><b class="text-ink">최근 심사 의견:</b> {{ app.review_note }}</p>
        </section>

        <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
          <h2 class="text-sm font-bold text-ink">제출 서류</h2>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[480px] text-xs">
              <thead class="text-ink-muted"><tr><th class="p-1 text-left">서류</th><th class="p-1 text-left">파일</th><th class="p-1 text-left">상태</th><th v-if="canRule" class="p-1 text-left">보완 요청</th></tr></thead>
              <tbody>
                <tr v-for="d in (app.documents || []).filter((x: any) => x.status !== 'SUPERSEDED')" :key="d.id" class="border-t border-line-divider">
                  <td class="p-1 font-bold text-ink">{{ DOC_LABEL[d.doc_type] }}</td>
                  <td class="p-1"><button type="button" class="text-primary underline" @click="openDoc(d.file_id)">{{ d.original_name }}</button> <span class="text-ink-subtle">{{ Math.round(d.byte_size / 1024) }}KB</span></td>
                  <td class="p-1 text-ink-muted">{{ d.status }}</td>
                  <td v-if="canRule" class="p-1"><input v-model="rejected" type="checkbox" :value="d.id" :aria-label="`${DOC_LABEL[d.doc_type]} 보완 요청`" class="accent-primary" /></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="(app.missing_documents || []).length" class="text-xs font-bold text-warning">누락: {{ app.missing_documents.map((x: string) => DOC_LABEL[x]).join(', ') }}</p>
        </section>
      </div>

      <div class="space-y-4 lg:col-span-2">
        <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
          <h2 class="text-sm font-bold text-ink">심사 점검표</h2>
          <label class="flex cursor-pointer items-start gap-2 text-xs text-ink"><input v-model="checks.brn" type="checkbox" class="mt-0.5 accent-primary" :disabled="!canRule" /> 사업자 진위 확인 ({{ app.business_reg_number }})</label>
          <label class="flex cursor-pointer items-start gap-2 text-xs text-ink"><input v-model="checks.mailOrder" type="checkbox" class="mt-0.5 accent-primary" :disabled="!canRule" /> 통신판매업 확인 ({{ app.mail_order_reg_number || '면제' }})</label>
          <label class="flex cursor-pointer items-start gap-2 text-xs text-ink"><input v-model="checks.account" type="checkbox" class="mt-0.5 accent-primary" :disabled="!canRule" /> 계좌 실명 확인 ({{ app.bank_code }} {{ maskAcct(app.bank_account_number) }})</label>
          <label class="flex cursor-pointer items-start gap-2 text-xs text-ink"><input v-model="checks.docs" type="checkbox" class="mt-0.5 accent-primary" :disabled="!canRule" /> 서류 일치 확인 (상호·대표자·사업자번호·예금주 대조)</label>
          <p class="text-2xs text-ink-subtle">4개 항목을 모두 확인해야 승인할 수 있습니다.</p>
        </section>

        <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
          <h2 class="text-sm font-bold text-ink">위험등급 · 유보금</h2>
          <div class="flex gap-2">
            <select v-model="riskTier" aria-label="위험등급" class="h-10 flex-1 rounded-lg border border-line bg-surface px-2 text-xs font-bold text-ink">
              <option value="TIER_1_NORMAL">정상 (유보금 0%)</option>
              <option value="TIER_2_WATCH">주의 (유보금 5%)</option>
              <option value="TIER_3_HIGH_RISK">고위험 (유보금 10%)</option>
            </select>
            <button type="button" :disabled="tierBusy" class="h-10 rounded-lg bg-secondary px-4 text-xs font-bold text-secondary-on hover:bg-secondary-hover disabled:opacity-50" @click="saveTier">{{ tierBusy ? '저장 중…' : '저장' }}</button>
          </div>
          <p class="om-num text-2xs text-ink-subtle">현재: {{ TIER_LABEL[app.risk_tier] || app.risk_tier || '정상' }} · {{ reservePct }}%</p>
        </section>

        <section class="space-y-3 rounded-2xl border border-line bg-surface p-5">
          <h2 class="text-sm font-bold text-ink">심사 판정</h2>
          <label class="block space-y-1 text-xs font-bold text-ink-muted">수수료율 (%) *
            <input v-model="commission" type="number" min="0" max="50" step="0.01" :disabled="!canRule" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-normal text-ink" /></label>
          <label class="block space-y-1 text-xs font-bold text-ink-muted">사업자 상태 확인 근거 *
            <input v-model="evidence" placeholder="예: 2026-11-05 국세청 조회 — 계속사업자(일반과세자)" :disabled="!canRule" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-normal text-ink" /></label>
          <label class="block space-y-1 text-xs font-bold text-ink-muted">신청자에게 보일 의견 (반려·보완 시 필수)
            <textarea v-model="note" rows="3" :disabled="!canRule" class="w-full rounded-lg border border-line bg-surface p-2 font-normal text-ink"></textarea></label>
          <p v-if="ruleError" role="alert" class="text-xs font-bold text-danger">{{ ruleError }}</p>
          <div class="flex flex-wrap justify-end gap-2">
            <button type="button" :disabled="!canRule || ruling" class="h-10 rounded-lg border border-danger px-4 text-sm font-bold text-danger hover:bg-danger-soft disabled:opacity-40" @click="rule('REJECT')">{{ ruling ? '처리 중…' : '반려' }}</button>
            <button type="button" :disabled="!canRule || ruling" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-warning hover:bg-warning-soft disabled:opacity-40" @click="rule('REQUEST_RESUBMIT')">{{ ruling ? '처리 중…' : '보완 요청' }}</button>
            <button type="button" :disabled="!canApprove || ruling" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-40" @click="rule('APPROVE')">{{ ruling ? '처리 중…' : '승인' }}</button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
