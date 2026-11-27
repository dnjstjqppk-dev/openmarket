<script setup lang="ts">
// Category console (4-15): 3-level tree with drag reorder on the left,
// detail tabs (basics, notice template, commission, banned words) on the right.
import { ref, computed, onMounted } from 'vue'
import { adminApi } from '../config'
import { userErrorMessage, useConfirm, useToast, OmEmptyState, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'

interface Category {
  id: string
  parent_id: string | null
  name: string
  slug: string
  depth: number
  sort_order: number
  is_active: number
  icon_key?: string | null
  notice_template_id?: string | null
  commission_rate_bps?: number | null
  banned_words?: string[]
  product_count: number
}

const categories = ref<Category[]>([])
const templates = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const selectedId = ref('')
const tab = ref<'basic' | 'notice' | 'fee' | 'banned'>('basic')
const saving = ref(false)
const formError = ref('')
const form = ref({ name: '', slug: '', parent_id: '', sort_order: 0 })
const edit = ref({ name: '', slug: '', icon_key: '', is_active: true, notice_template_id: '', commission_bps: '' as string, banned: [] as string[], bannedInput: '' })
const dragId = ref<string | null>(null)

const selected = computed(() => categories.value.find((c) => c.id === selectedId.value) || null)
const roots = computed(() => categories.value.filter((c) => !c.parent_id).sort((a, b) => a.sort_order - b.sort_order))
const childrenOf = (id: string | null) => categories.value
  .filter((c) => (id === null ? !c.parent_id : c.parent_id === id))
  .sort((a, b) => a.sort_order - b.sort_order)

async function loadCategories() {
  loading.value = true
  loadError.value = ''
  try {
    const [c, t] = await Promise.all([
      adminApi('/api/v1/admin/categories'),
      adminApi('/api/v1/admin/notice-templates')
    ])
    if (!c.ok) throw new Error(c.data.error || '카테고리를 불러오지 못했습니다.')
    categories.value = Array.isArray(c.data.data) ? c.data.data : []
    if (t.ok && Array.isArray(t.data.data)) templates.value = t.data.data
    if (selectedId.value) syncEdit()
    else if (roots.value.length) select(roots.value[0].id)
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

function select(id: string) {
  selectedId.value = id
  tab.value = 'basic'
  syncEdit()
}

function syncEdit() {
  const c = selected.value
  if (!c) return
  edit.value = {
    name: c.name, slug: c.slug, icon_key: c.icon_key || '', is_active: Number(c.is_active) === 1,
    notice_template_id: c.notice_template_id || '',
    commission_bps: c.commission_rate_bps === null || c.commission_rate_bps === undefined ? '' : String(c.commission_rate_bps),
    banned: [...(c.banned_words || [])], bannedInput: ''
  }
}

async function createCategory() {
  if (!form.value.name.trim()) return
  formError.value = ''
  try {
    const r = await adminApi('/api/v1/admin/categories', {
      method: 'POST',
      json: { name: form.value.name.trim(), slug: form.value.slug.trim() || undefined, parent_id: form.value.parent_id || undefined, sort_order: form.value.sort_order || 0 }
    })
    if (!r.ok) throw new Error(r.data.error || '카테고리를 생성하지 못했습니다. 잠시 후 다시 시도해주세요.')
    form.value = { name: '', slug: '', parent_id: '', sort_order: 0 }
    toastApi.success('카테고리가 생성되었습니다.')
    await loadCategories()
  } catch (e: any) {
    formError.value = userErrorMessage(e, '카테고리 생성 중 네트워크 오류가 발생했습니다.')
  }
}

async function saveEdit() {
  const c = selected.value
  if (!c || saving.value) return
  saving.value = true
  try {
    const body: any = {
      name: edit.value.name.trim(), slug: edit.value.slug.trim(), icon_key: edit.value.icon_key.trim() || null,
      is_active: edit.value.is_active, notice_template_id: edit.value.notice_template_id || null,
      commission_rate_bps: edit.value.commission_bps === '' ? null : Number(edit.value.commission_bps),
      banned_words: edit.value.banned
    }
    const r = await adminApi(`/api/v1/admin/categories/${c.id}`, { method: 'PUT', json: body })
    if (!r.ok) throw new Error(r.data.error || '저장에 실패했습니다.')
    toastApi.success('카테고리가 저장되었습니다.')
    await loadCategories()
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '저장에 실패했습니다.'))
  } finally {
    saving.value = false
  }
}

async function deleteCategory(id: string) {
  const c = categories.value.find((x) => x.id === id)
  if (!c) return
  if (!(await askConfirm({ title: '카테고리 삭제', body: `[${c.name}] 카테고리를 삭제하시겠습니까?`, danger: true }))) return
  try {
    const r = await adminApi(`/api/v1/admin/categories/${id}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(r.data.error || '삭제에 실패했습니다.')
    toastApi.success('카테고리가 삭제되었습니다.')
    if (selectedId.value === id) selectedId.value = ''
    await loadCategories()
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '삭제에 실패했습니다.'))
  }
}

function addBanned() {
  const w = edit.value.bannedInput.trim()
  if (!w) return
  if (!edit.value.banned.includes(w)) edit.value.banned.push(w)
  edit.value.bannedInput = ''
}

// Drag reorder within the same sibling list; persists compacted sort orders.
function onDragStart(id: string) { dragId.value = id }
function onDrop(targetId: string) {
  const from = categories.value.find((c) => c.id === dragId.value)
  const to = categories.value.find((c) => c.id === targetId)
  dragId.value = null
  if (!from || !to || from.id === to.id || (from.parent_id || null) !== (to.parent_id || null)) return
  const sibs = childrenOf(from.parent_id || null).filter((c) => c.id !== from.id)
  const at = sibs.findIndex((c) => c.id === to.id)
  sibs.splice(at < 0 ? sibs.length : at, 0, from)
  void persistOrder(sibs)
}
async function persistOrder(sibs: Category[]) {
  try {
    for (let i = 0; i < sibs.length; i++) {
      if (sibs[i].sort_order === i) continue
      const r = await adminApi(`/api/v1/admin/categories/${sibs[i].id}`, { method: 'PUT', json: { sort_order: i } })
      if (!r.ok) throw new Error(r.data.error || '순서 저장에 실패했습니다.')
      sibs[i].sort_order = i
    }
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '순서 저장에 실패했습니다.'))
    void loadCategories()
  }
}

onMounted(loadCategories)
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold text-ink">카테고리 관리</h1>
      <p class="mt-1 text-xs text-ink-muted">3단까지 만들 수 있습니다. 같은 단계 안에서 끌어서 순서를 바꿉니다.</p>
    </div>

    <div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-4">
      <input v-model="form.name" placeholder="카테고리명" aria-label="카테고리명" class="h-9 min-w-0 rounded-lg border border-line bg-surface px-3 text-ink" />
      <input v-model="form.slug" placeholder="슬러그 (자동)" aria-label="슬러그" class="h-9 min-w-0 rounded-lg border border-line bg-surface px-3 text-ink" />
      <select v-model="form.parent_id" aria-label="상위 카테고리" class="h-9 min-w-0 rounded-lg border border-line bg-surface px-2 text-ink">
        <option value="">최상위 (부모 없음)</option>
        <option v-for="c in categories.filter((x) => x.depth < 2)" :key="c.id" :value="c.id">{{ c.name }} ({{ c.slug }})</option>
      </select>
      <div class="flex min-w-0 gap-2">
        <input v-model.number="form.sort_order" type="number" min="0" placeholder="정렬순서" aria-label="정렬 순서" class="h-9 w-24 min-w-0 rounded-lg border border-line bg-surface px-2 text-ink" />
        <button type="button" class="h-9 flex-1 rounded-lg bg-primary px-3 font-bold text-primary-on hover:bg-primary-hover" @click="createCategory">생성</button>
      </div>
    </div>
    <div v-if="formError" role="alert" class="rounded-xl border border-danger bg-danger-soft p-3 text-xs font-bold text-danger">{{ formError }}</div>

    <div v-if="loading" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="8" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="loadCategories">다시 불러오기</button>
    </div>
    <OmEmptyState v-else-if="!categories.length" compact title="등록된 카테고리가 없습니다." description="상단 양식으로 첫 카테고리를 만들어 보세요." />

    <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div class="space-y-1 lg:col-span-2">
        <template v-for="l1 in roots" :key="l1.id">
          <div
            draggable="true" @dragstart="onDragStart(l1.id)" @dragover.prevent @drop="onDrop(l1.id)"
            class="cursor-move rounded-xl border border-line bg-surface p-2.5"
            :class="selectedId === l1.id ? 'border-primary' : ''"
          >
            <button type="button" class="flex w-full items-center justify-between gap-2 text-left" @click="select(l1.id)">
              <span class="truncate text-xs font-bold text-ink">{{ l1.name }}</span>
              <span class="flex shrink-0 items-center gap-1 text-2xs text-ink-subtle">
                <span v-if="Number(l1.is_active) !== 1" class="rounded-full bg-surface-3 px-1.5 py-0.5 font-bold">숨김</span>
                <span class="om-num">{{ l1.product_count || 0 }}</span>
              </span>
            </button>
            <div v-for="l2 in childrenOf(l1.id)" :key="l2.id" class="ml-3 mt-1">
              <div
                draggable="true" @dragstart="onDragStart(l2.id)" @dragover.prevent @drop="onDrop(l2.id)"
                class="cursor-move rounded-lg border border-line-divider bg-surface-2 p-2"
                :class="selectedId === l2.id ? 'border-primary' : ''"
              >
                <button type="button" class="flex w-full items-center justify-between gap-2 text-left" @click="select(l2.id)">
                  <span class="truncate text-xs font-bold text-ink">{{ l2.name }}</span>
                  <span class="flex shrink-0 items-center gap-1 text-2xs text-ink-subtle">
                    <span v-if="Number(l2.is_active) !== 1" class="rounded-full bg-surface-3 px-1.5 py-0.5 font-bold">숨김</span>
                    <span class="om-num">{{ l2.product_count || 0 }}</span>
                  </span>
                </button>
                <div v-for="l3 in childrenOf(l2.id)" :key="l3.id" class="ml-3 mt-1">
                  <div
                    draggable="true" @dragstart="onDragStart(l3.id)" @dragover.prevent @drop="onDrop(l3.id)"
                    class="cursor-move rounded-lg border border-line-divider bg-surface p-1.5"
                    :class="selectedId === l3.id ? 'border-primary' : ''"
                  >
                    <button type="button" class="flex w-full items-center justify-between gap-2 text-left" @click="select(l3.id)">
                      <span class="truncate text-xs text-ink">{{ l3.name }}</span>
                      <span class="flex shrink-0 items-center gap-1 text-2xs text-ink-subtle">
                        <span v-if="Number(l3.is_active) !== 1" class="rounded-full bg-surface-3 px-1.5 py-0.5 font-bold">숨김</span>
                        <span class="om-num">{{ l3.product_count || 0 }}</span>
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>

      <div v-if="selected" class="space-y-3 lg:col-span-3">
        <div class="flex flex-wrap items-center gap-2">
          <button v-for="t in [['basic', '기본'], ['notice', '고시 템플릿'], ['fee', '수수료율'], ['banned', '금칙어']] as const" :key="t[0]" type="button"
            class="h-9 rounded-lg px-3 text-xs font-bold"
            :class="tab === t[0] ? 'bg-secondary text-secondary-on' : 'border border-line text-ink-muted hover:bg-surface-2'"
            @click="tab = t[0]">{{ t[1] }}</button>
          <button type="button" class="ml-auto h-9 rounded-lg px-3 text-xs font-bold text-danger hover:bg-danger-soft" @click="deleteCategory(selected.id)">삭제</button>
        </div>

        <div v-if="tab === 'basic'" class="grid grid-cols-1 gap-3 rounded-2xl border border-line bg-surface p-5 text-xs sm:grid-cols-2">
          <label class="space-y-1 font-bold text-ink-muted">이름<input v-model="edit.name" maxlength="200" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-normal text-ink" /></label>
          <label class="space-y-1 font-bold text-ink-muted">주소 (slug)<input v-model="edit.slug" maxlength="200" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono font-normal text-ink" /></label>
          <label class="space-y-1 font-bold text-ink-muted">아이콘 키<input v-model="edit.icon_key" maxlength="60" placeholder="예: shirt" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono font-normal text-ink" /></label>
          <label class="flex items-center gap-2 font-bold text-ink"><input v-model="edit.is_active" type="checkbox" class="accent-primary" /> 스토어에 노출</label>
        </div>

        <div v-if="tab === 'notice'" class="space-y-2 rounded-2xl border border-line bg-surface p-5 text-xs">
          <label class="block space-y-1 font-bold text-ink-muted">고시 템플릿
            <select v-model="edit.notice_template_id" class="h-10 w-full rounded-lg border border-line bg-surface px-2 font-normal text-ink">
              <option value="">지정 안 함</option>
              <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }} (v{{ t.version }})</option>
            </select>
          </label>
          <p class="text-2xs text-ink-subtle">상품 등록 시 이 템플릿의 필수 항목 입력을 강제합니다.</p>
        </div>

        <div v-if="tab === 'fee'" class="space-y-2 rounded-2xl border border-line bg-surface p-5 text-xs">
          <label class="block max-w-xs space-y-1 font-bold text-ink-muted">수수료율 (bps, 0~3000)
            <input v-model="edit.commission_bps" type="number" min="0" max="3000" placeholder="비우면 판매자 기본율" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-normal text-ink" /></label>
          <p class="text-2xs text-ink-subtle">변경분은 신규 주문부터 적용됩니다. 기존 정산은 주문 당시 요율로 유지됩니다.</p>
        </div>

        <div v-if="tab === 'banned'" class="space-y-2 rounded-2xl border border-line bg-surface p-5 text-xs">
          <div class="flex gap-2">
            <input v-model="edit.bannedInput" maxlength="50" placeholder="금칙어 추가" aria-label="금칙어 추가" class="h-10 flex-1 rounded-lg border border-line bg-surface px-3 text-ink" @keyup.enter="addBanned" />
            <button type="button" class="h-10 rounded-lg bg-secondary px-4 font-bold text-secondary-on hover:bg-secondary-hover" @click="addBanned">추가</button>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <span v-for="w in edit.banned" :key="w" class="flex items-center gap-1 rounded-full bg-danger-soft px-2.5 py-1 text-2xs font-bold text-danger whitespace-nowrap">
              {{ w }}
              <button type="button" :aria-label="`${w} 삭제`" class="font-bold" @click="edit.banned = edit.banned.filter((x) => x !== w)">×</button>
            </span>
          </div>
          <p v-if="!edit.banned.length" class="text-ink-muted">등록된 금칙어가 없습니다.</p>
        </div>

        <div class="flex justify-end">
          <button type="button" :disabled="saving" class="h-11 rounded-xl bg-primary px-8 text-xs font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="saveEdit">{{ saving ? '저장 중…' : '저장' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
