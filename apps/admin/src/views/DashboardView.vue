<script setup lang="ts">
// Admin operations dashboard (4-12): today-vs-yesterday compare cards,
// three waiting queues (5 rows each), 30-day GMV/order lines and top
// category bars. Every card renders its own load failure (never a bare 0).
// Sample-QC and IPR desks stay here until 4-20 gives them a home; the
// dispute tribunal moved to the claims screens (4-16).
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { API_BASE_URL, getAdminHeaders } from '../config'
import { userErrorMessage, useConfirm, OmEmptyState, OmSkeleton } from '@olmoa/ui'

const { confirm: askConfirm } = useConfirm()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'

interface Compare { today: number; yesterday: number }
const compare = ref<any>(null)
const queues = ref<any>({ partner_applications: [], product_reviews: [], disputes: [] })
const series30 = ref<any[]>([])
const catSales = ref<any[]>([])
const fdsRules = ref<any[]>([])
const sampleQcList = ref<any[]>([])
const iprReports = ref<any[]>([])

const loading = ref(true)
const toastMsg = ref('')
const failedSources = ref<string[]>([])
const loadError = ref('')

const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`
const num = (v: any) => (Number(v) || 0).toLocaleString('ko-KR')
const dashFailed = computed(() => failedSources.value.includes('대시보드'))

const deltaText = (c: Compare | null | undefined) => {
  if (!c) return '-'
  const d = c.today - c.yesterday
  if (d === 0) return '어제와 같음'
  return `${d > 0 ? '▲' : '▼'} ${num(Math.abs(d))}`
}
const deltaUp = (c: Compare | null | undefined) => !!c && c.today > c.yesterday

async function fetchSource(label: string, path: string): Promise<any> {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { headers: getAdminHeaders() })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || (data && data.success === false)) {
      failedSources.value.push(label)
      return {}
    }
    return data
  } catch {
    failedSources.value.push(label)
    return {}
  }
}

async function loadDashboard() {
  loading.value = true
  loadError.value = ''
  failedSources.value = []
  try {
    const [json, fdsJson, qcRes, iprRes] = await Promise.all([
      fetchSource('대시보드', '/api/v1/admin/dashboard'),
      fetchSource('FDS', '/api/v1/admin/fds/overview'),
      fetchSource('샘플QC', '/api/v1/admin/sample-qc'),
      fetchSource('IPR', '/api/v1/admin/ipr-reports')
    ])
    if (json?.success) {
      compare.value = json.compare || null
      queues.value = json.queues || queues.value
      series30.value = Array.isArray(json.series30) ? json.series30 : []
      catSales.value = Array.isArray(json.category_sales) ? json.category_sales : []
    }
    fdsRules.value = Array.isArray(fdsJson?.data?.active_rules) ? fdsJson.data.active_rules : []
    sampleQcList.value = Array.isArray(qcRes?.data) ? qcRes.data : []
    iprReports.value = Array.isArray(iprRes?.data) ? iprRes.data : []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '지표를 불러오지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.')
  } finally {
    if (failedSources.value.length && !loadError.value) {
      loadError.value = `일부 지표 집계 실패 (${failedSources.value.join(', ')}) — 실패한 카드는 값을 표시하지 않습니다.`
    }
    loading.value = false
  }
}

// ---- 30-day lines (hand-rolled SVG, each series on its own scale) ----
const W = 600
const H = 180
const PAD = 8
const gmvMax = computed(() => Math.max(1, ...series30.value.map((s: any) => Number(s.gmv) || 0)))
const ordMax = computed(() => Math.max(1, ...series30.value.map((s: any) => Number(s.orders) || 0)))
const xAt = (i: number) => {
  const n = Math.max(1, series30.value.length - 1)
  return PAD + (i / n) * (W - PAD * 2)
}
const yAt = (v: number, max: number) => H - PAD - (v / max) * (H - PAD * 2 - 14)
const gmvPoints = computed(() => series30.value.map((s: any, i: number) => `${xAt(i).toFixed(1)},${yAt(Number(s.gmv) || 0, gmvMax.value).toFixed(1)}`).join(' '))
const ordPoints = computed(() => series30.value.map((s: any, i: number) => `${xAt(i).toFixed(1)},${yAt(Number(s.orders) || 0, ordMax.value).toFixed(1)}`).join(' '))
const xTicks = computed(() => series30.value.filter((_: any, i: number) => i % 5 === 0 || i === series30.value.length - 1))
const catMax = computed(() => Math.max(1, ...catSales.value.map((s: any) => Number(s.gmv) || 0)))

// ---- sample QC decision modal (prompt-free notes) ----
const qcOpen = ref(false)
const qcTarget = ref<any>(null)
const qcDecision = ref<'APPROVED' | 'REJECTED'>('APPROVED')
const qcNotes = ref('')
const qcBusy = ref(false)
function openQc(qc: any, decision: 'APPROVED' | 'REJECTED') {
  qcTarget.value = qc
  qcDecision.value = decision
  qcNotes.value = ''
  qcOpen.value = true
}
async function submitQc() {
  if (!qcTarget.value || !qcNotes.value.trim() || qcBusy.value) return
  if (qcDecision.value === 'REJECTED') {
    const ok = await askConfirm({ title: '샘플 반려', body: `실물 샘플(${qcTarget.value.id})을 반려합니다.`, danger: true })
    if (!ok) return
  }
  qcBusy.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/sample-qc/${qcTarget.value.id}/inspect`, {
      method: 'POST', headers: getAdminHeaders(),
      body: JSON.stringify({ decision: qcDecision.value, inspector_notes: qcNotes.value.trim() })
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || '검수 처리에 실패했습니다.')
    qcTarget.value.status = qcDecision.value
    toastMsg.value = `실물 샘플(${qcTarget.value.id})이 [${qcDecision.value === 'APPROVED' ? '합격 승인' : '반려 처리'}] 되었습니다.`
    setTimeout(() => { toastMsg.value = '' }, 3000)
    qcOpen.value = false
  } catch (e: any) {
    toastMsg.value = userErrorMessage(e, '검수 처리에 실패했습니다.')
    setTimeout(() => { toastMsg.value = '' }, 4000)
  } finally {
    qcBusy.value = false
  }
}

