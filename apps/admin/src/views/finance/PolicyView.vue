<script setup lang="ts">
// Fee policy console (4-17): platform policies with effective dates and
// change history, the commission basis, PG fees and category overrides.
// Policy edits apply forward-only (backdates are refused by the server).
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { adminApi } from '../../config'
import { userErrorMessage, useConfirm, useToast, OmModal, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'

const policies = ref<any[]>([])
const history = ref<any[]>([])
const catRates = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const editOpen = ref(false)
const editKey = ref('')
const editValue = ref('')
const editFrom = ref('')
const saving = ref(false)
// GAP-03: create mode registers a new policy key; edit mode changes a value.
const editIsNew = ref(false)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [p, h, c] = await Promise.all([
      adminApi('/api/v1/admin/platform-policies'),
      adminApi('/api/v1/admin/platform-policies/history?limit=50'),
      adminApi('/api/v1/admin/categories')
    ])
    if (!p.ok) throw new Error(p.data.error || '수수료 정책을 불러오지 못했습니다.')
    policies.value = Array.isArray(p.data.data) ? p.data.data : []
    if (h.ok && Array.isArray(h.data.data)) history.value = h.data.data
    if (c.ok && Array.isArray(c.data.data)) {
      catRates.value = c.data.data.filter((x: any) => x.commission_rate_bps !== null && x.commission_rate_bps !== undefined)
    }
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

function openEdit(key: string, current = '', from = '') {
  editIsNew.value = false
  editKey.value = key
  editValue.value = current
  editFrom.value = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : today()
  editOpen.value = true
}

function openCreate() {
  editIsNew.value = true
  editKey.value = ''
  editValue.value = ''
  editFrom.value = today()
  editOpen.value = true
}

async function submitEdit() {
  if (editIsNew.value && !editKey.value.trim()) { toastApi.error('정책 키를 입력해 주세요.'); return }
  if (!editValue.value.trim() || !editFrom.value) { toastApi.error('값과 적용일을 입력해 주세요.'); return }
  if (editFrom.value < today()) { toastApi.error('적용일은 오늘 이후여야 합니다.'); return }
  const key = editKey.value.trim()
  const title = editIsNew.value ? '신규 정책 키 등록' : '정책 변경'
  const body = editIsNew.value
    ? `신규 정책 키 [${key}]를 등록합니다. ${editFrom.value}부터 적용되며 소급되지 않습니다.`
    : `[${key}] 값을 변경합니다. ${editFrom.value}부터 신규 주문에만 적용되며 소급되지 않습니다.`
  const ok = await askConfirm({ title, body })
  if (!ok) return
  saving.value = true
  try {
    const r = await adminApi('/api/v1/admin/platform-policies', {
      method: 'PUT', json: { key, value: editValue.value.trim(), effective_from: editFrom.value }
    })
    if (!r.ok) throw new Error(r.data.error || '저장에 실패했습니다.')
    toastApi.success('정책이 저장되었습니다.')
    editOpen.value = false
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '저장에 실패했습니다.'))
  } finally {
    saving.value = false
  }
  void load()
}

