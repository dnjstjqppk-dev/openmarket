<script setup lang="ts">
// Banner console (4-18): placement, exposure window, ordering and a
// light/dark legibility preview. The legacy gradient field is gone from
// the form (old rows keep rendering from storage).
import { ref, onMounted } from 'vue'
import { adminApi } from '../../config'
import { userErrorMessage, useConfirm, useToast, OmEmptyState, OmModal, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const POSITION_LABEL: Record<string, string> = { HOME_HERO: '홈 히어로', HOME_STRIP: '홈 띠배너' }

const rows = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const formOpen = ref(false)
const editing = ref<any>(null)
const saving = ref(false)
const formError = ref('')
const previewDark = ref(false)
const emptyForm = () => ({
  title: '', subtitle: '', badge_text: 'HOT DEAL', image_url: '', link_url: '/channel/lightning-deals',
  position: 'HOME_HERO', starts_at: '', ends_at: '', display_order: 10, is_active: true
})
const form = ref(emptyForm())

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi('/api/v1/admin/banners')
    if (!r.ok) throw new Error(r.data.error || '배너를 불러오지 못했습니다.')
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
    title: row.title || '', subtitle: row.subtitle || '', badge_text: row.badge_text || '',
    image_url: row.image_url || '', link_url: row.link_url || '',
    position: row.position || 'HOME_HERO',
    starts_at: (row.starts_at || '').slice(0, 16).replace(' ', 'T'),
    ends_at: (row.ends_at || '').slice(0, 16).replace(' ', 'T'),
    display_order: row.display_order ?? 0, is_active: Number(row.is_active) === 1
  }
  formError.value = ''
  formOpen.value = true
}

const toServerDt = (v: string) => (v ? `${v.replace('T', ' ')}:00`.slice(0, 19) : null)

async function handleCreateBanner() {
  formError.value = ''
  if (!form.value.title.trim()) { formError.value = '배너 제목을 입력해 주세요.'; return }
  if (!/^https:\/\/[^/\s]+(\/\S*)?$/.test(form.value.image_url.trim())) {
    formError.value = '배너 이미지 URL(https)을 입력해 주세요.'
    return
  }
  saving.value = true
  try {
    const body: any = {
      title: form.value.title.trim(), subtitle: form.value.subtitle.trim() || undefined,
      badge_text: form.value.badge_text.trim() || undefined, image_url: form.value.image_url.trim(),
      link_url: form.value.link_url.trim() || undefined, position: form.value.position,
      display_order: Number(form.value.display_order) || 0, is_active: form.value.is_active
    }
    const startsAt = toServerDt(form.value.starts_at)
    const endsAt = toServerDt(form.value.ends_at)
    if (startsAt) body.starts_at = startsAt
    if (endsAt) body.ends_at = endsAt
    const url = editing.value ? `/api/v1/admin/banners/${editing.value.id}` : '/api/v1/admin/banners'
    const r = await adminApi(url, { method: editing.value ? 'PUT' : 'POST', json: body })
    if (!r.ok) throw new Error(r.data.error || '저장에 실패했습니다.')
    toastApi.success(editing.value ? '배너가 수정되었습니다.' : '신규 프로모션 배너가 등록되었습니다.')
    formOpen.value = false
  } catch (e: any) {
    formError.value = userErrorMessage(e, '저장에 실패했습니다.')
  } finally {
    saving.value = false
  }
  void load()
}

async function toggleActive(row: any) {
  try {
    const r = await adminApi(`/api/v1/admin/banners/${row.id}`, { method: 'PUT', json: { is_active: !(Number(row.is_active) === 1) } })
    if (!r.ok) throw new Error(r.data.error || '상태 변경에 실패했습니다.')
    toastApi.success(`배너 [${row.title}] 상태가 변경되었습니다.`)
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '상태 변경에 실패했습니다.'))
  }
  void load()
}

