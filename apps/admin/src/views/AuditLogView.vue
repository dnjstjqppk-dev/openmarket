<script setup lang="ts">
// P1-A13: operator audit-trail browser over GET /api/v1/admin/audit-log.
// Filtered read access to admin_audit_log (SUPER_ADMIN + PRIVACY_OFFICER).
import { ref, onMounted } from 'vue'
import { adminApi } from '../config'

const rows = ref<any[]>([])
const loading = ref(false)
const loadError = ref('')
const filters = ref({ actor_user_id: '', action: '', target_type: '', target_id: '', limit: 100 })

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(filters.value)) {
      if (v !== '' && v !== null) q.set(k, String(v))
    }
    const r = await adminApi(`/api/v1/admin/audit-log?${q.toString()}`)
    if (!r.ok) throw new Error(r.data.error || '감사 로그를 불러오지 못했습니다.')
    rows.value = r.data.data || []
  } catch (e: any) {
    loadError.value = e?.message || '감사 로그를 불러오지 못했습니다.'
  } finally {
    loading.value = false
  }
}

function reset() {
  filters.value = { actor_user_id: '', action: '', target_type: '', target_id: '', limit: 100 }
  load()
}

onMounted(load)
</script>

<template>
  <div class="max-w-7xl mx-auto px-4 py-6 space-y-4 text-xs">
    <div>
      <h1 class="text-xl font-black">운영자 감사 로그</h1>
      <p class="text-slate-500 mt-1">운영자 조치(action)의 불변 기록입니다. 필터로 행위자·대상별 조치 이력을 조회합니다.</p>
    </div>

    <form class="bg-white rounded-xl border border-slate-200 p-4 grid sm:grid-cols-5 gap-2" @submit.prevent="load">
      <label class="block"><span class="font-bold">행위자 ID</span>
        <input v-model="filters.actor_user_id" placeholder="u_admin_001" class="mt-1 w-full h-9 px-2 rounded border border-slate-300 font-mono" /></label>
      <label class="block"><span class="font-bold">조치(action)</span>
        <input v-model="filters.action" placeholder="COUPON_CREATE" class="mt-1 w-full h-9 px-2 rounded border border-slate-300 font-mono" /></label>
      <label class="block"><span class="font-bold">대상 유형</span>
        <input v-model="filters.target_type" placeholder="coupon" class="mt-1 w-full h-9 px-2 rounded border border-slate-300 font-mono" /></label>
      <label class="block"><span class="font-bold">대상 ID</span>
        <input v-model="filters.target_id" placeholder="cpn_…" class="mt-1 w-full h-9 px-2 rounded border border-slate-300 font-mono" /></label>
      <label class="block"><span class="font-bold">건수</span>
        <input v-model.number="filters.limit" type="number" min="1" max="500" class="mt-1 w-full h-9 px-2 rounded border border-slate-300" /></label>
      <div class="sm:col-span-5 flex justify-end gap-2">
        <button type="button" class="h-9 px-4 rounded-lg border font-bold" @click="reset">초기화</button>
        <button class="h-9 px-4 rounded-lg bg-slate-900 text-white font-bold" :disabled="loading">{{ loading ? '조회 중...' : '조회' }}</button>
      </div>
    </form>

    <div v-if="loadError" role="alert" class="p-3 rounded-lg bg-red-50 text-red-700 font-bold flex flex-wrap items-center justify-between gap-2">
      <span>{{ loadError }}</span>
      <button class="h-8 px-3 rounded-lg bg-red-600 text-white font-bold" @click="load">다시 시도</button>
    </div>

    <div v-if="loading" class="p-8 text-center text-slate-400 bg-white rounded-xl border">불러오는 중...</div>
    <div v-else-if="!rows.length && !loadError" class="p-8 text-center text-slate-400 bg-white rounded-xl border">조건에 맞는 감사 기록이 없습니다.</div>

    <div v-else class="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <table class="w-full min-w-[760px]">
        <thead class="bg-slate-50 text-slate-500"><tr><th class="text-left p-2">시각</th><th class="text-left p-2">행위자</th><th class="text-left p-2">역할</th><th class="text-left p-2">조치</th><th class="text-left p-2">대상</th><th class="text-left p-2">IP</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id" class="border-t align-top">
            <td class="p-2 font-mono whitespace-nowrap">{{ r.created_at }}</td>
            <td class="p-2 font-mono">{{ r.actor_user_id }}</td>
            <td class="p-2">{{ r.actor_role }}</td>
            <td class="p-2 font-mono font-bold">{{ r.action }}</td>
            <td class="p-2 font-mono">{{ r.target_type }}<span v-if="r.target_id" class="text-slate-400">/{{ r.target_id }}</span></td>
            <td class="p-2 font-mono text-slate-400">{{ r.ip || '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
