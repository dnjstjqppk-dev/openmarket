<script setup lang="ts">
// FAQ console (6-13): admin-owned support answers. Category tabs + search,
// create/edit, publish toggle, up/down reorder. Every mutation lands in
// admin_audit_log (FAQ_*); per-row updated_by/at is shown inline.
import { ref, computed, onMounted } from 'vue'
import { adminApi } from '../config'
import { userErrorMessage, useToast, OmDataTable, OmEmptyState, OmModal, OmSkeleton } from '@olmoa/ui'

const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'

const rows = ref<any[]>([])
const categories = ref<string[]>([])
const loading = ref(true)
const loadError = ref('')
const fCategory = ref('')
const fQ = ref('')
const formOpen = ref(false)
const editing = ref<any>(null)
const saving = ref(false)
const formError = ref('')
const formWarnings = ref<any[]>([])
const movingId = ref<string | null>(null)
const emptyForm = () => ({ category: '', question: '', answer: '', sort_order: 0, is_published: true })
const form = ref(emptyForm())

const columns = [
  { key: 'order', label: '순서', align: 'right' as const },
  { key: 'category', label: '분류' },
  { key: 'question', label: '질문', primary: true },
  { key: 'status', label: '상태' },
  { key: 'updated', label: '수정', mobileHidden: true },
  { key: 'actions', label: '관리', align: 'right' as const }
]

