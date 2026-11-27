<script setup lang="ts">
// Member console (4-20): identity/phone search, joined period, status and
// role filters, password resets, withdrawal history and reasoned CSV export.
import { ref, onMounted, watch } from 'vue'
import { adminApi, API_BASE_URL, getAdminHeaders } from '../config'
import { userErrorMessage, useToast, OmDataTable, OmStatusTabs, OmModal, OmSkeleton } from '@olmoa/ui'

const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const PER_PAGE = 50
const STATUS_LABEL: Record<string, string> = { ACTIVE: '활성', INACTIVE: '비활성', WITHDRAWN: '탈퇴' }

const tab = ref('')
const role = ref('')
const q = ref('')
const from = ref('')
const to = ref('')
const rows = ref<any[]>([])
const page = ref(1)
const total = ref(0)
const loading = ref(true)
const loadError = ref('')
const exportOpen = ref(false)
const exportReason = ref('')
const exporting = ref(false)
const resetTarget = ref<any>(null)
const resetOpen = ref(false)
const resetPw = ref('')
const resetPw2 = ref('')
const resetBusy = ref(false)
const resetError = ref('')
const resetDone = ref(false)

const columns = [
  { key: 'member', label: '회원', primary: true },
  { key: 'contact', label: '연락처', mobileHidden: true },
  { key: 'orders', label: '주문 수', align: 'right' as const },
  { key: 'status', label: '상태' },
  { key: 'date', label: '가입일', mobileHidden: true }
]

function query(csv = false) {
  const params = new URLSearchParams({ page: String(page.value), per_page: String(PER_PAGE) })
  if (tab.value) params.set('status', tab.value)
  if (role.value) params.set('role', role.value)
  if (q.value.trim()) params.set('q', q.value.trim())
  if (from.value) params.set('from', from.value)
  if (to.value) params.set('to', to.value)
  if (csv) params.set('format', 'csv')
  return params.toString()
}

async function loadUsers() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi(`/api/v1/admin/users?${query()}`)
    if (!r.ok) throw new Error(r.data.error || '회원 목록을 불러오지 못했습니다.')
    rows.value = Array.isArray(r.data.data) ? r.data.data : []
    total.value = r.data.pagination?.total ?? rows.value.length
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}
watch(page, () => void loadUsers())
function setTab(v: string) { tab.value = v; page.value = 1; void loadUsers() }
const statusOf = (u: any) => (u.withdrawn_at ? 'WITHDRAWN' : Number(u.is_active) === 1 ? 'ACTIVE' : 'INACTIVE')

