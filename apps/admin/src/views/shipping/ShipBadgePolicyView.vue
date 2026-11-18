<script setup lang="ts">
// Ship-badge console: today/tomorrow dispatch badge policies plus the
// per-seller eligibility board. Policies reuse platform-policies (PUT
// upserts any key, forward-only dates); the board reads the admin
// ship-badges endpoint and edits cutoffs on the seller's own template.
import { ref, computed, onMounted } from 'vue'
import { adminApi } from '../../config'
import { userErrorMessage, useConfirm, useToast, OmModal, OmSkeleton, OmEmptyState } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'

const RATE_KEY = 'badge.today_ship_min_rate_bps'
const ENABLE_KEY = 'badge.tomorrow_ship_enabled'

const policies = ref<any[]>([])
const history = ref<any[]>([])
const sellers = ref<any[]>([])
const pagination = ref({ page: 1, per_page: 50, total: 0, total_pages: 1 })
const nowKst = ref('')
const q = ref('')
const loading = ref(true)
const loadError = ref('')
const editOpen = ref(false)
const editKey = ref('')
const editValue = ref('')
const editFrom = ref('')
const saving = ref(false)
const cutoffOpen = ref(false)
const cutoffSeller = ref<any | null>(null)
const cutoffValue = ref('')
const cutoffSaving = ref(false)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const params = new URLSearchParams({ page: String(pagination.value.page), per_page: '50' })
    if (q.value.trim()) params.set('q', q.value.trim())
    const [p, s, h] = await Promise.all([
      adminApi('/api/v1/admin/platform-policies'),
      adminApi(`/api/v1/admin/ship-badges/sellers?${params.toString()}`),
      adminApi('/api/v1/admin/platform-policies/history?limit=50')
    ])
    if (!p.ok) throw new Error(p.data.error || '정책을 불러오지 못했습니다.')
    if (!s.ok) throw new Error(s.data.error || '셀러 현황을 불러오지 못했습니다.')
    policies.value = Array.isArray(p.data.data) ? p.data.data : []
    sellers.value = Array.isArray(s.data.data) ? s.data.data : []
    pagination.value = s.data.pagination || pagination.value
    nowKst.value = String(s.data.now_kst || '')
    if (h.ok && Array.isArray(h.data.data)) history.value = h.data.data
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

const policyOf = (key: string) => policies.value
  .filter((p: any) => p.key === key && String(p.effective_from || '') <= today())
  .sort((a: any, b: any) => String(a.effective_from) < String(b.effective_from) ? 1 : -1)[0]

const ratePolicy = computed(() => policyOf(RATE_KEY))
const enablePolicy = computed(() => policyOf(ENABLE_KEY))
const badgeHistory = computed(() => history.value.filter((h: any) => String(h.policy_key || '').startsWith('badge.')))

const rateText = computed(() => {
  const v = ratePolicy.value?.value
  if (v === undefined || v === null || v === '') return '(미설정: 뱃지 전체 꺼짐)'
  const n = Number(v)
  return Number.isSafeInteger(n) ? `${(n / 100).toFixed(1)}% (${n}bps)` : `(잘못된 값: ${v})`
})

const enableText = computed(() => {
  const v = String(enablePolicy.value?.value ?? '')
  if (!v) return '(미설정: 내일출발 꺼짐)'
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()) ? '켜짐' : '꺼짐'
})

function openEdit(key: string) {
  editKey.value = key
  const cur = policyOf(key)?.value
  editValue.value = cur === undefined || cur === null ? '' : String(cur)
  editFrom.value = today()
  editOpen.value = true
}

