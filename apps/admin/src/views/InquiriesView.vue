<script setup lang="ts">
// Customer 1:1 inquiry console (4-20): 72h overdue flags, operator
// assignment and answer templates over GET /api/v1/admin/inquiries +
// POST /api/v1/admin/inquiries/:id/reply.
import { ref, onMounted } from 'vue'
import { adminApi } from '../config'
import { userErrorMessage, OmEmptyState, OmSkeleton, useConfirm } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const SLA_HOURS = 72
const ANSWER_TEMPLATES = [
  { label: '접수 안내', text: '문의가 접수되었습니다. 확인 후 순차적으로 답변드리겠습니다.' },
  { label: '배송 안내', text: '주문하신 상품의 배송 상태를 확인했습니다. 송장 기준으로 안내드리겠습니다.' },
  { label: '환불 안내', text: '환불은 원결제수단으로 영업일 3~5일 내 처리됩니다.' }
]

const rows = ref<any[]>([])
const operators = ref<any[]>([])
const loading = ref(false)
const loadError = ref('')
const statusFilter = ref('')
const page = ref(1)
const totalPages = ref(1)
const total = ref(0)

const selected = ref<any | null>(null)
const answer = ref('')
const closing = ref(false)
const replying = ref(false)
const replyError = ref('')
const toast = ref('')
const assigning = ref(false)

