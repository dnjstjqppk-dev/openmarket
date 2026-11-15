<script setup lang="ts">
// P1-A13: operator audit-trail browser over GET /api/v1/admin/audit-log.
// Filtered read access to admin_audit_log (SUPER_ADMIN + PRIVACY_OFFICER).
import { ref, onMounted } from 'vue'
import { adminApi, API_BASE_URL, getAdminHeaders } from '../config'
import { userErrorMessage, useToast, OmButton, OmEmptyState } from '@olmoa/ui'

const toastApi = useToast()
const rows = ref<any[]>([])
const loading = ref(false)
const loadError = ref('')
const filters = ref({ actor_user_id: '', action: '', target_type: '', target_id: '', from: '', to: '', limit: 100 })

function queryString(csv = false) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(filters.value)) {
    if (v !== '' && v !== null) q.set(k, String(v))
  }
  if (csv) q.set('format', 'csv')
  return q.toString()
}

async function exportCsv() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/audit-log?${queryString(true)}`, { headers: getAdminHeaders() })
    if (!res.ok) throw new Error('CSV를 내려받지 못했습니다.')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'admin_audit_log.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e: any) {
    toastApi.error(userErrorMessage(e, 'CSV를 내려받지 못했습니다.'))
  }
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi(`/api/v1/admin/audit-log?${queryString()}`)
    if (!r.ok) throw new Error(r.data.error || '감사 로그를 불러오지 못했습니다.')
    rows.value = r.data.data || []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '감사 로그를 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}

function reset() {
  filters.value = { actor_user_id: '', action: '', target_type: '', target_id: '', from: '', to: '', limit: 100 }
  load()
}

onMounted(load)
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 py-6 space-y-4 text-xs">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-ink">운영자 감사 로그</h1>
        <p class="text-ink-muted mt-1">운영자 조치(action)의 불변 기록입니다. 필터로 행위자·대상별 조치 이력을 조회합니다.</p>
      </div>
      <button type="button" class="h-9 rounded-lg bg-secondary px-4 font-bold text-secondary-on hover:bg-secondary-hover" @click="exportCsv">CSV 내보내기</button>
    </div>

    <form class="bg-surface rounded-xl border border-line p-4 grid sm:grid-cols-4 gap-2" @submit.prevent="load">
      <label class="block text-ink"><span class="font-bold">행위자 ID</span>
        <input v-model="filters.actor_user_id" placeholder="u_admin_001" class="mt-1 w-full h-9 px-2 rounded-lg border border-line bg-surface text-ink font-mono" /></label>
      <label class="block text-ink"><span class="font-bold">조치(action)</span>
        <input v-model="filters.action" placeholder="COUPON_CREATE" class="mt-1 w-full h-9 px-2 rounded-lg border border-line bg-surface text-ink font-mono" /></label>
      <label class="block text-ink"><span class="font-bold">대상 유형</span>
        <input v-model="filters.target_type" placeholder="coupon" class="mt-1 w-full h-9 px-2 rounded-lg border border-line bg-surface text-ink font-mono" /></label>
      <label class="block text-ink"><span class="font-bold">대상 ID</span>
        <input v-model="filters.target_id" placeholder="cpn_…" class="mt-1 w-full h-9 px-2 rounded-lg border border-line bg-surface text-ink font-mono" /></label>
      <label class="block text-ink"><span class="font-bold">시작일</span>
        <input v-model="filters.from" type="date" class="mt-1 w-full h-9 px-2 rounded-lg border border-line bg-surface text-ink" /></label>
      <label class="block text-ink"><span class="font-bold">종료일</span>
        <input v-model="filters.to" type="date" class="mt-1 w-full h-9 px-2 rounded-lg border border-line bg-surface text-ink" /></label>
      <label class="block text-ink"><span class="font-bold">건수</span>
        <input v-model.number="filters.limit" type="number" min="1" max="500" class="mt-1 w-full h-9 px-2 rounded-lg border border-line bg-surface text-ink" /></label>
      <div class="sm:col-span-4 flex justify-end gap-2">
        <button type="button" class="h-9 px-4 rounded-lg border border-line font-bold text-ink hover:bg-surface-2" @click="reset">초기화</button>
        <button class="h-9 px-4 rounded-lg bg-secondary font-bold text-secondary-on hover:bg-secondary-hover" :disabled="loading">{{ loading ? '조회 중...' : '조회' }}</button>
      </div>
    </form>

    <div v-if="loadError" role="alert" class="p-3 rounded-lg bg-danger-soft text-danger font-bold flex flex-wrap items-center justify-between gap-2">
      <span>문제가 발생했습니다. 잠시 후 다시 시도해주세요. ({{ loadError }})</span>
      <button class="h-8 px-3 rounded-lg bg-secondary text-secondary-on font-bold hover:bg-secondary-hover" @click="load">다시 시도</button>
    </div>

    <div v-if="loading" class="p-8 text-center text-ink-subtle bg-surface rounded-xl border border-line">불러오는 중...</div>
    <OmEmptyState
      v-else-if="!rows.length && !loadError"
      compact
      title="조건에 맞는 감사 기록이 없습니다."
      description="검색 조건을 바꾸거나 잠시 후 다시 확인해 보세요."
    >
      <OmButton size="sm" @click="load">다시 불러오기</OmButton>
    </OmEmptyState>

    <div v-else class="bg-surface rounded-xl border border-line overflow-x-auto">
      <table class="w-full min-w-[760px]">
        <thead class="bg-surface-2 text-ink-muted"><tr><th class="text-left p-2">시각</th><th class="text-left p-2">행위자</th><th class="text-left p-2">역할</th><th class="text-left p-2">조치</th><th class="text-left p-2">대상</th><th class="text-left p-2">IP</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="border-t border-line-divider align-top">
            <td class="p-2 font-mono whitespace-nowrap text-ink-muted">{{ r.created_at }}</td>
            <td class="p-2 font-mono text-ink">{{ r.actor_user_id }}</td>
            <td class="p-2 text-ink">{{ r.actor_role }}</td>
            <td class="p-2 font-mono font-bold text-ink">{{ r.action }}</td>
            <td class="p-2 font-mono text-ink">{{ r.target_type }}<span v-if="r.target_id" class="text-ink-subtle">/{{ r.target_id }}</span></td>
            <td class="p-2 font-mono text-ink-subtle">{{ r.ip || '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
