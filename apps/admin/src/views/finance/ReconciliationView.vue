<script setup lang="ts">
// Reconciliation console (4-17): cross-ledger checks, cron run history and
// the trial balance. Payout confirmation lives on the settlement batch
// screen; every figure below comes from the live ledger.
import { ref, onMounted, computed } from 'vue'
import { adminApi, won } from '../../config'
import { userErrorMessage } from '@olmoa/ui'

const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'

const recon = ref<any>(null)
const trial = ref<any[]>([])
const runs = ref<any>({ runs: [], last_cron: null, alert_channel_configured: false })
const loading = ref(false)
const loadError = ref('')
const failing = computed(() => (recon.value?.checks || []).filter((c: any) => !c.ok))
const alertLabel: Record<string, string> = { NOT_NEEDED: '-', SENT: '알림 발송', FAILED: '알림 실패', NO_CHANNEL: '알림 채널 없음' }

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [a, b] = await Promise.all([adminApi('/api/v1/admin/reconciliation'), adminApi('/api/v1/admin/finance/trial-balance')])
    if (!a.ok || !b.ok) throw new Error(a.data?.error || b.data?.error || '대사 데이터를 불러오지 못했습니다.')
    recon.value = a.data.data
    trial.value = b.data.data || []
    const d = await adminApi('/api/v1/admin/finance/reconciliation-runs')
    runs.value = d.data?.data || runs.value
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '대사 데이터를 불러오지 못했습니다.')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-5 text-xs">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div><h1 class="text-xl font-bold text-ink">데이터 대사 · 시산표</h1>
        <p class="mt-1 text-ink-muted">주문·결제·환불·정산·재고·적립금을 복식부기 원장과 교차 검증합니다.</p></div>
      <button type="button" class="h-9 rounded-lg bg-secondary px-4 font-bold text-secondary-on hover:bg-secondary-hover" :disabled="loading" @click="load">{{ loading ? '검증 중...' : '다시 검증' }}</button>
    </div>
    <div v-if="loadError" role="alert" class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger bg-danger-soft p-3 font-bold text-danger">
      <span>{{ U }} ({{ loadError }})</span>
      <button type="button" class="h-8 rounded-lg bg-secondary px-3 text-secondary-on hover:bg-secondary-hover" @click="load">다시 시도</button>
    </div>

    <section v-if="recon" class="rounded-2xl border border-line bg-surface p-4">
      <div class="text-sm font-bold" :class="recon.ok ? 'text-success' : 'text-danger'" data-testid="recon-status">
        {{ recon.ok ? `전체 ${recon.checks.length}개 검증 통과` : `${failing.length}개 검증 실패` }} <span class="font-normal text-ink-subtle">({{ recon.checked_at }})</span>
      </div>
      <ul class="mt-3 grid gap-1 sm:grid-cols-2">
        <li v-for="c in recon.checks" :key="c.id" class="flex gap-2"><span :class="c.ok ? 'text-success' : 'text-danger'">{{ c.ok ? '✓' : '✗' }}</span><span class="text-ink"><b>{{ c.id }}</b> {{ c.name }}<span v-if="!c.ok" class="text-danger"> — {{ c.violation_count }}건</span></span></li>
      </ul>
      <pre v-for="c in failing" :key="c.id + 'v'" class="mt-2 overflow-x-auto rounded bg-danger-soft p-2 text-[10px] text-danger">{{ c.id }} {{ JSON.stringify(c.violations, null, 1) }}</pre>
    </section>

    <section class="rounded-2xl border border-line bg-surface p-4" data-testid="recon-runs">
      <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-sm font-bold text-ink">주기 대사 이력 (Cron 1시간 간격)</h2>
        <span :class="runs.alert_channel_configured ? 'text-success' : 'text-warning'" class="font-bold">
          {{ runs.alert_channel_configured ? '실패 알림 채널 설정됨' : '실패 알림 채널 미설정 (ALERT_WEBHOOK_URL) — 로그로만 기록됩니다' }}
        </span>
      </div>
      <p class="mb-2" :class="!runs.last_cron ? 'text-warning' : runs.last_cron.ok ? 'text-success' : 'text-danger'">
        <template v-if="runs.last_cron">최근 자동 대사: {{ runs.last_cron.created_at }} UTC · {{ runs.last_cron.ok ? '통과' : `실패 ${runs.last_cron.failed_checks.length}건` }}</template>
        <template v-else>아직 자동 대사가 실행되지 않았습니다. Worker Cron Trigger 설정을 확인하세요.</template>
      </p>
      <div class="overflow-x-auto"><table class="w-full min-w-[520px]"><thead class="text-ink-muted"><tr><th class="p-1 text-left">시각(UTC)</th><th class="p-1 text-left">실행</th><th class="p-1 text-left">결과</th><th class="p-1 text-left">실패 항목</th><th class="p-1 text-left">알림</th></tr></thead>
        <tbody><tr v-for="r in runs.runs.slice(0, 20)" :key="r.id" class="border-t border-line-divider">
          <td class="om-num p-1 text-ink-muted">{{ r.created_at }}</td><td class="p-1 text-ink">{{ r.trigger_source === 'CRON' ? '자동' : '수동' }}</td>
          <td class="p-1 font-bold" :class="r.ok ? 'text-success' : 'text-danger'">{{ r.ok ? '통과' : '실패' }}</td>
          <td class="p-1 text-ink-muted">{{ r.failed_checks.map((f: any) => `${f.id}(${f.violation_count})`).join(', ') || '-' }}</td>
          <td class="p-1 text-ink-muted">{{ alertLabel[r.alert_status] || r.alert_status }}</td>
        </tr></tbody></table></div>
    </section>

    <section class="overflow-x-auto rounded-2xl border border-line bg-surface p-4">
      <h2 class="mb-2 text-sm font-bold text-ink">시산표 (사업자별 계정 잔액)</h2>
      <table class="w-full min-w-[600px]"><thead class="text-ink-muted"><tr><th class="p-1 text-left">사업자</th><th class="p-1 text-left">계정</th><th class="p-1 text-right">차변</th><th class="p-1 text-right">대변</th><th class="p-1 text-right">잔액(차-대)</th></tr></thead>
        <tbody><tr v-for="r in trial" :key="(r.entity_id || '-') + r.account_code" class="border-t border-line-divider">
          <td class="om-num p-1 text-ink-muted">{{ r.entity_id || '(개시잔액)' }}</td><td class="p-1 text-ink">{{ r.account_code }}</td>
          <td class="om-num p-1 text-right text-ink">{{ won(r.debit) }}</td><td class="om-num p-1 text-right text-ink">{{ won(r.credit) }}</td><td class="om-num p-1 text-right font-bold text-ink">{{ won(r.balance) }}</td>
        </tr></tbody></table>
    </section>
  </div>
</template>
