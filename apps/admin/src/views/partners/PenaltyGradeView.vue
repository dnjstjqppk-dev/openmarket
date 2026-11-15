<script setup lang="ts">
// Penalty and grade console (4-21): operator-managed penalty rules,
// imposition with the disabled-rule gate, appeal decisions, grade
// policies and monthly results.
import { ref, onMounted } from 'vue'
import { adminApi } from '../../config'
import { userErrorMessage, useConfirm, useToast, OmEmptyState, OmModal, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const PEN_LABEL: Record<string, string> = { IMPOSED: '부과됨', REVOKED: '취소됨', UPHELD: '유지됨' }

const tab = ref<'rules' | 'history' | 'appeals' | 'grades'>('rules')
const rules = ref<any[]>([])
const history = ref<any[]>([])
const appeals = ref<any[]>([])
const policies = ref<any[]>([])
const results = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const busy = ref(false)
const ruleForm = ref({ code: '', name: '', points: null as number | null, amount: null as number | null, is_enabled: true })
const ruleOpen = ref(false)
const editingRule = ref<any>(null)
const imposeOpen = ref(false)
const impose = ref({ partner_id: '', rule_code: '', sub_order_id: '', reason: '' })
const decideNote = ref('')
const decidingId = ref<string | null>(null)
const policyForm = ref({ grade_code: '', name: '', sort_order: 0, min_sales: null as number | null, max_claim_rate: '', max_penalty_points: null as number | null, is_enabled: true })
const policyOpen = ref(false)
const editingPolicy = ref<any>(null)
const gradeMonth = ref(new Date().toISOString().slice(0, 7))
const computing = ref(false)

const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [r, h, a, p] = await Promise.all([
      adminApi('/api/v1/admin/penalty-rules'),
      adminApi('/api/v1/admin/penalties?per_page=50'),
      adminApi('/api/v1/admin/penalties?appealed=true&per_page=50'),
      adminApi('/api/v1/admin/grade-policies')
    ])
    if (!r.ok) throw new Error(r.data.error || '페널티 규칙을 불러오지 못했습니다.')
    rules.value = r.data.data || []
    if (h.ok) history.value = h.data.data || []
    if (a.ok) appeals.value = a.data.data || []
    if (p.ok) policies.value = p.data.data || []
    await loadGrades()
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

async function loadGrades() {
  try {
    const g = await adminApi(`/api/v1/admin/grades?month=${gradeMonth.value}`)
    if (g.ok) results.value = g.data.data || []
  } catch { /* keep previous */ }
}

function openRule(row: any | null) {
  editingRule.value = row
  ruleForm.value = row
    ? { code: row.code, name: row.name, points: row.points, amount: row.amount, is_enabled: Number(row.is_enabled) === 1 }
    : { code: '', name: '', points: null, amount: null, is_enabled: true }
  ruleOpen.value = true
}

async function submitRule() {
  if (!ruleForm.value.code.trim() || !ruleForm.value.name.trim()) { toastApi.error('규칙 코드와 규칙명을 입력해 주세요.'); return }
  busy.value = true
  try {
    const r = await adminApi('/api/v1/admin/penalty-rules', {
      method: 'PUT',
      json: { code: ruleForm.value.code.trim(), name: ruleForm.value.name.trim(), points: ruleForm.value.points ?? 0, amount: ruleForm.value.amount ?? 0, is_enabled: ruleForm.value.is_enabled }
    })
    if (!r.ok) throw new Error(r.data.error || '저장에 실패했습니다.')
    toastApi.success('페널티 규칙이 저장되었습니다.')
    ruleOpen.value = false
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '저장에 실패했습니다.'))
  } finally {
    busy.value = false
  }
  void load()
}

