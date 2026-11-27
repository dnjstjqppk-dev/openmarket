<script setup lang="ts">
// Exhibition console (4-18): title, banner, window, products and ordering.
import { ref, onMounted } from 'vue'
import { adminApi } from '../../config'
import { userErrorMessage, useConfirm, useToast, OmEmptyState, OmModal, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const STATUS_LABEL: Record<string, string> = { DRAFT: '작성 중', ACTIVE: '진행 중', ENDED: '종료' }

const rows = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const formOpen = ref(false)
const editing = ref<any>(null)
const saving = ref(false)
const formError = ref('')
const emptyForm = () => ({ title: '', banner_url: '', starts_at: '', ends_at: '', status: 'DRAFT', sort_order: 0, product_ids: '' })
const form = ref(emptyForm())

const toServerDt = (v: string) => (v ? `${v.replace('T', ' ')}:00`.slice(0, 19) : '')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi('/api/v1/admin/exhibitions')
    if (!r.ok) throw new Error(r.data.error || '기획전을 불러오지 못했습니다.')
    rows.value = Array.isArray(r.data.data) ? r.data.data : []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = null
  form.value = emptyForm()
  formError.value = ''
  formOpen.value = true
}

function openEdit(row: any) {
  editing.value = row
  form.value = {
    title: row.title || '', banner_url: row.banner_url || '',
    starts_at: String(row.starts_at || '').slice(0, 16).replace(' ', 'T'),
    ends_at: String(row.ends_at || '').slice(0, 16).replace(' ', 'T'),
    status: row.status || 'DRAFT', sort_order: row.sort_order ?? 0,
    product_ids: (row.product_ids || []).join(', ')
  }
  formError.value = ''
  formOpen.value = true
}

async function submit() {
  formError.value = ''
  if (!form.value.title.trim()) { formError.value = '기획전명을 입력해 주세요.'; return }
  saving.value = true
  try {
    const body: any = {
      title: form.value.title.trim(), starts_at: toServerDt(form.value.starts_at), ends_at: toServerDt(form.value.ends_at),
      status: form.value.status, sort_order: Number(form.value.sort_order) || 0
    }
    if (form.value.banner_url.trim()) body.banner_url = form.value.banner_url.trim()
    if (form.value.product_ids.trim()) body.product_ids = form.value.product_ids.split(',').map((s) => s.trim()).filter(Boolean)
    else if (editing.value) body.product_ids = []
    const url = editing.value ? `/api/v1/admin/exhibitions/${editing.value.id}` : '/api/v1/admin/exhibitions'
    const r = await adminApi(url, { method: editing.value ? 'PUT' : 'POST', json: body })
    if (!r.ok) throw new Error(r.data.error || '저장에 실패했습니다.')
    toastApi.success(editing.value ? '기획전이 수정되었습니다.' : '기획전이 등록되었습니다.')
    formOpen.value = false
  } catch (e: any) {
    formError.value = userErrorMessage(e, '저장에 실패했습니다.')
  } finally {
    saving.value = false
  }
  void load()
}

async function endNow(row: any) {
  if (!(await askConfirm({ title: '기획전 종료', body: `[${row.title}] 기획전을 종료합니다.`, danger: true }))) return
  try {
    const r = await adminApi(`/api/v1/admin/exhibitions/${row.id}`, { method: 'PUT', json: { status: 'ENDED' } })
    if (!r.ok) throw new Error(r.data.error || '종료에 실패했습니다.')
    toastApi.success('기획전이 종료되었습니다.')
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '종료에 실패했습니다.'))
  }
  void load()
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-ink">기획전 관리</h1>
        <p class="mt-1 text-xs text-ink-muted">제목·배너·기간·상품·순서를 정합니다.</p>
      </div>
      <button type="button" class="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="openCreate">기획전 등록</button>
    </div>

    <div v-if="loading && !rows.length" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="6" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="load">다시 불러오기</button>
    </div>
    <OmEmptyState v-else-if="!rows.length" compact title="등록된 기획전이 없습니다." description="기획전을 등록하면 이곳에 표시됩니다." />

    <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <article v-for="e in rows" :key="e.id" class="space-y-2 rounded-2xl border border-line bg-surface p-4">
        <img v-if="e.banner_url" :src="e.banner_url" :alt="e.title" loading="lazy" decoding="async" class="h-28 w-full rounded-xl border border-line object-cover" />
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-bold text-ink">{{ e.title }}</h2>
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="e.status === 'ACTIVE' ? 'bg-success-soft text-success' : e.status === 'ENDED' ? 'bg-surface-3 text-ink-muted' : 'bg-warning-soft text-warning'">{{ STATUS_LABEL[e.status] || e.status }}</span>
        </div>
        <p class="om-num text-2xs text-ink-subtle">{{ String(e.starts_at || '').slice(0, 16) }} ~ {{ String(e.ends_at || '').slice(0, 16) }} · 상품 {{ (e.product_ids || []).length }}개 · 순서 {{ e.sort_order }}</p>
        <div class="flex gap-1.5">
          <button type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2" @click="openEdit(e)">수정</button>
          <button v-if="e.status !== 'ENDED'" type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-danger hover:bg-danger-soft" @click="endNow(e)">종료</button>
        </div>
      </article>
    </div>

    <OmModal v-model:open="formOpen" :title="editing ? '기획전 수정' : '기획전 등록'" size="lg">
      <div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
        <label class="space-y-1 sm:col-span-2">기획전명 *<input v-model="form.title" maxlength="200" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1 sm:col-span-2">배너 이미지 URL<input v-model="form.banner_url" maxlength="500" placeholder="https://…" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" /></label>
        <label class="space-y-1">시작일시 *<input v-model="form.starts_at" type="datetime-local" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink" /></label>
        <label class="space-y-1">종료일시 *<input v-model="form.ends_at" type="datetime-local" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink" /></label>
        <label class="space-y-1">상태
          <select v-model="form.status" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink">
            <option value="DRAFT">작성 중</option>
            <option value="ACTIVE">진행 중</option>
            <option value="ENDED">종료</option>
          </select>
        </label>
        <label class="space-y-1">순서<input v-model.number="form.sort_order" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1 sm:col-span-2">상품 ID (쉼표 구분)<input v-model="form.product_ids" placeholder="prod_001, prod_002" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" /></label>
      </div>
      <p v-if="formError" role="alert" class="mt-3 text-xs font-bold text-danger">{{ formError }}</p>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="formOpen = false">취소</button>
        <button type="button" :disabled="saving" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submit">{{ saving ? '저장 중…' : editing ? '수정' : '등록' }}</button>
      </template>
    </OmModal>
  </div>
</template>