function fastTrackTakedown(iprId: string) {
  // There is no takedown endpoint yet. Products are stopped from 상품 관리 (상태 변경) after the operator reviews the report.
  toastMsg.value = `IPR 신고(${iprId}): 즉시 차단 기능은 아직 없습니다. 상품 관리에서 해당 상품을 직접 판매중지해 주세요.`
  setTimeout(() => { toastMsg.value = '' }, 5000)
}

onMounted(loadDashboard)
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col justify-between gap-3 border-b border-line pb-4 sm:flex-row sm:items-center">
      <div>
        <h1 class="text-xl font-bold text-ink">운영 대시보드</h1>
        <p class="mt-0.5 text-xs text-ink-muted">오늘·어제 대비 지표, 대기 목록, 30일 추이 (한국 시간 기준)</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <span v-if="loading" class="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs font-bold text-ink-muted">상태 확인 중…</span>
        <template v-else>
          <span v-if="!dashFailed" class="flex items-center gap-1.5 rounded-full border border-line bg-success-soft px-3 py-1 text-xs font-bold text-success">
            <span class="h-2 w-2 animate-pulse rounded-full bg-success"></span>
            지표 집계 정상
          </span>
          <span v-else class="rounded-full border border-line bg-danger-soft px-3 py-1 text-xs font-bold text-danger">지표 집계 실패</span>
        </template>
      </div>
    </div>

    <div v-if="toastMsg" role="status" class="rounded-xl bg-secondary p-3.5 text-xs font-bold text-secondary-on">{{ toastMsg }}</div>

    <div v-if="loadError" role="alert" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-danger-soft p-3.5 text-xs font-bold text-danger">
      <span>{{ U }} ({{ loadError }})</span>
      <button type="button" class="rounded-lg bg-secondary px-3 py-1.5 text-secondary-on hover:bg-secondary-hover" @click="loadDashboard">다시 시도</button>
    </div>

    <div v-if="loading" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="8" />
    </div>

    <div v-else class="space-y-6">
      <div class="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div class="rounded-2xl border border-line bg-surface p-5">
          <p class="text-ink-muted">오늘 결제금액</p>
          <template v-if="!dashFailed && compare">
            <p class="om-num mt-1 text-2xl font-bold text-ink">{{ won(compare.gmv.today) }}</p>
            <p class="mt-1 font-bold" :class="deltaUp(compare.gmv) ? 'text-success' : 'text-ink-muted'">{{ deltaText(compare.gmv) }} · 어제 {{ won(compare.gmv.yesterday) }}</p>
          </template>
          <p v-else class="mt-1 font-bold text-danger">불러오지 못함 <button type="button" class="underline" @click="loadDashboard">다시 시도</button></p>
        </div>
        <div class="rounded-2xl border border-line bg-surface p-5">
          <p class="text-ink-muted">오늘 주문 수</p>
          <template v-if="!dashFailed && compare">
            <p class="om-num mt-1 text-2xl font-bold text-ink">{{ num(compare.orders.today) }}건</p>
            <p class="mt-1 font-bold" :class="deltaUp(compare.orders) ? 'text-success' : 'text-ink-muted'">{{ deltaText(compare.orders) }} · 어제 {{ num(compare.orders.yesterday) }}건</p>
          </template>
          <p v-else class="mt-1 font-bold text-danger">불러오지 못함 <button type="button" class="underline" @click="loadDashboard">다시 시도</button></p>
        </div>
        <div class="rounded-2xl border border-line bg-surface p-5">
          <p class="text-ink-muted">오늘 신규 회원</p>
          <template v-if="!dashFailed && compare">
            <p class="om-num mt-1 text-2xl font-bold text-ink">{{ num(compare.users.today) }}명</p>
            <p class="mt-1 font-bold" :class="deltaUp(compare.users) ? 'text-success' : 'text-ink-muted'">{{ deltaText(compare.users) }} · 어제 {{ num(compare.users.yesterday) }}명</p>
          </template>
          <p v-else class="mt-1 font-bold text-danger">불러오지 못함 <button type="button" class="underline" @click="loadDashboard">다시 시도</button></p>
        </div>
        <div class="rounded-2xl border border-line bg-surface p-5">
          <p class="text-ink-muted">오늘 입점 신청</p>
          <template v-if="!dashFailed && compare">
            <p class="om-num mt-1 text-2xl font-bold text-ink">{{ num(compare.applications.today) }}건</p>
            <p class="mt-1 font-bold" :class="deltaUp(compare.applications) ? 'text-success' : 'text-ink-muted'">{{ deltaText(compare.applications) }} · 어제 {{ num(compare.applications.yesterday) }}건</p>
          </template>
          <p v-else class="mt-1 font-bold text-danger">불러오지 못함 <button type="button" class="underline" @click="loadDashboard">다시 시도</button></p>
        </div>
        <div class="rounded-2xl border border-line bg-surface p-5">
          <p class="text-ink-muted">검수 대기 상품</p>
          <template v-if="!dashFailed && compare">
            <p class="om-num mt-1 text-2xl font-bold text-ink">{{ num(compare.review_queue) }}건</p>
            <p class="mt-1 font-bold text-ink-muted"><RouterLink to="/products" class="underline">검수 대기열로 이동</RouterLink></p>
          </template>
          <p v-else class="mt-1 font-bold text-danger">불러오지 못함 <button type="button" class="underline" @click="loadDashboard">다시 시도</button></p>
        </div>
        <div class="rounded-2xl border border-line bg-surface p-5">
          <p class="text-ink-muted">미처리 클레임</p>
          <template v-if="!dashFailed && compare">
            <p class="om-num mt-1 text-2xl font-bold text-ink">{{ num(compare.open_claims) }}건</p>
            <p class="mt-1 font-bold text-ink-muted">판매자 처리 대기</p>
          </template>
          <p v-else class="mt-1 font-bold text-danger">불러오지 못함 <button type="button" class="underline" @click="loadDashboard">다시 시도</button></p>
        </div>
        <div class="rounded-2xl border border-line bg-surface p-5">
          <p class="text-ink-muted">분쟁</p>
          <template v-if="!dashFailed && compare">
            <p class="om-num mt-1 text-2xl font-bold text-ink">{{ num(compare.open_disputes) }}건</p>
            <p class="mt-1 font-bold text-ink-muted">진행 중 반품·클레임</p>
          </template>
          <p v-else class="mt-1 font-bold text-danger">불러오지 못함 <button type="button" class="underline" @click="loadDashboard">다시 시도</button></p>
        </div>
        <div class="rounded-2xl border border-line bg-surface p-5">
          <p class="text-ink-muted">지급 승인 대기액</p>
          <template v-if="!dashFailed && compare">
            <p class="om-num mt-1 text-2xl font-bold text-ink">{{ won(compare.payout_pending_amount) }}</p>
            <p class="mt-1 font-bold text-ink-muted">출금 신청 승인 대기</p>
          </template>
          <p v-else class="mt-1 font-bold text-danger">불러오지 못함 <button type="button" class="underline" @click="loadDashboard">다시 시도</button></p>
        </div>
        <div class="rounded-2xl border border-line bg-surface p-5">
          <p class="text-ink-muted">이상거래 검토</p>
          <template v-if="!dashFailed && compare">
            <p class="om-num mt-1 text-2xl font-bold text-ink">{{ num(compare.fds_reviews) }}건</p>
            <p class="mt-1 font-bold text-ink-muted">FDS 검토 대상 주문</p>
          </template>
          <p v-else class="mt-1 font-bold text-danger">불러오지 못함 <button type="button" class="underline" @click="loadDashboard">다시 시도</button></p>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section class="space-y-2 rounded-2xl border border-line bg-surface p-5" aria-label="입점 심사 대기">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-bold text-ink">입점 심사 대기</h2>
            <RouterLink to="/partner-applications" class="text-xs font-bold text-primary hover:underline">전체 보기</RouterLink>
          </div>
          <OmEmptyState v-if="!queues.partner_applications.length" compact title="대기 중인 입점 심사가 없습니다." description="새 신청이 들어오면 이곳에 표시됩니다." />
          <ul v-else class="divide-y divide-line-divider text-xs">
            <li v-for="q in queues.partner_applications" :key="q.id" class="py-2">
              <p class="truncate font-bold text-ink">{{ q.business_name }}</p>
              <p class="om-num mt-0.5 text-ink-subtle">{{ q.business_reg_number }} · {{ String(q.created_at || '').slice(0, 10) }}</p>
            </li>
          </ul>
        </section>
        <section class="space-y-2 rounded-2xl border border-line bg-surface p-5" aria-label="상품 검수 대기">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-bold text-ink">상품 검수 대기</h2>
            <RouterLink to="/products" class="text-xs font-bold text-primary hover:underline">전체 보기</RouterLink>
          </div>
          <OmEmptyState v-if="!queues.product_reviews.length" compact title="대기 중인 상품 검수가 없습니다." description="새 검수 요청이 들어오면 이곳에 표시됩니다." />
          <ul v-else class="divide-y divide-line-divider text-xs">
            <li v-for="q in queues.product_reviews" :key="q.id" class="py-2">
              <p class="truncate font-bold text-ink">{{ q.title }}</p>
              <p class="mt-0.5 text-ink-subtle">{{ q.business_name || q.partner_id }} · {{ String(q.created_at || '').slice(0, 10) }}</p>
            </li>
          </ul>
        </section>
        <section class="space-y-2 rounded-2xl border border-line bg-surface p-5" aria-label="분쟁 대기">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-bold text-ink">분쟁 대기</h2>
            <RouterLink to="/orders" class="text-xs font-bold text-primary hover:underline">주문에서 확인</RouterLink>
          </div>
          <OmEmptyState v-if="!queues.disputes.length" compact title="대기 중인 분쟁이 없습니다." description="새 분쟁이 접수되면 이곳에 표시됩니다." />
          <ul v-else class="divide-y divide-line-divider text-xs">
            <li v-for="q in queues.disputes" :key="q.id" class="py-2">
              <p class="truncate font-bold text-ink">{{ q.order_no || q.order_id }}</p>
              <p class="om-num mt-0.5 text-ink-subtle">{{ q.status }} · {{ won(q.refund_amount) }} · {{ q.age_days }}일 경과</p>
            </li>
          </ul>
        </section>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="30일 추이">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-sm font-bold text-ink">30일 결제금액·주문 수</h2>
            <div class="flex items-center gap-3 text-2xs font-bold text-ink-muted">
              <span class="flex items-center gap-1"><span class="h-0.5 w-4 bg-primary"></span>결제금액</span>
              <span class="flex items-center gap-1"><span class="h-0.5 w-4 bg-success"></span>주문 수</span>
            </div>
          </div>
          <p v-if="!series30.length" class="text-xs text-ink-muted">최근 30일 결제 기록이 없습니다.</p>
          <svg v-else :viewBox="`0 0 ${W} ${H}`" class="w-full" role="img" aria-label="30일 결제 추이 그래프">
            <line :x1="PAD" :x2="W - PAD" :y1="H - PAD - 14" :y2="H - PAD - 14" class="stroke-line" stroke-width="1" />
            <polyline :points="gmvPoints" fill="none" class="stroke-primary" stroke-width="2" />
            <polyline :points="ordPoints" fill="none" class="stroke-success" stroke-width="2" />
            <g v-for="(s, i) in xTicks" :key="s.day">
              <text :x="xAt(series30.indexOf(s))" :y="H - 2" text-anchor="middle" font-size="9" class="fill-ink-subtle">{{ String(s.day).slice(5) }}</text>
            </g>
          </svg>
        </section>
        <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="카테고리별 매출">
          <h2 class="text-sm font-bold text-ink">카테고리별 매출 (최근 30일)</h2>
          <p v-if="!catSales.length" class="text-xs text-ink-muted">최근 30일 결제 기록이 없습니다.</p>
          <ul v-else class="space-y-2">
            <li v-for="c in catSales" :key="c.category">
              <div class="flex items-center justify-between gap-2 text-xs">
                <span class="truncate font-bold text-ink">{{ c.category }}</span>
                <span class="om-num shrink-0 text-ink-muted">{{ won(c.gmv) }}</span>
              </div>
              <div class="mt-1 h-2 overflow-hidden rounded-full bg-surface-3">
                <div class="h-full rounded-full bg-primary" :style="{ width: `${Math.max(2, (Number(c.gmv) / catMax) * 100)}%` }"></div>
              </div>
            </li>
          </ul>
        </section>
      </div>

      <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="FDS 규칙 현황">
        <h2 class="text-sm font-bold text-ink">FDS 탐지 규칙</h2>
        <OmEmptyState v-if="fdsRules.length === 0" compact title="표시할 FDS 규칙이 없습니다." description="규칙이 등록되면 이곳에 표시됩니다." />
        <div v-else class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="border-b border-line bg-surface-2 text-2xs uppercase text-ink-muted">
              <tr><th class="p-2">룰 코드</th><th class="p-2">탐지 정책 명칭</th><th class="p-2">위험도</th><th class="p-2 text-right">24h 차단/감지</th></tr>
            </thead>
            <tbody class="divide-y divide-line-divider">
              <tr v-for="r in fdsRules" :key="r.id">
                <td class="p-2 font-mono text-2xs font-bold text-ink-muted">{{ r.code }}</td>
                <td class="p-2 font-medium text-ink">{{ r.name }}</td>
                <td class="p-2">
                  <span class="rounded px-2 py-0.5 text-2xs font-bold" :class="r.severity === 'CRITICAL' ? 'bg-danger-soft text-danger' : r.severity === 'HIGH' ? 'bg-warning-soft text-warning' : 'bg-info-soft text-info'">{{ r.severity }}</span>
                </td>
                <td class="om-num p-2 text-right font-bold text-ink">{{ r.hit_count_24h ?? '미집계' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="grid grid-cols-1 gap-4 text-xs lg:grid-cols-2">
        <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="샘플 검수">
          <div class="border-b border-line-divider pb-3">
            <h2 class="text-sm font-bold text-ink">공장 실물 샘플 검수 <span class="font-mono text-2xs text-ink-muted">대기 {{ sampleQcList.filter((s: any) => s.status === 'IN_INSPECTION').length }}건</span></h2>
            <p class="mt-0.5 text-2xs text-ink-muted">M2C 직결 셀러 대량 입고 전 실물 시제품 품질 합격 여부를 판정합니다.</p>
          </div>
          <OmEmptyState v-if="sampleQcList.length === 0" compact title="검수 대기 중인 샘플이 없습니다." description="새 검수 요청이 들어오면 이곳에 표시됩니다." />
          <div v-else class="divide-y divide-line-divider">
            <div v-for="qc in sampleQcList" :key="qc.id" class="flex items-center justify-between gap-3 py-3">
              <div>
                <div class="font-bold text-ink">{{ qc.product_title }}</div>
                <div class="font-mono text-2xs text-ink-muted">[{{ qc.business_name }}] · {{ qc.carrier }} ({{ qc.sample_tracking_no }})</div>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <span v-if="qc.status !== 'IN_INSPECTION'" class="rounded-md px-2.5 py-1 text-2xs font-bold" :class="qc.status === 'APPROVED' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'">{{ qc.status === 'APPROVED' ? '검수합격' : '검수반려' }}</span>
                <template v-else>
                  <button type="button" class="rounded bg-success px-2.5 py-1 text-2xs font-bold text-primary-on" @click="openQc(qc, 'APPROVED')">합격 승인</button>
                  <button type="button" class="rounded border border-line px-2 py-1 text-2xs font-bold text-danger hover:bg-danger-soft" @click="openQc(qc, 'REJECTED')">반려</button>
                </template>
              </div>
            </div>
          </div>
        </section>

        <section class="space-y-3 rounded-2xl border border-line bg-surface p-5" aria-label="IPR 신고">
          <div class="border-b border-line-divider pb-3">
            <h2 class="text-sm font-bold text-ink">지식재산권(IPR) 신고 <span class="rounded bg-danger-soft px-2 py-0.5 font-mono text-2xs text-danger">긴급 접수</span></h2>
            <p class="mt-0.5 text-2xs text-ink-muted">상표권/가품 신고 접수 시 해당 상품을 즉시 블라인드하고 정산금을 동결합니다.</p>
          </div>
          <OmEmptyState v-if="iprReports.length === 0" compact title="접수된 지식재산권 신고가 없습니다." description="새 신고가 접수되면 이곳에 표시됩니다." />
          <div v-else class="divide-y divide-line-divider">
            <div v-for="ipr in iprReports" :key="ipr.id" class="flex items-center justify-between gap-3 py-3">
              <div>
                <div class="font-bold text-ink">{{ ipr.product_title }}</div>
                <div class="text-2xs font-bold text-danger">신고자: {{ ipr.reporter_name }} (권리브랜드: {{ ipr.brand_name }} · 유형: {{ ipr.infringement_type }})</div>
              </div>
              <div class="shrink-0">
                <span v-if="ipr.status === 'TAKEDOWN_APPLIED'" class="rounded bg-surface-2 px-2.5 py-1 text-2xs font-bold text-ink-muted">판매중단 완료</span>
                <button v-else type="button" class="rounded-lg bg-danger px-3 py-1.5 text-2xs font-bold text-primary-on" @click="fastTrackTakedown(ipr.id)">차단 요청 접수</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <div v-if="qcOpen" class="fixed inset-0 z-modal flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="샘플 검수">
      <div class="absolute inset-0 bg-overlay/50" @click="qcOpen = false"></div>
      <div class="relative w-full max-w-md space-y-3 rounded-2xl border border-line bg-surface p-6">
        <h2 class="text-sm font-bold text-ink">샘플 {{ qcDecision === 'APPROVED' ? '합격 승인' : '반려' }}</h2>
        <p class="text-xs text-ink-muted">{{ qcTarget?.product_title }}</p>
        <textarea v-model="qcNotes" rows="3" :placeholder="qcDecision === 'APPROVED' ? '검수 의견(합격 근거)을 입력하세요' : '반려 사유를 입력하세요'" aria-label="검수 의견" class="w-full rounded-lg border border-line bg-surface p-3 text-xs text-ink"></textarea>
        <div class="flex justify-end gap-2">
          <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="qcOpen = false">취소</button>
          <button type="button" :disabled="qcBusy || !qcNotes.trim()" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitQc">{{ qcBusy ? '처리 중…' : '확인' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