async function remove(row: any) {
  if (!(await askConfirm({ title: '배너 삭제', body: `[${row.title}] 배너를 삭제하시겠습니까?`, danger: true }))) return
  try {
    const r = await adminApi(`/api/v1/admin/banners/${row.id}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(r.data.error || '삭제에 실패했습니다.')
    toastApi.success('배너가 삭제되었습니다.')
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '삭제에 실패했습니다.'))
  }
  void load()
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-ink">배너 관리</h1>
        <p class="mt-1 text-xs text-ink-muted">노출 위치·기간·순서를 정합니다. 띠배너 위치는 스토어 적용 후 노출됩니다.</p>
      </div>
      <button type="button" class="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-on hover:bg-primary-hover" @click="openCreate">새 배너 등록</button>
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
    <OmEmptyState v-else-if="!rows.length" compact title="등록된 배너가 없습니다." description="새 배너를 등록하면 이곳에 표시됩니다." />

    <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <article v-for="b in rows" :key="b.id" class="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
        <div class="relative">
          <img :src="b.image_url" :alt="b.title" loading="lazy" decoding="async" class="h-40 w-full object-cover" />
          <span class="absolute left-2 top-2 rounded bg-overlay/60 px-2 py-0.5 text-[10px] font-bold text-white">{{ POSITION_LABEL[b.position] || b.position }}</span>
          <span class="absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold" :class="Number(b.is_active) === 1 ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted'">{{ Number(b.is_active) === 1 ? '노출 중' : '비활성' }}</span>
        </div>
        <div class="space-y-1 p-4">
          <h2 class="truncate text-sm font-bold text-ink">{{ b.title }}</h2>
          <p class="truncate text-xs text-ink-muted">{{ b.subtitle }}</p>
          <p class="om-num text-2xs text-ink-subtle">{{ b.starts_at || '상시' }} ~ {{ b.ends_at || '상시' }} · 순서 {{ b.display_order }}</p>
          <div class="flex gap-1.5 pt-1">
            <button type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2" @click="openEdit(b)">수정</button>
            <button type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink-muted hover:bg-surface-2" @click="toggleActive(b)">{{ Number(b.is_active) === 1 ? '일시중지' : '노출 재개' }}</button>
            <button type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-danger hover:bg-danger-soft" @click="remove(b)">삭제</button>
          </div>
        </div>
      </article>
    </div>

    <OmModal v-model:open="formOpen" :title="editing ? '배너 수정' : '새 배너 등록'" size="lg">
      <div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
        <label class="space-y-1 sm:col-span-2">제목 *<input v-model="form.title" maxlength="120" placeholder="예: 봄맞이 글로벌 특가 대전" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1 sm:col-span-2">부제<input v-model="form.subtitle" maxlength="200" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">뱃지 문구<input v-model="form.badge_text" maxlength="40" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">랜딩 URL<input v-model="form.link_url" maxlength="500" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" /></label>
        <label class="space-y-1 sm:col-span-2">이미지 URL (https) *<input v-model="form.image_url" maxlength="500" placeholder="https://…" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono text-ink" /></label>
        <label class="space-y-1">노출 위치
          <select v-model="form.position" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink">
            <option value="HOME_HERO">홈 히어로</option>
            <option value="HOME_STRIP">홈 띠배너</option>
          </select>
        </label>
        <label class="space-y-1">노출 순서<input v-model.number="form.display_order" type="number" min="0" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" /></label>
        <label class="space-y-1">노출 시작<input v-model="form.starts_at" type="datetime-local" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink" /></label>
        <label class="space-y-1">노출 종료<input v-model="form.ends_at" type="datetime-local" class="h-10 w-full rounded-lg border border-line bg-surface px-2 text-ink" /></label>
        <label class="flex items-center gap-2 text-ink"><input v-model="form.is_active" type="checkbox" class="accent-primary" /> 즉시 노출</label>
      </div>

      <div class="mt-4 space-y-2">
        <div class="flex items-center justify-between">
          <p class="text-xs font-bold text-ink-muted">미리보기</p>
          <div class="flex gap-1">
            <button type="button" class="rounded-lg px-2.5 py-1 text-2xs font-bold" :class="!previewDark ? 'bg-secondary text-secondary-on' : 'border border-line text-ink-muted'" @click="previewDark = false">밝게</button>
            <button type="button" class="rounded-lg px-2.5 py-1 text-2xs font-bold" :class="previewDark ? 'bg-secondary text-secondary-on' : 'border border-line text-ink-muted'" @click="previewDark = true">어둡게</button>
          </div>
        </div>
        <div class="relative overflow-hidden rounded-xl border border-line">
          <img v-if="form.image_url" :src="form.image_url" alt="배너 미리보기" loading="lazy" decoding="async" class="h-36 w-full object-cover" />
          <div v-else class="flex h-36 items-center justify-center bg-surface-2 text-xs text-ink-subtle">이미지 URL을 입력하면 미리봅니다</div>
          <div v-if="form.image_url" class="absolute inset-x-0 bottom-0 p-3" :class="previewDark ? 'bg-overlay/60' : 'bg-surface/85'">
            <p class="text-sm font-bold" :class="previewDark ? 'text-white' : 'text-ink'">{{ form.title || '배너 제목' }}</p>
            <p class="text-xs" :class="previewDark ? 'text-white/85' : 'text-ink-muted'">{{ form.subtitle || '부제' }}</p>
          </div>
        </div>
      </div>

      <p v-if="formError" role="alert" class="mt-3 text-xs font-bold text-danger">{{ formError }}</p>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="formOpen = false">취소</button>
        <button type="button" :disabled="saving" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="handleCreateBanner">{{ saving ? '저장 중…' : editing ? '수정' : '등록' }}</button>
      </template>
    </OmModal>
  </div>
</template>