const statusLabel = (s: string) => s === 'OPEN' ? '미답변' : s === 'ANSWERED' ? '답변 완료' : s === 'CLOSED' ? '종결' : (s || '-')
const isOverdue = (r: any) => {
  if (r.status !== 'OPEN' || !r.created_at) return false
  const at = new Date(String(r.created_at).replace(' ', 'T')).getTime()
  return Number.isFinite(at) && Date.now() - at > SLA_HOURS * 3600 * 1000
}
const assigneeName = (r: any) => {
  if (!r.assignee_admin_id) return '미지정'
  return operators.value.find((o: any) => o.id === r.assignee_admin_id)?.full_name || r.assignee_admin_id
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const q = new URLSearchParams()
    if (statusFilter.value) q.set('status', statusFilter.value)
    q.set('page', String(page.value))
    const [r, ops] = await Promise.all([
      adminApi(`/api/v1/admin/inquiries?${q.toString()}`),
      operators.value.length ? null : adminApi('/api/v1/admin/users?role=ROLE_ADMIN&per_page=200')
    ])
    if (!r.ok) throw new Error(r.data.error || '문의 목록을 불러오지 못했습니다.')
    rows.value = r.data.data || []
    total.value = Number(r.data.pagination?.total) || rows.value.length
    totalPages.value = Number(r.data.pagination?.total_pages) || 1
    if (ops && ops.ok && Array.isArray(ops.data.data)) operators.value = ops.data.data
    if (selected.value) {
      selected.value = rows.value.find((x: any) => x.id === selected.value.id) || null
    }
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '문의 목록을 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}

function pick(row: any) {
  selected.value = row
  answer.value = row.answer || ''
  closing.value = false
  replyError.value = ''
}

async function reply() {
  if (!selected.value || !answer.value.trim()) return
  const ok = await askConfirm({ title: '답변 등록', body: `[${selected.value.subject}] 문의에 답변을 등록합니다.${closing.value ? ' (종결 처리)' : ''}` })
  if (!ok) return
  replying.value = true
  replyError.value = ''
  try {
    const r = await adminApi(`/api/v1/admin/inquiries/${selected.value.id}/reply`, {
      method: 'POST',
      json: { answer: answer.value.trim(), close: closing.value }
    })
    if (!r.ok) throw new Error(r.data.error || '답변 등록에 실패했습니다.')
    toast.value = '답변이 등록되었습니다.'
    setTimeout(() => { toast.value = '' }, 3000)
    await load()
  } catch (e: any) {
    replyError.value = userErrorMessage(e, '답변 등록에 실패했습니다.')
  } finally {
    replying.value = false
  }
}

async function assign(row: any, adminId: string) {
  assigning.value = true
  try {
    const r = await adminApi(`/api/v1/admin/inquiries/${row.id}`, {
      method: 'PUT', json: { assignee_admin_id: adminId || null }
    })
    if (!r.ok) throw new Error(r.data.error || '담당자 지정에 실패했습니다.')
    row.assignee_admin_id = adminId || null
    toast.value = '담당자가 지정되었습니다.'
    setTimeout(() => { toast.value = '' }, 3000)
  } catch (e: any) {
    toast.value = userErrorMessage(e, '담당자 지정에 실패했습니다.')
    setTimeout(() => { toast.value = '' }, 4000)
  } finally {
    assigning.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-4 px-4 py-6 text-xs">
    <div>
      <h1 class="text-xl font-bold text-ink">고객 문의</h1>
      <p class="mt-1 text-ink-muted">접수된 고객 문의를 조회하고 답변합니다. 미답변 72시간이 지나면 기한 경과로 표시됩니다. 답변·종결은 감사 로그에 기록됩니다.</p>
    </div>

    <div v-if="toast" role="status" class="rounded-xl bg-success-soft p-3 font-bold text-success">{{ toast }}</div>

    <form class="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-4" @submit.prevent="page = 1; load()">
      <label class="block"><span class="font-bold text-ink-muted">상태</span>
        <select v-model="statusFilter" class="mt-1 h-9 rounded-lg border border-line bg-surface px-2 text-ink" @change="page = 1; load()">
          <option value="">전체</option>
          <option value="OPEN">미답변</option>
          <option value="ANSWERED">답변 완료</option>
          <option value="CLOSED">종결</option>
        </select></label>
      <div class="flex-1"></div>
      <span class="pb-2 text-ink-muted">총 {{ total }}건</span>
      <button class="h-9 rounded-lg bg-secondary px-4 font-bold text-secondary-on hover:bg-secondary-hover" :disabled="loading">{{ loading ? '조회 중...' : '조회' }}</button>
    </form>

    <div v-if="loadError" role="alert" class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger bg-danger-soft p-3 font-bold text-danger">
      <span>{{ U }} ({{ loadError }})</span>
      <button class="h-8 rounded-lg bg-secondary px-3 text-secondary-on hover:bg-secondary-hover" @click="load">다시 시도</button>
    </div>

    <div v-if="loading" class="rounded-xl border border-line bg-surface p-8 text-center text-ink-subtle">불러오는 중...</div>
    <OmEmptyState
      v-else-if="!rows.length && !loadError"
      compact
      title="조건에 맞는 문의가 없습니다."
      description="검색 조건을 바꾸거나 잠시 후 다시 확인해 보세요."
    />

    <div v-else class="overflow-x-auto rounded-xl border border-line bg-surface">
      <table class="w-full min-w-[820px]">
        <thead class="bg-surface-2 text-ink-muted"><tr><th class="p-2 text-left">접수일</th><th class="p-2 text-left">고객</th><th class="p-2 text-left">분류</th><th class="p-2 text-left">제목</th><th class="p-2 text-left">담당자</th><th class="p-2 text-left">상태</th><th class="p-2 text-left">답변</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="cursor-pointer border-t border-line-divider align-top hover:bg-surface-2" :class="selected?.id === r.id ? 'bg-primary-soft' : ''" @click="pick(r)">
            <td class="whitespace-nowrap p-2 font-mono text-ink-muted">{{ String(r.created_at || '').slice(0, 16) }}</td>
            <td class="p-2 text-ink">{{ r.customer_name || r.customer_email || r.user_id }}</td>
            <td class="p-2 text-ink-muted">{{ r.category }}</td>
            <td class="max-w-xs truncate p-2 font-bold text-ink" :title="r.subject">{{ r.subject }}</td>
            <td class="p-2 text-ink-muted" @click.stop>
              <select :value="r.assignee_admin_id || ''" :disabled="assigning || r.status === 'CLOSED'" aria-label="담당자 지정" class="h-8 max-w-32 rounded-lg border border-line bg-surface px-1 text-ink" @change="assign(r, ($event.target as HTMLSelectElement).value)">
                <option value="">미지정</option>
                <option v-for="o in operators" :key="o.id" :value="o.id">{{ o.full_name || o.email }}</option>
              </select>
            </td>
            <td class="p-2">
              <span class="flex flex-wrap items-center gap-1">
                <span class="rounded-full px-2 py-0.5 font-bold" :class="r.status === 'OPEN' ? 'bg-warning-soft text-warning' : r.status === 'ANSWERED' ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted'">{{ statusLabel(r.status) }}</span>
                <span v-if="isOverdue(r)" class="rounded-full bg-danger-soft px-2 py-0.5 font-bold text-danger">기한 경과</span>
              </span>
            </td>
            <td class="p-2"><button class="h-8 rounded-lg bg-secondary px-3 font-bold text-secondary-on hover:bg-secondary-hover" :disabled="r.status === 'CLOSED'" @click.stop="pick(r)">답변하기</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="totalPages > 1" class="flex items-center justify-center gap-2 border-t border-line-divider p-3">
        <button class="h-8 rounded-lg border border-line px-3 font-bold text-ink hover:bg-surface-2" :disabled="page <= 1 || loading" @click="page--; load()">이전</button>
        <span class="text-ink-muted">{{ page }} / {{ totalPages }}</span>
        <button class="h-8 rounded-lg border border-line px-3 font-bold text-ink hover:bg-surface-2" :disabled="page >= totalPages || loading" @click="page++; load()">다음</button>
      </div>
    </div>

    <div v-if="selected" class="space-y-3 rounded-xl border-2 border-warning bg-surface p-4" role="dialog" aria-label="문의 답변">
      <div class="flex items-start justify-between gap-2">
        <div>
          <h2 class="text-sm font-bold text-ink">{{ selected.subject }}</h2>
          <p class="mt-0.5 text-ink-muted">{{ selected.customer_name || selected.customer_email }} · {{ selected.category }} · {{ selected.created_at }} · {{ statusLabel(selected.status) }} · 담당 {{ assigneeName(selected) }}</p>
        </div>
        <button class="font-bold text-ink-subtle hover:text-ink" @click="selected = null">닫기</button>
      </div>
      <div class="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-ink">{{ selected.content }}</div>
      <div v-if="selected.answer" class="whitespace-pre-wrap rounded-lg bg-success-soft p-3 text-ink">
        <p class="mb-1 font-bold text-success">등록된 답변</p>{{ selected.answer }}
      </div>
      <div v-if="selected.status !== 'CLOSED'" class="space-y-2">
        <div class="flex flex-wrap gap-1.5">
          <button v-for="tpl in ANSWER_TEMPLATES" :key="tpl.label" type="button" class="rounded-full border border-line px-2.5 py-1 text-2xs font-bold text-ink-muted hover:bg-surface-2" @click="answer = tpl.text">{{ tpl.label }}</button>
        </div>
        <label class="block font-bold text-ink">답변 작성
          <textarea v-model="answer" rows="4" maxlength="10000" placeholder="고객에게 전달할 답변을 입력해 주세요." class="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-ink" />
        </label>
        <label class="flex items-center gap-2 font-bold text-ink"><input v-model="closing" type="checkbox" class="h-4 w-4 accent-primary" /> 답변과 함께 종결 처리</label>
        <div v-if="replyError" role="alert" class="rounded-lg bg-danger-soft p-2.5 font-bold text-danger">{{ replyError }}</div>
        <div class="flex justify-end gap-2">
          <button class="h-9 rounded-lg border border-line px-4 font-bold text-ink hover:bg-surface-2" @click="selected = null">취소</button>
          <button class="h-9 rounded-lg bg-secondary px-4 font-bold text-secondary-on hover:bg-secondary-hover" :disabled="replying || !answer.trim()" @click="reply">{{ replying ? '등록 중...' : '답변 등록' }}</button>
        </div>
      </div>
      <p v-else class="text-ink-muted">종결된 문의입니다. 답변을 수정할 수 없습니다.</p>
    </div>
  </div>
</template>
