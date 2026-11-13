<script setup lang="ts">
// NEW-09: customer 1:1 inquiry console over GET /api/v1/admin/inquiries +
// POST /api/v1/admin/inquiries/:id/reply. CS/OPERATIONS/SUPER_ADMIN read and reply.
import { ref, onMounted } from 'vue'
import { adminApi } from '../config'
import { useConfirm } from '@olmoa/ui'

const { confirm } = useConfirm()

const rows = ref<any[]>([])
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

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const q = new URLSearchParams()
    if (statusFilter.value) q.set('status', statusFilter.value)
    q.set('page', String(page.value))
    const r = await adminApi(`/api/v1/admin/inquiries?${q.toString()}`)
    if (!r.ok) throw new Error(r.data.error || '문의 목록을 불러오지 못했습니다.')
    rows.value = r.data.data || []
    total.value = Number(r.data.pagination?.total) || rows.value.length
    totalPages.value = Number(r.data.pagination?.total_pages) || 1
    if (selected.value) {
      selected.value = rows.value.find((x: any) => x.id === selected.value.id) || null
    }
  } catch (e: any) {
    loadError.value = e?.message || '문의 목록을 불러오지 못했습니다.'
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
  if (!(await confirm({ title: '답변 등록', body: `[${selected.value.subject}] 문의에 답변을 등록합니다.${closing.value ? ' (종결 처리)' : ''}` }))) return
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
    replyError.value = e?.message || '답변 등록에 실패했습니다.'
  } finally {
    replying.value = false
  }
}

const statusLabel = (s: string) => s === 'OPEN' ? '미답변' : s === 'ANSWERED' ? '답변 완료' : s === 'CLOSED' ? '종결' : (s || '-')

onMounted(load)
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 py-6 space-y-4 text-xs">
    <div>
      <h1 class="text-xl font-black">고객 1:1 문의</h1>
      <p class="text-slate-500 mt-1">접수된 고객 문의를 조회하고 답변합니다. 답변·종결은 감사 로그에 기록됩니다.</p>
    </div>

    <div v-if="toast" role="status" class="p-3 rounded-lg bg-emerald-50 text-emerald-800 font-bold">{{ toast }}</div>

    <form class="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-end gap-2" @submit.prevent="page = 1; load()">
      <label class="block"><span class="font-bold">상태</span>
        <select v-model="statusFilter" class="mt-1 h-9 px-2 rounded border border-slate-300 bg-white" @change="page = 1; load()">
          <option value="">전체</option>
          <option value="OPEN">미답변</option>
          <option value="ANSWERED">답변 완료</option>
          <option value="CLOSED">종결</option>
        </select></label>
      <div class="flex-1"></div>
      <span class="text-slate-500 pb-2">총 {{ total }}건</span>
      <button class="h-9 px-4 rounded-lg bg-slate-900 text-white font-bold" :disabled="loading">{{ loading ? '조회 중...' : '조회' }}</button>
    </form>

    <div v-if="loadError" role="alert" class="p-3 rounded-lg bg-red-50 text-red-700 font-bold flex flex-wrap items-center justify-between gap-2">
      <span>{{ loadError }}</span>
      <button class="h-8 px-3 rounded-lg bg-red-600 text-white font-bold" @click="load">다시 시도</button>
    </div>

    <div v-if="loading" class="p-8 text-center text-slate-400 bg-white rounded-xl border">불러오는 중...</div>
    <div v-else-if="!rows.length && !loadError" class="p-8 text-center text-slate-400 bg-white rounded-xl border">조건에 맞는 문의가 없습니다.</div>

    <div v-else class="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <table class="w-full min-w-[760px]">
        <thead class="bg-slate-50 text-slate-500"><tr><th class="text-left p-2">접수일</th><th class="text-left p-2">고객</th><th class="text-left p-2">분류</th><th class="text-left p-2">제목</th><th class="text-left p-2">상태</th><th class="text-left p-2">답변</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="border-t align-top hover:bg-slate-50 cursor-pointer" :class="selected?.id === r.id ? 'bg-orange-50' : ''" @click="pick(r)">
            <td class="p-2 font-mono whitespace-nowrap">{{ r.created_at }}</td>
            <td class="p-2">{{ r.customer_name || r.customer_email || r.user_id }}</td>
            <td class="p-2">{{ r.category }}</td>
            <td class="p-2 font-bold">{{ r.subject }}</td>
            <td class="p-2"><span class="px-2 py-0.5 rounded-full font-bold" :class="r.status === 'OPEN' ? 'bg-amber-100 text-amber-800' : r.status === 'ANSWERED' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'">{{ statusLabel(r.status) }}</span></td>
            <td class="p-2"><button class="h-8 px-3 rounded-lg bg-slate-900 text-white font-bold" :disabled="r.status === 'CLOSED'" @click.stop="pick(r)">답변하기</button></td>
          </tr>
        </tbody>
      </table>
      <div v-if="totalPages > 1" class="flex items-center justify-center gap-2 p-3 border-t">
        <button class="h-8 px-3 rounded-lg border font-bold" :disabled="page <= 1 || loading" @click="page--; load()">이전</button>
        <span class="text-slate-500">{{ page }} / {{ totalPages }}</span>
        <button class="h-8 px-3 rounded-lg border font-bold" :disabled="page >= totalPages || loading" @click="page++; load()">다음</button>
      </div>
    </div>

    <div v-if="selected" class="bg-white rounded-xl border-2 border-orange-400 p-4 space-y-3" role="dialog" aria-label="문의 답변">
      <div class="flex items-start justify-between gap-2">
        <div>
          <h2 class="text-sm font-black">{{ selected.subject }}</h2>
          <p class="text-slate-500 mt-0.5">{{ selected.customer_name || selected.customer_email }} · {{ selected.category }} · {{ selected.created_at }} · {{ statusLabel(selected.status) }}</p>
        </div>
        <button class="text-slate-400 hover:text-slate-700 font-bold" @click="selected = null">닫기</button>
      </div>
      <div class="p-3 rounded-lg bg-slate-50 whitespace-pre-wrap">{{ selected.content }}</div>
      <div v-if="selected.answer" class="p-3 rounded-lg bg-emerald-50 whitespace-pre-wrap">
        <p class="font-bold text-emerald-800 mb-1">등록된 답변</p>{{ selected.answer }}
      </div>
      <div v-if="selected.status !== 'CLOSED'" class="space-y-2">
        <label class="block font-bold">답변 작성
          <textarea v-model="answer" rows="4" maxlength="10000" placeholder="고객에게 전달할 답변을 입력해 주세요." class="mt-1 w-full p-2 rounded-lg border border-slate-300" />
        </label>
        <label class="flex items-center gap-2 font-bold"><input v-model="closing" type="checkbox" class="h-4 w-4" /> 답변과 함께 종결 처리</label>
        <div v-if="replyError" role="alert" class="p-2.5 rounded-lg bg-red-50 text-red-700 font-bold">{{ replyError }}</div>
        <div class="flex justify-end gap-2">
          <button class="h-9 px-4 rounded-lg border font-bold" @click="selected = null">취소</button>
          <button class="h-9 px-4 rounded-lg bg-slate-900 text-white font-bold" :disabled="replying || !answer.trim()" @click="reply">{{ replying ? '등록 중...' : '답변 등록' }}</button>
        </div>
      </div>
      <p v-else class="text-slate-500">종결된 문의입니다. 답변을 수정할 수 없습니다.</p>
    </div>
  </div>
</template>
