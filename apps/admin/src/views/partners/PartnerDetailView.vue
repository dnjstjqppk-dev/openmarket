<script setup lang="ts">
// Seller detail (4-13): identity, payout-account approval, base commission,
// penalty history, grade, stats, risk/reserve and suspend/release.
import { ref, computed, onMounted } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { adminApi } from '../../config'
import { userErrorMessage, useConfirm, useToast, OmSkeleton } from '@olmoa/ui'

const route = useRoute()
const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const TIER_LABEL: Record<string, string> = { TIER_1_NORMAL: '정상', TIER_2_WATCH: '주의', TIER_3_HIGH_RISK: '고위험' }
const RESERVE_OF: Record<string, number> = { TIER_1_NORMAL: 0.0, TIER_2_WATCH: 5.0, TIER_3_HIGH_RISK: 10.0 }

const data = ref<any>(null)
const loading = ref(true)
const loadError = ref('')
const busy = ref('')
const tier = ref('TIER_1_NORMAL')
const commission = ref('')
const evidenceOpen = ref(false)
const evidenceDecision = ref<'VERIFY_CURRENT' | 'APPROVE'>('VERIFY_CURRENT')
const evidence = ref('')

const id = computed(() => String(route.params.id || ''))
const p = computed(() => data.value?.partner || null)
const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`

function maskAcct(n?: string) {
  const t = String(n || '')
  return t ? `****${t.slice(-4)}` : '-'
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi(`/api/v1/admin/partners/${id.value}`)
    if (!r.ok) throw new Error(r.data.error || '입점사 정보를 불러오지 못했습니다.')
    data.value = r.data.data
    tier.value = data.value.partner.risk_tier || 'TIER_1_NORMAL'
    commission.value = String(data.value.partner.commission_rate ?? '')
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

async function saveCommission() {
  const rate = Number(commission.value)
  if (!Number.isFinite(rate) || rate < 0 || rate > 50) { toastApi.error('수수료율은 0~50% 사이로 입력해 주세요.'); return }
  const ok = await askConfirm({ title: '기본 수수료 변경', body: `[${p.value.business_name}] 기본 수수료율을 ${rate}%로 변경합니다. 카테고리 예외가 있는 상품은 예외율이 우선합니다.`, danger: true })
  if (!ok) return
  busy.value = 'commission'
  try {
    const r = await adminApi(`/api/v1/admin/partners/${id.value}/commission`, { method: 'PUT', json: { commission_rate: rate } })
    if (!r.ok) throw new Error(r.data.error || '저장에 실패했습니다.')
    toastApi.success(`기본 수수료율이 ${rate}%로 변경되었습니다.`)
    await load()
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '저장에 실패했습니다.'))
  } finally {
    busy.value = ''
  }
}

async function saveTier() {
  busy.value = 'tier'
  try {
    const r = await adminApi(`/api/v1/admin/partners/${id.value}/verify`, {
      method: 'PUT', json: { status: p.value.status, risk_tier: tier.value, rolling_reserve_pct: RESERVE_OF[tier.value] }
    })
    if (!r.ok) throw new Error(r.data.error || '저장에 실패했습니다.')
    toastApi.success(`위험등급 ${TIER_LABEL[tier.value]} · 유보금 ${RESERVE_OF[tier.value]}%로 저장되었습니다.`)
    await load()
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '저장에 실패했습니다.'))
  } finally {
    busy.value = ''
  }
}

async function setStatus(next: 'APPROVED' | 'SUSPENDED') {
  const label = next === 'SUSPENDED' ? '정지(판매 중단)' : '정지 해제(정상화)'
  const ok = await askConfirm({ title: '판매자 상태 변경', body: `[${p.value.business_name}] 파트너를 ${label} 처리합니다.\n위험등급: ${tier.value} · 롤링 리저브: ${RESERVE_OF[tier.value]}%\n계속할까요?`, danger: next === 'SUSPENDED' })
  if (!ok) return
  busy.value = 'status'
  try {
    const r = await adminApi(`/api/v1/admin/partners/${id.value}/verify`, {
      method: 'PUT', json: { status: next, risk_tier: tier.value, rolling_reserve_pct: RESERVE_OF[tier.value], kyc_notes: `관리자 심사 조치 (${next} / ${tier.value})` }
    })
    if (!r.ok) throw new Error(r.data.error || '처리하지 못했습니다. 잠시 후 다시 시도해주세요.')
    toastApi.success(`[${p.value.business_name}] 파트너가 ${next} 처리되었습니다.`)
    await load()
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '요청 중 네트워크 오류가 발생했습니다. 다시 시도해 주세요.'))
  } finally {
    busy.value = ''
  }
}

function openEvidence(decision: 'VERIFY_CURRENT' | 'APPROVE') {
  evidenceDecision.value = decision
  evidence.value = ''
  evidenceOpen.value = true
}

async function submitEvidence() {
  if (!evidence.value.trim()) { toastApi.error('계좌 실명 확인 근거를 입력해 주세요.'); return }
  busy.value = 'payout'
  try {
    const r = await adminApi(`/api/v1/admin/partners/${id.value}/payout-account`, {
      method: 'POST', json: { decision: evidenceDecision.value, verification_evidence: evidence.value.trim() }
    })
    if (!r.ok) throw new Error(r.data.error || '정산 계좌 처리 실패')
    toastApi.success(`[${p.value.business_name}] 정산 계좌 확인/승인 처리되었습니다.`)
    evidenceOpen.value = false
    await load()
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '정산 계좌 요청 중 네트워크 오류'))
  } finally {
    busy.value = ''
  }
}

async function rejectChange() {
  const ok = await askConfirm({ title: '계좌 변경 반려', body: `[${p.value.business_name}]의 계좌 변경 요청을 반려할까요?` })
  if (!ok) return
  busy.value = 'payout'
  try {
    const r = await adminApi(`/api/v1/admin/partners/${id.value}/payout-account`, { method: 'POST', json: { decision: 'REJECT' } })
    if (!r.ok) throw new Error(r.data.error || '정산 계좌 처리 실패')
    toastApi.success(`[${p.value.business_name}] 정산 계좌 변경 반려 처리되었습니다.`)
    await load()
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '정산 계좌 요청 중 네트워크 오류'))
  } finally {
    busy.value = ''
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <RouterLink to="/partners" class="text-xs font-bold text-primary hover:underline">← 입점사 목록으로</RouterLink>

    <div v-if="loading" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="8" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="load">다시 불러오기</button>
    </div>

    <div v-else-if="p" class="space-y-4">
      <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h1 class="text-lg font-bold text-ink">{{ p.business_name }}</h1>
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="p.status === 'APPROVED' ? 'bg-success-soft text-success' : p.status === 'PENDING' ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger'">{{ p.status }}</span>
        </div>
        <dl class="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
          <div><dt class="text-ink-subtle">사업자등록번호</dt><dd class="om-num font-bold text-ink">{{ p.business_reg_number }}</dd></div>
          <div><dt class="text-ink-subtle">대표자</dt><dd class="font-bold text-ink">{{ p.representative_name || '-' }}</dd></div>
          <div><dt class="text-ink-subtle">담당자</dt><dd class="text-ink">{{ p.full_name || '-' }} ({{ p.email }}, {{ p.phone }})</dd></div>
          <div><dt class="text-ink-subtle">상품 수</dt><dd class="om-num font-bold text-ink">{{ (data.stats?.products ?? 0).toLocaleString('ko-KR') }}개</dd></div>
          <div><dt class="text-ink-subtle">누적 주문(건)</dt><dd class="om-num font-bold text-ink">{{ (data.stats?.sub_orders ?? 0).toLocaleString('ko-KR') }}건</dd></div>
          <div><dt class="text-ink-subtle">누적 판매액</dt><dd class="om-num font-bold text-ink">{{ won(data.stats?.gross) }}</dd></div>
          <div><dt class="text-ink-subtle">최근 등급</dt><dd class="text-ink">{{ data.grade ? `${data.grade.month} · ${data.grade.grade_code || '미부여'}` : '없음' }}</dd></div>
        </dl>
      </section>

      <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <h2 class="text-sm font-bold text-ink">정산 계좌</h2>
        <p class="om-num text-xs text-ink">{{ p.bank_code || '-' }} {{ maskAcct(p.bank_account_number) }} ({{ p.bank_account_holder || '예금주 미등록' }})</p>
        <p>
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="Number(p.payout_account_verified) === 1 ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'">{{ Number(p.payout_account_verified) === 1 ? '실명확인' : '미확인' }}</span>
          <span v-if="data.payout_change_request" class="ml-1 rounded-full bg-info-soft px-2 py-0.5 text-2xs font-bold text-info">변경요청: {{ data.payout_change_request.bank_code }} {{ maskAcct(data.payout_change_request.bank_account_number) }}</span>
        </p>
        <div class="flex flex-wrap gap-2">
          <button v-if="Number(p.payout_account_verified) !== 1 && !data.payout_change_request" type="button" :disabled="busy !== ''" class="h-9 rounded-lg bg-secondary px-4 text-xs font-bold text-secondary-on hover:bg-secondary-hover disabled:opacity-50" @click="openEvidence('VERIFY_CURRENT')">실명 확인</button>
          <template v-if="data.payout_change_request">
            <button type="button" :disabled="busy !== ''" class="h-9 rounded-lg bg-success px-4 text-xs font-bold text-primary-on disabled:opacity-50" @click="openEvidence('APPROVE')">변경 승인</button>
            <button type="button" :disabled="busy !== ''" class="h-9 rounded-lg border border-danger px-4 text-xs font-bold text-danger hover:bg-danger-soft disabled:opacity-50" @click="rejectChange">변경 반려</button>
          </template>
        </div>
      </section>

      <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <h2 class="text-sm font-bold text-ink">수수료</h2>
        <div class="flex max-w-md gap-2">
          <input v-model="commission" type="number" min="0" max="50" step="0.01" aria-label="기본 수수료율" class="h-10 flex-1 rounded-lg border border-line bg-surface px-3 text-xs text-ink" />
          <button type="button" :disabled="busy !== ''" class="h-10 rounded-lg bg-secondary px-4 text-xs font-bold text-secondary-on hover:bg-secondary-hover disabled:opacity-50" @click="saveCommission">{{ busy === 'commission' ? '저장 중…' : '기본율 저장' }}</button>
        </div>
        <p class="text-2xs text-ink-subtle">카테고리 예외가 있는 상품은 예외율이 우선합니다.</p>
        <div v-if="(data.category_rates || []).length" class="overflow-x-auto">
          <table class="w-full max-w-md text-xs">
            <thead class="text-ink-muted"><tr><th class="p-1 text-left">카테고리</th><th class="p-1 text-right">예외 수수료율</th></tr></thead>
            <tbody>
              <tr v-for="c in data.category_rates" :key="c.id" class="border-t border-line-divider">
                <td class="p-1 text-ink">{{ c.name }}</td>
                <td class="om-num p-1 text-right font-bold text-ink">{{ (Number(c.commission_rate_bps) / 100).toFixed(2) }}%</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="text-xs text-ink-muted">카테고리 예외 수수료율이 없습니다. 모든 상품에 기본율이 적용됩니다.</p>
      </section>

      <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <h2 class="text-sm font-bold text-ink">페널티 이력</h2>
        <p v-if="!(data.penalties || []).length" class="text-xs text-ink-muted">페널티 이력이 없습니다.</p>
        <ul v-else class="divide-y divide-line-divider text-xs">
          <li v-for="pen in data.penalties" :key="pen.id" class="py-2">
            <p class="font-bold text-ink">{{ pen.rule_code || pen.penalty_type }} · {{ won(pen.penalty_amount) }} · {{ pen.points }}점</p>
            <p class="mt-0.5 text-ink-muted">{{ pen.reason }} · {{ pen.status }} · {{ String(pen.created_at || '').slice(0, 10) }}</p>
          </li>
        </ul>
      </section>

      <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <h2 class="text-sm font-bold text-ink">위험등급 · 상태</h2>
        <div class="flex max-w-md gap-2">
          <select v-model="tier" aria-label="위험등급" class="h-10 flex-1 rounded-lg border border-line bg-surface px-2 text-xs font-bold text-ink">
            <option value="TIER_1_NORMAL">정상 (유보금 0%)</option>
            <option value="TIER_2_WATCH">주의 (유보금 5%)</option>
            <option value="TIER_3_HIGH_RISK">고위험 (유보금 10%)</option>
          </select>
          <button type="button" :disabled="busy !== ''" class="h-10 rounded-lg bg-secondary px-4 text-xs font-bold text-secondary-on hover:bg-secondary-hover disabled:opacity-50" @click="saveTier">{{ busy === 'tier' ? '저장 중…' : '등급 저장' }}</button>
        </div>
        <div class="flex flex-wrap gap-2">
          <button v-if="p.status !== 'SUSPENDED'" type="button" :disabled="busy !== ''" class="h-10 rounded-lg border border-danger px-4 text-sm font-bold text-danger hover:bg-danger-soft disabled:opacity-50" @click="setStatus('SUSPENDED')">{{ busy === 'status' ? '처리 중…' : '정지' }}</button>
          <button v-else type="button" :disabled="busy !== ''" class="h-10 rounded-lg bg-success px-4 text-sm font-bold text-primary-on disabled:opacity-50" @click="setStatus('APPROVED')">{{ busy === 'status' ? '처리 중…' : '해제' }}</button>
        </div>
      </section>
    </div>

    <div v-if="evidenceOpen" class="fixed inset-0 z-modal flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="계좌 실명 확인">
      <div class="absolute inset-0 bg-overlay/50" @click="evidenceOpen = false"></div>
      <div class="relative w-full max-w-md space-y-3 rounded-2xl border border-line bg-surface p-6">
        <h2 class="text-sm font-bold text-ink">계좌 실명 확인 근거</h2>
        <p class="text-xs text-ink-muted">감사 로그에 기록됩니다.</p>
        <input v-model="evidence" placeholder="예: ARS 실명확인 2026-11-11" aria-label="실명 확인 근거" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-xs text-ink" />
        <div class="flex justify-end gap-2">
          <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="evidenceOpen = false">취소</button>
          <button type="button" :disabled="busy !== '' || !evidence.trim()" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitEvidence">{{ busy === 'payout' ? '처리 중…' : '확인' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