async function submitEdit() {
  let value = editValue.value.trim()
  if (!value || !editFrom.value) { toastApi.error('값과 적용일을 입력해 주세요.'); return }
  if (editFrom.value < today()) { toastApi.error('적용일은 오늘 이후여야 합니다.'); return }
  if (editKey.value === RATE_KEY) {
    const n = Number(value)
    if (!Number.isSafeInteger(n) || n < 0 || n > 10000) { toastApi.error('출고율 기준은 0~10000 bps 정수로 입력해 주세요.'); return }
    value = String(n)
  } else {
    if (!['0', '1'].includes(value)) { toastApi.error("내일출발 표시는 '1'(켜짐) 또는 '0'(꺼짐)으로 입력해 주세요."); return }
  }
  const ok = await askConfirm({ title: '뱃지 정책 변경', body: `[${editKey.value}] 값을 ${value}(으)로 변경합니다. ${editFrom.value}부터 적용되며 소급되지 않습니다.` })
  if (!ok) return
  saving.value = true
  try {
    const r = await adminApi('/api/v1/admin/platform-policies', {
      method: 'PUT', json: { key: editKey.value, value, effective_from: editFrom.value }
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

function openCutoff(s: any) {
  cutoffSeller.value = s
  cutoffValue.value = s.today_cutoff || ''
  cutoffOpen.value = true
}

async function submitCutoff(clear: boolean) {
  if (!cutoffSeller.value) return
  const v = clear ? null : cutoffValue.value.trim()
  if (!clear && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v || '')) { toastApi.error('마감시각은 HH:MM 형식으로 입력해 주세요.'); return }
  const ok = await askConfirm({
    title: '마감시각 변경',
    body: `${cutoffSeller.value.business_name}의 오늘출발 마감을 ${clear ? '지웁니다(뱃지 대상 제외)' : `${v}(으)로 변경합니다`}.`
  })
  if (!ok) return
  cutoffSaving.value = true
  try {
    const r = await adminApi(`/api/v1/admin/partners/${cutoffSeller.value.partner_id}/shipping-cutoff`, {
      method: 'PUT', json: { today_cutoff: v }
    })
    if (!r.ok) throw new Error(r.data.error || '저장에 실패했습니다.')
    toastApi.success('마감시각이 저장되었습니다.')
    cutoffOpen.value = false
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, '저장에 실패했습니다.'))
  } finally {
    cutoffSaving.value = false
  }
  void load()
}

const badgeLabel: Record<string, string> = { TODAY: '오늘출발', TOMORROW: '내일출발', NONE: '없음' }
const reasonLabel: Record<string, string> = {
  ELIGIBLE: '충족', POLICY_OFF: '정책 미설정', TOMORROW_DISABLED: '내일출발 꺼짐',
  NO_TEMPLATE: '템플릿 없음', NO_CUTOFF: '마감 미등록', NO_HISTORY: '출고 이력 없음', RATE_BELOW: '출고율 미달'
}

function search() {
  pagination.value = { ...pagination.value, page: 1 }
  void load()
}

function gotoPage(p: number) {
  pagination.value = { ...pagination.value, page: p }
  void load()
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold text-ink">출고 뱃지 정책</h1>
      <p class="mt-1 text-xs text-ink-muted">오늘출발·내일출발 뱃지 기준을 정하고 셀러별 충족 현황을 봅니다. 정책이 없으면 뱃지는 전부 꺼집니다.</p>
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
        <h2 class="text-sm font-bold text-ink">뱃지 정책</h2>
        <div class="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
          <div class="flex items-center justify-between gap-2 rounded-xl bg-surface-2 p-3">
            <div>
              <p class="font-bold text-ink">당일출고율 기준</p>
              <p class="om-num mt-0.5 text-ink-subtle">{{ rateText }}</p>
            </div>
            <button type="button" class="shrink-0 rounded-lg bg-secondary px-3 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="openEdit(RATE_KEY)">변경</button>
          </div>
          <div class="flex items-center justify-between gap-2 rounded-xl bg-surface-2 p-3">
            <div>
              <p class="font-bold text-ink">내일출발 표시</p>
              <p class="mt-0.5 text-ink-subtle">{{ enableText }}</p>
            </div>
            <button type="button" class="shrink-0 rounded-lg bg-secondary px-3 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="openEdit(ENABLE_KEY)">변경</button>
          </div>
          <div class="flex items-center justify-between gap-2 rounded-xl bg-surface-2 p-3">
            <div>
              <p class="font-bold text-ink">기준 시각</p>
              <p class="om-num mt-0.5 text-ink-subtle">{{ nowKst ? `${nowKst} KST` : '-' }}</p>
            </div>
          </div>
        </div>
        <p class="text-2xs text-ink-subtle">오늘출발 = 마감 전 + 출고율 충족. 내일출발 = 마감 지남 + 출고율 충족 + 표시 켜짐. 출고율은 최근 30일 발송 건의 당일 출고 비율입니다.</p>
      </section>

      <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-bold text-ink">셀러별 현황</h2>
          <form class="flex gap-2" @submit.prevent="search">
            <input v-model="q" type="search" placeholder="상호·ID 검색" aria-label="셀러 검색" class="h-9 w-44 rounded-lg border border-line bg-surface px-3 text-xs text-ink" />
            <button type="submit" class="h-9 rounded-lg bg-secondary px-4 text-xs font-bold text-secondary-on hover:bg-secondary-hover">검색</button>
          </form>
        </div>
        <OmEmptyState v-if="!sellers.length" compact title="조건에 맞는 셀러가 없습니다" description="검색어를 바꾸거나 잠시 후 다시 확인해 보세요." />
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[720px] text-xs">
            <thead class="text-ink-muted"><tr><th class="p-1 text-left">상호</th><th class="p-1 text-left">상태</th><th class="p-1 text-left">마감시각</th><th class="p-1 text-right">30일 출고율</th><th class="p-1 text-left">현재 뱃지</th><th class="p-1 text-left">사유</th><th></th></tr></thead>
            <tbody>
              <tr v-for="s in sellers" :key="s.partner_id" class="border-t border-line-divider">
                <td class="p-1 font-bold text-ink">{{ s.business_name }}<span class="block font-mono font-normal text-ink-subtle">{{ s.partner_id }}</span></td>
                <td class="p-1 text-ink-muted">{{ s.status }}</td>
                <td class="om-num p-1 text-ink">{{ s.today_cutoff || '미등록' }}</td>
                <td class="om-num p-1 text-right text-ink">{{ s.same_day_rate_bps === null ? '-' : `${(s.same_day_rate_bps / 100).toFixed(1)}%` }}<span class="text-ink-subtle"> ({{ s.shipped_30d }}건)</span></td>
                <td class="p-1"><span :class="['rounded-full px-2 py-0.5 text-2xs font-bold', s.badge_now === 'TODAY' ? 'bg-primary-soft text-primary-soft-ink' : s.badge_now === 'TOMORROW' ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted']">{{ badgeLabel[s.badge_now] || s.badge_now }}</span></td>
                <td class="p-1 text-ink-muted">{{ reasonLabel[s.badge_reason] || s.badge_reason }}</td>
                <td class="p-1 text-right"><button type="button" class="rounded-lg border border-line px-2.5 py-1.5 font-bold text-ink hover:bg-surface-2" @click="openCutoff(s)">마감 변경</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="pagination.total_pages > 1" class="flex items-center justify-center gap-2">
          <button type="button" :disabled="pagination.page <= 1" class="h-8 rounded-lg border border-line px-3 font-bold text-ink hover:bg-surface-2 disabled:opacity-40" @click="gotoPage(pagination.page - 1)">이전</button>
          <span class="om-num text-ink-muted">{{ pagination.page }} / {{ pagination.total_pages }}</span>
          <button type="button" :disabled="pagination.page >= pagination.total_pages" class="h-8 rounded-lg border border-line px-3 font-bold text-ink hover:bg-surface-2 disabled:opacity-40" @click="gotoPage(pagination.page + 1)">다음</button>
        </div>
      </section>

      <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <h2 class="text-sm font-bold text-ink">뱃지 정책 변경 이력</h2>
        <p v-if="!badgeHistory.length" class="text-xs text-ink-muted">변경 이력이 없습니다.</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[520px] text-xs">
            <thead class="text-ink-muted"><tr><th class="p-1 text-left">키</th><th class="p-1 text-left">이전 값</th><th class="p-1 text-left">새 값</th><th class="p-1 text-left">변경자</th><th class="p-1 text-left">시각</th></tr></thead>
            <tbody>
              <tr v-for="h in badgeHistory" :key="h.id" class="border-t border-line-divider">
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

    <OmModal v-model:open="editOpen" :title="`뱃지 정책 변경 · ${editKey}`">
      <div class="space-y-3 text-xs">
        <label class="block space-y-1 font-bold text-ink-muted">{{ editKey === RATE_KEY ? '값 (0~10000 bps, 8000 = 80%)' : "값 ('1' 켜짐 / '0' 꺼짐)" }}<input v-model="editValue" class="h-10 w-full rounded-lg border border-line bg-surface px-3 font-normal text-ink" /></label>
        <label class="block space-y-1 font-bold text-ink-muted">적용일 (오늘 이후)<input v-model="editFrom" type="date" :min="today()" class="h-10 w-full rounded-lg border border-line bg-surface px-2 font-normal text-ink" /></label>
        <p class="text-2xs text-ink-subtle">소급 적용되지 않습니다. 변경 이력에 기록됩니다.</p>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="editOpen = false">취소</button>
        <button type="button" :disabled="saving || !editValue.trim() || !editFrom" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitEdit">{{ saving ? '저장 중…' : '저장' }}</button>
      </template>
    </OmModal>

    <OmModal v-model:open="cutoffOpen" title="마감시각 변경">
      <div class="space-y-3 text-xs">
        <p class="font-bold text-ink">{{ cutoffSeller?.business_name }}</p>
        <label class="block space-y-1 font-bold text-ink-muted">오늘출발 마감시각<input v-model="cutoffValue" type="time" class="h-10 w-full rounded-lg border border-line bg-surface px-2 font-normal text-ink" /></label>
        <p class="text-2xs text-ink-subtle">셀러의 기본 배송 템플릿에 저장됩니다. 지우면 뱃지 대상에서 제외됩니다.</p>
      </div>
      <template #footer>
        <button type="button" :disabled="cutoffSaving" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-danger hover:bg-danger-soft disabled:opacity-50" @click="submitCutoff(true)">지우기</button>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="cutoffOpen = false">취소</button>
        <button type="button" :disabled="cutoffSaving || !cutoffValue" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitCutoff(false)">{{ cutoffSaving ? '저장 중…' : '저장' }}</button>
      </template>
    </OmModal>
  </div>
</template>