async function submitImpose() {
  if (!impose.value.partner_id.trim() || !impose.value.rule_code.trim() || !impose.value.reason.trim()) {
    toastApi.error('판매자·규칙·사유를 입력해 주세요.')
    return
  }
  const ok = await askConfirm({ title: '페널티 부과', body: `[${impose.value.partner_id}] 판매자에게 ${impose.value.rule_code} 페널티를 부과합니다.`, danger: true })
  if (!ok) return
  busy.value = true
  try {
    const body: any = { rule_code: impose.value.rule_code.trim(), reason: impose.value.reason.trim() }
    if (impose.value.sub_order_id.trim()) body.sub_order_id = impose.value.sub_order_id.trim()
    const r = await adminApi(`/api/v1/admin/partners/${impose.value.partner_id.trim()}/penalties`, { method: 'POST', json: body })
    if (!r.ok) throw new Error(r.data.error || '부과에 실패했습니다.')
    toastApi.success('페널티가 부과되었습니다.')
    imposeOpen.value = false
    impose.value = { partner_id: '', rule_code: '', sub_order_id: '', reason: '' }
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '부과에 실패했습니다.'))
  } finally {
    busy.value = false
  }
  void load()
}

async function decide(penId: string, decision: 'REVOKE' | 'UPHOLD') {
  const label = decision === 'REVOKE' ? '취소' : '유지'
  const ok = await askConfirm({ title: `페널티 ${label}`, body: `페널티를 ${label}합니다.${decideNote.value.trim() ? ` 의견: ${decideNote.value.trim()}` : ''}`, danger: decision === 'REVOKE' })
  if (!ok) return
  decidingId.value = penId
  try {
    const r = await adminApi(`/api/v1/admin/penalties/${penId}`, { method: 'PUT', json: { decision, note: decideNote.value.trim() || undefined } })
    if (!r.ok) throw new Error(r.data.error || '처리에 실패했습니다.')
    toastApi.success(`페널티가 ${label}되었습니다.`)
    decideNote.value = ''
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '처리에 실패했습니다.'))
  } finally {
    decidingId.value = null
  }
  void load()
}

function openPolicy(row: any | null) {
  editingPolicy.value = row
  policyForm.value = row
    ? { grade_code: row.grade_code, name: row.name, sort_order: row.sort_order ?? 0, min_sales: row.min_sales, max_claim_rate: row.max_claim_rate ?? '', max_penalty_points: row.max_penalty_points, is_enabled: Number(row.is_enabled) === 1 }
    : { grade_code: '', name: '', sort_order: 0, min_sales: null, max_claim_rate: '', max_penalty_points: null, is_enabled: true }
  policyOpen.value = true
}

async function submitPolicy() {
  if (!policyForm.value.grade_code.trim() || !policyForm.value.name.trim()) { toastApi.error('등급 코드와 등급명을 입력해 주세요.'); return }
  busy.value = true
  try {
    const f = policyForm.value
    const body: any = { grade_code: f.grade_code.trim(), name: f.name.trim(), sort_order: f.sort_order, is_enabled: f.is_enabled }
    if (f.min_sales !== null) body.min_sales = f.min_sales
    if (f.max_claim_rate !== '') body.max_claim_rate = Number(f.max_claim_rate)
    if (f.max_penalty_points !== null) body.max_penalty_points = f.max_penalty_points
    const r = await adminApi('/api/v1/admin/grade-policies', { method: 'PUT', json: body })
    if (!r.ok) throw new Error(r.data.error || '저장에 실패했습니다.')
    toastApi.success('등급 기준이 저장되었습니다.')
    policyOpen.value = false
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '저장에 실패했습니다.'))
  } finally {
    busy.value = false
  }
  void load()
}