// 5-8: one key may hold several scheduled rows; the cards show the latest
// already-effective value (future rows are listed below, not applied yet).
const policyOf = (key: string) => policies.value
  .filter((p: any) => p.key === key && String(p.effective_from || '') <= today())
  .sort((a: any, b: any) => String(a.effective_from) < String(b.effective_from) ? 1 : -1)[0]

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold text-ink">수수료 정책</h1>
      <p class="mt-1 text-xs text-ink-muted">정책 변경은 적용일 이후 신규 주문부터 적용됩니다. 과거 정산은 주문 당시 요율로 유지됩니다.</p>
    </div>

    <div v-if="loading" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="6" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="load">다시 시도</button>
    </div>

    <div v-else class="space-y-4">
      <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <h2 class="text-sm font-bold text-ink">수수료 계산 기준</h2>
        <div class="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div class="flex items-center justify-between gap-2 rounded-xl bg-surface-2 p-3">
            <div>
              <p class="font-bold text-ink">판매자 기본 수수료</p>
              <p class="mt-0.5 text-ink-subtle">판매자별 개별 요율 (전역 기본값 없음)</p>
            </div>
            <RouterLink to="/partners" class="shrink-0 rounded-lg bg-secondary px-3 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover">셀러별 보기</RouterLink>
          </div>
          <div class="flex items-center justify-between gap-2 rounded-xl bg-surface-2 p-3">
            <div>
              <p class="font-bold text-ink">계산 기준</p>
              <p class="om-num mt-0.5 text-ink-subtle">commission.base = {{ policyOf('commission.base')?.value || '(미설정: 총액 기준)' }}</p>
            </div>
            <button type="button" class="shrink-0 rounded-lg bg-secondary px-3 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="openEdit('commission.base', policyOf('commission.base')?.value || '')">변경</button>
          </div>
          <div class="flex items-center justify-between gap-2 rounded-xl bg-surface-2 p-3">
            <div>
              <p class="font-bold text-ink">PG 수수료</p>
              <p class="om-num mt-0.5 text-ink-subtle">pg.fee_bps = {{ policyOf('pg.fee_bps')?.value || '(미설정)' }} (결제수단별 차등 없음)</p>
            </div>
            <button type="button" class="shrink-0 rounded-lg bg-secondary px-3 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="openEdit('pg.fee_bps', policyOf('pg.fee_bps')?.value || '')">변경</button>
          </div>
          <div class="flex items-center justify-between gap-2 rounded-xl bg-surface-2 p-3">
            <div>
              <p class="font-bold text-ink">카테고리 수수료</p>
              <p class="mt-0.5 text-ink-subtle">{{ catRates.length }}개 카테고리에 예외율 적용 중</p>
            </div>
            <RouterLink to="/categories" class="shrink-0 rounded-lg bg-secondary px-3 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover">카테고리에서 변경</RouterLink>
          </div>
        </div>
      </section>

      <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-bold text-ink">플랫폼 정책 목록</h2>
          <button type="button" class="rounded-lg bg-secondary px-3 py-1.5 text-xs font-bold text-secondary-on hover:bg-secondary-hover" @click="openCreate">신규 정책 키 등록</button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[520px] text-xs">
            <thead class="text-ink-muted"><tr><th class="p-1 text-left">키</th><th class="p-1 text-left">값</th><th class="p-1 text-left">적용일</th><th></th></tr></thead>
            <tbody>
              <tr v-for="p in policies" :key="`${p.key}@${p.effective_from}`" class="border-t border-line-divider">
                <td class="p-1 font-mono font-bold text-ink">{{ p.key }}</td>
                <td class="om-num p-1 text-ink">{{ p.value }}</td>
                <td class="om-num p-1 text-ink-muted">{{ p.effective_from }}</td>
                <td class="p-1 text-right"><button type="button" class="rounded-lg border border-line px-2.5 py-1.5 font-bold text-ink hover:bg-surface-2" @click="openEdit(p.key, p.value, p.effective_from)">변경</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <h2 class="text-sm font-bold text-ink">정책 변경 이력</h2>
        <p v-if="!history.length" class="text-xs text-ink-muted">변경 이력이 없습니다.</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[520px] text-xs">
            <thead class="text-ink-muted"><tr><th class="p-1 text-left">키</th><th class="p-1 text-left">이전 값</th><th class="p-1 text-left">새 값</th><th class="p-1 text-left">변경자</th><th class="p-1 text-left">시각</th></tr></thead>
            <tbody>
              <tr v-for="h in history" :key="h.id" class="border-t border-line-divider">
                <td class="p-1 font-mono font-bold text-ink">{{ h.policy_key }}</td>
                <td class="om-num p-1 text-ink-muted">{{ h.old_value }}</td>
                <td class="om-num p-1 font-bold text-ink">{{ h.new_value }}</td>
                <td class="p-1 text-ink-muted">{{ h.changed_by }}</td>
                <td class="om-num p-1 text-ink-subtle">{{ String(h.created_at || '').slice(0, 16).replace('T', ' ') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <OmModal v-model:open="editOpen" :title="editIsNew ? '신규 정책 키 등록' : `정책 변경 · ${editKey}`">
      <div class="space-y-3 text-xs">
        <label v-if="editIsNew" class="block space-y-1 font-bold text-ink-muted">키<input v-model="editKey" placeholder="예: badge.today_ship_min_rate_bps" maxlength="100" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-mono font-normal text-ink" /></label>
        <p v-if="editIsNew && editKey.trim() && policies.some((p: any) => p.key === editKey.trim())" class="text-2xs font-bold text-warning">이미 존재하는 키입니다. 저장하면 해당 키의 신규 적용일 행이 추가됩니다.</p>
        <label class="block space-y-1 font-bold text-ink-muted">값<input v-model="editValue" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-normal text-ink" /></label>
        <label class="block space-y-1 font-bold text-ink-muted">적용일 (오늘 이후)<input v-model="editFrom" type="date" :min="today()" class="h-10 w-full rounded-lg border border-line bg-surface px-2 font-normal text-ink" /></label>
        <p class="text-2xs text-ink-subtle">소급 적용되지 않습니다. 변경 이력에 기록됩니다.</p>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="editOpen = false">취소</button>
        <button type="button" :disabled="saving || !editValue.trim() || !editFrom || (editIsNew && !editKey.trim())" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitEdit">{{ saving ? '저장 중…' : '저장' }}</button>
      </template>
    </OmModal>
  </div>
</template>