async function exportCsv() {
  if (!exportReason.value.trim()) { toastApi.error('내려받기 사유를 입력해 주세요.'); return }
  exporting.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/users?${query(true)}&reason=${encodeURIComponent(exportReason.value.trim())}`, { headers: getAdminHeaders() })
    if (!res.ok) throw new Error('CSV를 내려받지 못했습니다.')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'admin_users.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    exportOpen.value = false
    exportReason.value = ''
    toastApi.success('회원 목록을 내려받았습니다. 사유가 접속 기록에 남았습니다.')
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, 'CSV를 내려받지 못했습니다.'))
  } finally {
    exporting.value = false
  }
}

function openReset(u: any) {
  resetTarget.value = u
  resetPw.value = ''
  resetPw2.value = ''
  resetError.value = ''
  resetDone.value = false
  resetOpen.value = true
}

async function submitReset() {
  if (!resetTarget.value || resetBusy.value) return
  if (resetPw.value !== resetPw2.value) {
    resetError.value = '새 비밀번호가 일치하지 않습니다.'
    return
  }
  resetBusy.value = true
  resetError.value = ''
  try {
    const r = await adminApi(`/api/v1/admin/users/${resetTarget.value.id}/reset-password`, {
      method: 'POST', json: { new_password: resetPw.value }
    })
    if (!r.ok) throw new Error(r.data.error || '재설정하지 못했습니다. 잠시 후 다시 시도해주세요.')
    resetDone.value = true
  } catch (e: any) {
    resetError.value = userErrorMessage(e, '재설정에 실패했습니다.')
  } finally {
    resetBusy.value = false
  }
}

onMounted(() => void loadUsers())
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-ink">회원 관리</h1>
        <p class="mt-1 text-xs text-ink-muted">이메일·이름·전화로 검색합니다. 내려받기에는 사유 입력이 필요하며 접속 기록에 남습니다.</p>
      </div>
      <button type="button" class="h-9 rounded-lg bg-secondary px-4 text-xs font-bold text-secondary-on hover:bg-secondary-hover" @click="exportOpen = true">CSV 내보내기</button>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <OmStatusTabs
        v-model="tab"
        :tabs="[
          { value: '', label: '전체' },
          { value: 'ACTIVE', label: '활성' },
          { value: 'INACTIVE', label: '비활성' },
          { value: 'WITHDRAWN', label: '탈퇴 이력' }
        ]"
        @update:model-value="setTab"
      />
      <select v-model="role" aria-label="권한" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="page = 1; loadUsers()">
        <option value="">전체 권한</option>
        <option value="ROLE_CUSTOMER">구매자</option>
        <option value="ROLE_PARTNER">판매자</option>
        <option value="ROLE_ADMIN">운영자</option>
      </select>
      <input v-model="from" type="date" aria-label="가입 시작일" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="page = 1; loadUsers()" />
      <span class="text-xs text-ink-subtle">~</span>
      <input v-model="to" type="date" aria-label="가입 종료일" class="h-9 rounded-lg border border-line bg-surface px-2 text-xs text-ink" @change="page = 1; loadUsers()" />
      <input v-model="q" type="search" placeholder="이메일·이름·전화" aria-label="회원 검색" class="h-9 w-56 rounded-lg border border-line bg-surface px-3 text-xs text-ink" @keyup.enter="page = 1; loadUsers()" />
      <button type="button" class="h-9 rounded-lg bg-secondary px-4 text-xs font-bold text-secondary-on hover:bg-secondary-hover" @click="page = 1; loadUsers()">검색</button>
    </div>

    <div v-if="loading && !rows.length" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="8" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="loadUsers">다시 불러오기</button>
    </div>
    <div v-else>
      <OmDataTable
        :columns="columns"
        :rows="rows"
        row-key="id"
        v-model:page="page"
        :total="total"
        :page-size="PER_PAGE"
        :loading="loading"
        empty-title="조건에 맞는 회원이 없습니다."
        empty-description="검색 조건을 바꾸거나 잠시 후 다시 확인해 보세요."
      >
        <template #cell-member="{ row }">
          <div class="min-w-0">
            <p class="truncate font-bold text-ink">{{ row.full_name }}</p>
            <p class="truncate font-mono text-2xs text-ink-subtle">{{ row.email }}</p>
          </div>
        </template>
        <template #cell-contact="{ row }"><span class="om-num text-ink-muted">{{ row.phone }}</span></template>
        <template #cell-orders="{ row }"><span class="om-num text-ink-muted">{{ row.order_count || 0 }}</span></template>
        <template #cell-status="{ row }">
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold whitespace-nowrap" :class="statusOf(row) === 'ACTIVE' ? 'bg-success-soft text-success' : statusOf(row) === 'WITHDRAWN' ? 'bg-surface-3 text-ink-muted' : 'bg-warning-soft text-warning'">{{ STATUS_LABEL[statusOf(row)] }}</span>
        </template>
        <template #cell-date="{ row }"><span class="om-num text-ink-muted">{{ String(row.created_at || '').slice(0, 10) }}</span></template>
        <template #actions="{ row }">
          <button v-if="row.role !== 'ROLE_ADMIN' && statusOf(row) !== 'WITHDRAWN'" type="button" class="rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2" @click="openReset(row)">비밀번호 재설정</button>
          <span v-else class="text-2xs text-ink-subtle">{{ statusOf(row) === 'WITHDRAWN' ? '탈퇴 계정' : '보안 절차' }}</span>
        </template>
      </OmDataTable>
      <OmEmptyState v-if="!loading && !rows.length" title="조건에 맞는 회원이 없습니다." description="검색 조건을 바꾸거나 잠시 후 다시 확인해 보세요." compact />
    </div>

    <OmModal v-model:open="exportOpen" title="CSV 내보내기">
      <div class="space-y-3 text-xs">
        <p class="text-ink-muted">개인정보 내려받기 사유를 입력해 주세요. 사유는 접속 기록에 함께 남습니다.</p>
        <input v-model="exportReason" maxlength="200" placeholder="예: CS 민원 처리" aria-label="내려받기 사유" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" />
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="exportOpen = false">취소</button>
        <button type="button" :disabled="exporting || !exportReason.trim()" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="exportCsv">{{ exporting ? '내려받는 중…' : '내려받기' }}</button>
      </template>
    </OmModal>

    <OmModal v-model:open="resetOpen" title="비밀번호 재설정">
      <div v-if="resetTarget" class="space-y-2 text-xs">
        <p class="text-ink-muted">{{ resetTarget.email }} · 모든 세션 로그아웃 + 잠금 해제</p>
        <template v-if="!resetDone">
          <input v-model="resetPw" type="password" autocomplete="new-password" placeholder="새 비밀번호 (10자+, 3종류 조합)" aria-label="새 비밀번호" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" />
          <input v-model="resetPw2" type="password" autocomplete="new-password" placeholder="새 비밀번호 확인" aria-label="새 비밀번호 확인" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" />
          <p v-if="resetError" role="alert" class="font-bold text-danger">{{ resetError }}</p>
        </template>
        <p v-else class="font-bold text-success">재설정되었습니다. 새 비밀번호를 안전한 경로로 전달하고, 로그인 후 변경을 안내해 주세요.</p>
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="resetOpen = false">{{ resetDone ? '닫기' : '취소' }}</button>
        <button v-if="!resetDone" type="button" :disabled="resetBusy" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitReset">{{ resetBusy ? '처리 중…' : '재설정' }}</button>
      </template>
    </OmModal>
  </div>
</template>