async function compute() {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(gradeMonth.value)) { toastApi.error('월은 YYYY-MM 형식으로 입력해 주세요.'); return }
  const ok = await askConfirm({ title: '월별 등급 산정', body: `${gradeMonth.value} 등급을 산정합니다.` })
  if (!ok) return
  computing.value = true
  try {
    const r = await adminApi('/api/v1/admin/grades/compute', { method: 'POST', json: { month: gradeMonth.value } })
    if (!r.ok) throw new Error(r.data.error || '산정에 실패했습니다.')
    toastApi.success(`${r.data.data?.computed ?? 0}개 판매자 등급을 산정했습니다.`)
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '산정에 실패했습니다.'))
  } finally {
    computing.value = false
  }
  void loadGrades()
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold text-ink">페널티 · 등급</h1>
      <p class="mt-1 text-xs text-ink-muted">꺼진 규칙으로는 부과할 수 없습니다.</p>
    </div>

    <div class="flex flex-wrap gap-2">
      <button v-for="t in [['rules', '페널티 규칙'], ['history', '부과·취소 이력'], ['appeals', `이의 처리 (${appeals.length})`], ['grades', '등급 기준·결과']] as const" :key="t[0]" type="button"
        class="h-9 rounded-lg px-3 text-xs font-bold"
        :class="tab === t[0] ? 'bg-secondary text-secondary-on' : 'border border-line text-ink-muted hover:bg-surface-2'"
        @click="tab = t[0]">{{ t[1] }}</button>
      <div class="ml-auto flex gap-2">
        <button v-if="tab === 'rules'" type="button" class="h-9 rounded-lg bg-primary px-3 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="openRule(null)">규칙 등록</button>
        <button v-if="tab === 'history'" type="button" class="h-9 rounded-lg bg-primary px-3 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="imposeOpen = true">페널티 부과</button>
        <button v-if="tab === 'grades'" type="button" class="h-9 rounded-lg bg-primary px-3 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="openPolicy(null)">등급 기준 등록</button>
      </div>
    </div>

    <div v-if="loading" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="6" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="load">다시 불러오기</button>
    </div>

    <div v-else-if="tab === 'rules'" class="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table class="w-full min-w-[560px] text-xs">
        <thead class="text-ink-muted"><tr><th class="p-2 text-left">규칙 코드</th><th class="p-2 text-left">유형명</th><th class="p-2 text-right">점수</th><th class="p-2 text-right">금액</th><th class="p-2 text-left">사용</th><th></th></tr></thead>
        <tbody>
          <tr v-for="r in rules" :key="r.code" class="border-t border-line-divider">
            <td class="p-2 font-mono font-bold text-ink">{{ r.code }}</td>
            <td class="p-2 text-ink">{{ r.name }}</td>
            <td class="om-num p-2 text-right text-ink">{{ r.points }}점</td>
            <td class="om-num p-2 text-right text-ink">{{ won(r.amount) }}</td>
            <td class="p-2"><span class="rounded-full px-2 py-0.5 text-2xs font-bold" :class="Number(r.is_enabled) === 1 ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted'">{{ Number(r.is_enabled) === 1 ? '켜짐' : '꺼짐' }}</span></td>
            <td class="p-2 text-right"><button type="button" class="rounded-lg border border-line px-2.5 py-1.5 font-bold text-ink hover:bg-surface-2" @click="openRule(r)">수정</button></td>
          </tr>
        </tbody>
      </table>
      <OmEmptyState v-if="!rules.length" compact title="등록된 페널티 규칙이 없습니다." description="규칙을 등록하면 이곳에 표시됩니다." />
    </div>

    <div v-else-if="tab === 'history'" class="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table class="w-full min-w-[640px] text-xs">
        <thead class="text-ink-muted"><tr><th class="p-2 text-left">판매자</th><th class="p-2 text-left">규칙</th><th class="p-2 text-right">점수·금액</th><th class="p-2 text-left">사유</th><th class="p-2 text-left">상태</th><th class="p-2 text-left">일자</th></tr></thead>
        <tbody>
          <tr v-for="h in history" :key="h.id" class="border-t border-line-divider">
            <td class="p-2 font-bold text-ink">{{ h.business_name || h.partner_id }}</td>
            <td class="p-2 font-mono text-ink-muted">{{ h.rule_code }}</td>
            <td class="om-num p-2 text-right text-ink">{{ h.points }}점 · {{ won(h.penalty_amount) }}</td>
            <td class="max-w-xs truncate p-2 text-ink-muted" :title="h.reason">{{ h.reason }}</td>
            <td class="p-2"><span class="rounded-full px-2 py-0.5 text-2xs font-bold" :class="h.status === 'IMPOSED' ? 'bg-warning-soft text-warning' : h.status === 'REVOKED' ? 'bg-surface-3 text-ink-muted' : 'bg-danger-soft text-danger'">{{ PEN_LABEL[h.status] || h.status }}</span></td>
            <td class="om-num p-2 text-ink-subtle">{{ String(h.created_at || '').slice(0, 10) }}</td>
          </tr>
        </tbody>
      </table>
      <OmEmptyState v-if="!history.length" compact title="페널티 이력이 없습니다." description="부과하면 이곳에 표시됩니다." />
    </div>

    <div v-else-if="tab === 'appeals'" class="space-y-2">
      <OmEmptyState v-if="!appeals.length" compact title="처리할 이의가 없습니다." description="판매자 이의가 들어오면 이곳에 표시됩니다." />
      <div v-else class="flex gap-2">
        <input v-model="decideNote" maxlength="500" placeholder="처리 의견 (선택, 감사 로그에 기록)" aria-label="처리 의견" class="h-10 flex-1 rounded-lg border border-line bg-surface px-3 text-xs text-ink" />
      </div>
      <article v-for="a in appeals" :key="a.id" class="space-y-2 rounded-2xl border border-line bg-surface p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-xs font-bold text-ink">{{ a.business_name || a.partner_id }} · {{ a.rule_code }} ({{ a.points }}점 · {{ won(a.penalty_amount) }})</p>
          <div class="flex gap-1.5">
            <button type="button" :disabled="decidingId === a.id" class="rounded-lg bg-success px-3 py-1.5 text-xs font-bold text-primary-on disabled:opacity-50" @click="decide(a.id, 'REVOKE')">취소</button>
            <button type="button" :disabled="decidingId === a.id" class="rounded-lg border border-danger px-3 py-1.5 text-xs font-bold text-danger hover:bg-danger-soft disabled:opacity-50" @click="decide(a.id, 'UPHOLD')">{{ decidingId === a.id ? '처리 중…' : '유지' }}</button>
          </div>
        </div>
        <p class="text-xs text-ink-muted">부과 사유: {{ a.reason }}</p>
        <p class="whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-xs text-ink">이의: {{ a.appeal_body }}</p>
      </article>
    </div>

    <div v-else class="space-y-3">
      <div class="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table class="w-full min-w-[560px] text-xs">
          <thead class="text-ink-muted"><tr><th class="p-2 text-left">등급</th><th class="p-2 text-left">기준명</th><th class="p-2 text-right">최소 매출</th><th class="p-2 text-right">최대 클레임율</th><th class="p-2 text-right">최대 페널티</th><th class="p-2 text-left">사용</th><th></th></tr></thead>
          <tbody>
            <tr v-for="p in policies" :key="p.grade_code" class="border-t border-line-divider">
              <td class="p-2 font-mono font-bold text-ink">{{ p.grade_code }}</td>
              <td class="p-2 text-ink">{{ p.name }}</td>
              <td class="om-num p-2 text-right text-ink">{{ p.min_sales === null ? '-' : won(p.min_sales) }}</td>
              <td class="om-num p-2 text-right text-ink">{{ p.max_claim_rate === null ? '-' : `${Math.round(Number(p.max_claim_rate) * 100)}%` }}</td>
              <td class="om-num p-2 text-right text-ink">{{ p.max_penalty_points === null ? '-' : `${p.max_penalty_points}점` }}</td>
              <td class="p-2"><span class="rounded-full px-2 py-0.5 text-2xs font-bold" :class="Number(p.is_enabled) === 1 ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted'">{{ Number(p.is_enabled) === 1 ? '켜짐' : '꺼짐' }}</span></td>
              <td class="p-2 text-right"><button type="button" class="rounded-lg border border-line px-2.5 py-1.5 font-bold text-ink hover:bg-surface-2" @click="openPolicy(p)">수정</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-4">
        <input v-model="gradeMonth" type="month" aria-label="산정 월" class="h-10 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="loadGrades" />
        <button type="button" :disabled="computing" class="h-10 rounded-lg bg-secondary px-4 text-xs font-bold text-secondary-on hover:bg-secondary-hover disabled:opacity-50" @click="compute">{{ computing ? '산정 중…' : '월별 산정 실행' }}</button>
        <span class="text-xs text-ink-muted">{{ gradeMonth }} 결과 {{ results.length }}건</span>
      </div>
      <div class="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table class="w-full min-w-[480px] text-xs">
          <thead class="text-ink-muted"><tr><th class="p-2 text-left">판매자</th><th class="p-2 text-left">등급</th><th class="p-2 text-left">지표</th></tr></thead>
          <tbody>
            <tr v-for="g in results" :key="g.partner_id" class="border-t border-line-divider">
              <td class="p-2 font-bold text-ink">{{ g.business_name || g.partner_id }}</td>
              <td class="p-2"><span class="rounded-full bg-primary-soft px-2 py-0.5 text-2xs font-bold text-primary-soft-ink">{{ g.grade_code || '미부여' }}</span></td>
              <td class="p-2 font-mono text-2xs text-ink-subtle">{{ g.metrics_json }}</td>
            </tr>
          </tbody>
        </table>
        <OmEmptyState v-if="!results.length" compact title="산정 결과가 없습니다." description="월별 산정을 실행하면 이곳에 표시됩니다." />
      </div>
    </div>

    <OmModal v-model:open="ruleOpen" :title="editingRule ? '페널티 규칙 수정' : '페널티 규칙 등록'">
      <div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
        <label class="space-y-1">규칙 코드 *<input v-model="ruleForm.code" :disabled="!!editingRule" maxlength="60" placeholder="예: LATE_SHIP" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink disabled:opacity-60" /></label>
        <label class="space-y-1">유형명 *<input v-model="ruleForm.name" maxlength="200" placeholder="예: 발송 지연" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">점수<input v-model.number="ruleForm.points" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">금액<input v-model.number="ruleForm.amount" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="flex items-center gap-2 text-ink"><input v-model="ruleForm.is_enabled" type="checkbox" class="accent-primary" /> 규칙 켜기 (꺼진 규칙으로는 부과 불가)</label>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="ruleOpen = false">취소</button>
        <button type="button" :disabled="busy" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitRule">{{ busy ? '저장 중…' : '저장' }}</button>
      </template>
    </OmModal>

    <OmModal v-model:open="imposeOpen" title="페널티 부과">
      <div class="grid grid-cols-1 gap-3 text-xs">
        <label class="space-y-1">판매자 ID *<input v-model="impose.partner_id" placeholder="예: pt_001" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" /></label>
        <label class="space-y-1">규칙 코드 *<input v-model="impose.rule_code" placeholder="예: LATE_SHIP" list="penalty-rule-codes" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" /></label>
        <datalist id="penalty-rule-codes"><option v-for="r in rules.filter((x) => Number(x.is_enabled) === 1)" :key="r.code" :value="r.code">{{ r.name }}</option></datalist>
        <label class="space-y-1">관련 주문 ID (선택)<input v-model="impose.sub_order_id" placeholder="예: so_001" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" /></label>
        <label class="space-y-1">부과 사유 *<textarea v-model="impose.reason" rows="3" maxlength="500" class="w-full rounded-lg border border-line bg-surface p-3 text-ink" /></label>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="imposeOpen = false">취소</button>
        <button type="button" :disabled="busy" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitImpose">{{ busy ? '부과 중…' : '부과' }}</button>
      </template>
    </OmModal>

    <OmModal v-model:open="policyOpen" :title="editingPolicy ? '등급 기준 수정' : '등급 기준 등록'">
      <div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
        <label class="space-y-1">등급 코드 *<input v-model="policyForm.grade_code" :disabled="!!editingPolicy" maxlength="20" placeholder="예: GOLD" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink disabled:opacity-60" /></label>
        <label class="space-y-1">기준명 *<input v-model="policyForm.name" maxlength="200" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">정렬 순서<input v-model.number="policyForm.sort_order" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">최소 매출<input v-model.number="policyForm.min_sales" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">최대 클레임율 (0~1)<input v-model="policyForm.max_claim_rate" type="number" min="0" max="1" step="0.01" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">최대 페널티 점수<input v-model.number="policyForm.max_penalty_points" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="flex items-center gap-2 text-ink"><input v-model="policyForm.is_enabled" type="checkbox" class="accent-primary" /> 기준 켜기</label>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="policyOpen = false">취소</button>
        <button type="button" :disabled="busy" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitPolicy">{{ busy ? '저장 중…' : '저장' }}</button>
      </template>
    </OmModal>
  </div>
</template>