const visible = computed(() => {
  let list = rows.value
  if (fCategory.value) list = list.filter((r) => r.category === fCategory.value)
  if (fQ.value.trim()) {
    const q = fQ.value.trim().toLowerCase()
    list = list.filter((r) => String(r.question).toLowerCase().includes(q) || String(r.answer).toLowerCase().includes(q))
  }
  return list
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi('/api/v1/admin/faqs')
    if (!r.ok) throw new Error(r.data.error || 'FAQ를 불러오지 못했습니다.')
    rows.value = Array.isArray(r.data.data) ? r.data.data : []
    categories.value = Array.isArray(r.data.categories) ? r.data.categories : []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  form.value = { ...emptyForm(), category: fCategory.value || categories.value[0] || '' }
  formError.value = ''
  formWarnings.value = []
  formOpen.value = true
}

function openEdit(row: any) {
  editing.value = row
  form.value = {
    category: row.category || '', question: row.question || '', answer: row.answer || '',
    sort_order: row.sort_order ?? 0, is_published: Number(row.is_published) === 1
  }
  formError.value = ''
  formWarnings.value = []
  formOpen.value = true
}

async function save() {
  formError.value = ''
  formWarnings.value = []
  if (!form.value.category) { formError.value = '분류를 선택해 주세요.'; return }
  if (!form.value.question.trim()) { formError.value = '질문을 입력해 주세요.'; return }
  if (!form.value.answer.trim()) { formError.value = '답변을 입력해 주세요.'; return }
  saving.value = true
  try {
    const path = editing.value ? `/api/v1/admin/faqs/${editing.value.id}` : '/api/v1/admin/faqs'
    const r = await adminApi(path, {
      method: editing.value ? 'PUT' : 'POST',
      body: JSON.stringify({
        category: form.value.category, question: form.value.question.trim(), answer: form.value.answer,
        sort_order: Number(form.value.sort_order) || 0, is_published: form.value.is_published
      })
    })
    if (!r.ok) throw new Error(r.data.error || '저장에 실패했습니다.')
    formWarnings.value = Array.isArray(r.data.warnings) ? r.data.warnings : []
    if (!formWarnings.value.length) {
      formOpen.value = false
      toastApi.success(editing.value ? 'FAQ를 수정했습니다.' : 'FAQ를 등록했습니다.')
    }
    void load()
  } catch (e: any) {
    formError.value = userErrorMessage(e, U)
  } finally {
    saving.value = false
  }
}

async function togglePublish(row: any) {
  const next = Number(row.is_published) !== 1
  const r = await adminApi(`/api/v1/admin/faqs/${row.id}`, {
    method: 'PUT', body: JSON.stringify({ is_published: next })
  })
  if (!r.ok) { toastApi.error(userErrorMessage(new Error(r.data.error), U)); return }
  toastApi.success(next ? '게시했습니다.' : '게시 중단했습니다.')
  void load()
}

async function move(row: any, dir: -1 | 1) {
  const peers = rows.value.filter((r) => r.category === row.category)
    .sort((a, b) => (a.sort_order - b.sort_order) || String(a.id).localeCompare(String(b.id)))
  const i = peers.findIndex((r) => r.id === row.id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= peers.length) return
  movingId.value = row.id
  try {
    const orders = peers.map((r, n) => ({ id: r.id, sort_order: (n + 1) * 10 }))
    const tmp = orders[i].sort_order
    orders[i].sort_order = orders[j].sort_order
    orders[j].sort_order = tmp
    const r = await adminApi('/api/v1/admin/faqs/reorder', { method: 'PUT', body: JSON.stringify({ orders }) })
    if (!r.ok) throw new Error(r.data.error || '순서 변경에 실패했습니다.')
    void load()
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, U))
  } finally {
    movingId.value = null
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-bold text-ink">FAQ 관리</h1>
      <button type="button" class="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="openCreate">FAQ 등록</button>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <button type="button" class="h-9 rounded-full px-3 text-xs font-bold"
        :class="!fCategory ? 'bg-primary text-primary-on' : 'border border-line text-ink hover:bg-surface-2'"
        @click="fCategory = ''">전체</button>
      <button v-for="c in categories" :key="c" type="button" class="h-9 rounded-full px-3 text-xs font-bold"
        :class="fCategory === c ? 'bg-primary text-primary-on' : 'border border-line text-ink hover:bg-surface-2'"
        @click="fCategory = c">{{ c }}</button>
      <input v-model="fQ" type="search" placeholder="질문·답변 검색" aria-label="FAQ 검색"
        class="h-9 min-w-44 flex-1 rounded-lg border border-line bg-surface px-3 text-xs text-ink sm:max-w-64" />
    </div>

    <OmSkeleton v-if="loading" :rows="5" />
    <OmEmptyState v-else-if="loadError" :title="loadError" action-label="다시 불러오기" @action="load" />
    <OmDataTable v-else :columns="columns" :rows="visible" row-key="id">
      <template #cell-order="{ row }"><span class="om-num">{{ row.sort_order }}</span></template>
      <template #cell-category="{ row }">{{ row.category }}</template>
      <template #cell-question="{ row }"><span class="font-semibold text-ink">{{ row.question }}</span></template>
      <template #cell-status="{ row }">
        <span class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap"
          :class="Number(row.is_published) === 1 ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted'">
          {{ Number(row.is_published) === 1 ? '게시 중' : '게시 중단' }}
        </span>
      </template>
      <template #cell-updated="{ row }"><span class="text-2xs text-ink-muted">{{ row.updated_at || '' }}</span></template>
      <template #cell-actions="{ row }">
        <div class="flex justify-end gap-1">
          <button type="button" :disabled="movingId === row.id" aria-label="위로" class="h-8 w-8 rounded-lg border border-line text-ink hover:bg-surface-2 disabled:opacity-50" @click="move(row, -1)">↑</button>
          <button type="button" :disabled="movingId === row.id" aria-label="아래로" class="h-8 w-8 rounded-lg border border-line text-ink hover:bg-surface-2 disabled:opacity-50" @click="move(row, 1)">↓</button>
          <button type="button" class="h-8 rounded-lg border border-line px-2 text-2xs font-bold text-ink hover:bg-surface-2" @click="togglePublish(row)">
            {{ Number(row.is_published) === 1 ? '중단' : '게시' }}
          </button>
          <button type="button" class="h-8 rounded-lg bg-secondary px-2 text-2xs font-bold text-secondary-on hover:bg-secondary-hover" @click="openEdit(row)">수정</button>
        </div>
      </template>
      <template #empty><OmEmptyState title="등록된 FAQ가 없습니다." /></template>
    </OmDataTable>

    <OmModal v-model:open="formOpen" :title="editing ? 'FAQ 수정' : 'FAQ 등록'">
      <div class="space-y-3 text-xs">
        <label class="block space-y-1">분류 *
          <select v-model="form.category" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink">
            <option value="" disabled>분류 선택</option>
            <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
          </select>
        </label>
        <label class="block space-y-1">질문 *
          <input v-model="form.question" type="text" maxlength="500" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" />
        </label>
        <label class="block space-y-1">답변 * (HTML 일부 태그 허용, 스크립트 제거됨)
          <textarea v-model="form.answer" rows="6" maxlength="20000" class="w-full rounded-lg border border-line bg-surface p-3 text-ink" />
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="block space-y-1">순서
            <input v-model.number="form.sort_order" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" />
          </label>
          <label class="flex items-center gap-2 pt-5 text-ink">
            <input v-model="form.is_published" type="checkbox" class="h-4 w-4" /> 게시
          </label>
        </div>
        <ul v-if="formWarnings.length" class="list-disc space-y-0.5 pl-4 font-bold text-warning">
          <li v-for="(w, i) in formWarnings" :key="i">{{ w.message || w }}</li>
        </ul>
        <p v-if="formError" role="alert" class="font-bold text-danger">{{ formError }}</p>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="formOpen = false">닫기</button>
        <button type="button" :disabled="saving" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="save">{{ saving ? '저장 중…' : '저장' }}</button>
      </template>
    </OmModal>
  </div>
</template>
