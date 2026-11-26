<script setup lang="ts">
// Seller dashboard (4-1): action pipeline KPIs, sales trend + fulfillment
// gauges, and the two hot lists (due shipments, overdue Q&A). Every figure
// comes from /partner/dashboard/pipeline or /partner/metrics; KPI cards link
// to the filtered list that produces the same count.
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { API_BASE, getPartnerHeaders } from '../config'
import { userErrorMessage, OmKpiCard, OmEmptyState, OmSkeleton, OmButton } from '@olmoa/ui'

const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`
const fmtDate = (d: any) => {
  if (!d) return '-'
  const t = new Date(String(d).replace(' ', 'T'))
  return Number.isNaN(t.getTime()) ? String(d) : `${t.getMonth() + 1}.${t.getDate()}`
}

const loading = ref(true)
const pipeError = ref('')
const metricError = ref('')
const pipe = ref<any>(null)
const metrics = ref<any>({ weekly_gmv: [], monthly_gmv: [] })
const trendRange = ref<'7' | '30'>('7')

const dueList = ref<any[]>([])
const dueError = ref('')
const overdueQna = ref<any[]>([])
const qnaError = ref('')
// 6-11: products without a live shipping policy are hidden from buyers until the
// seller assigns one (null = count unavailable, notice stays hidden).
const unassignedCount = ref<number | null>(null)
const policyCount = ref<number | null>(null)

const trendSeries = computed(() => (trendRange.value === '7' ? metrics.value.weekly_gmv || [] : metrics.value.monthly_gmv || []))
const trendDelta = computed(() => (trendRange.value === '7' ? metrics.value.wow_pct : metrics.value.mom_pct))
const trendTotal = computed(() => trendSeries.value.reduce((t: number, b: any) => t + (Number(b.amount) || 0), 0))
const maxTrend = computed(() => Math.max(1, ...trendSeries.value.map((b: any) => Number(b.amount) || 0)))
const point = (i: number, n: number) => {
  const x = n <= 1 ? 250 : 20 + (i * 460) / (n - 1)
  const y = 100 - ((Number(trendSeries.value[i]?.amount) || 0) / maxTrend.value) * 75
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
}
const linePath = computed(() => trendSeries.value.map((_: any, i: number) => `${i === 0 ? 'M' : 'L'} ${point(i, trendSeries.value.length).x} ${point(i, trendSeries.value.length).y}`).join(' '))
const areaPath = computed(() => (trendSeries.value.length ? `${linePath.value} L 480 110 L 20 110 Z` : ''))

async function getJson(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { headers: getPartnerHeaders() })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.success) throw new Error(json.error || '불러오지 못했습니다.')
  return json
}

async function loadPipeline() {
  pipeError.value = ''
  try {
    const json = await getJson('/api/v1/partner/dashboard/pipeline')
    pipe.value = json.data || json
  } catch (e: any) {
    pipeError.value = userErrorMessage(e, '파이프라인을 불러오지 못했습니다.')
  }
}

async function loadMetrics() {
  metricError.value = ''
  try {
    const json = await getJson('/api/v1/partner/metrics')
    metrics.value = json
  } catch (e: any) {
    metricError.value = userErrorMessage(e, '매출 지표를 불러오지 못했습니다.')
  }
}

async function loadDue() {
  dueError.value = ''
  try {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
    const json = await getJson(`/api/v1/partner/orders?status=PREPARING&due_before=${tomorrow}&per_page=10`)
    dueList.value = Array.isArray(json.data) ? json.data : []
  } catch (e: any) {
    dueError.value = userErrorMessage(e, '출고 임박 주문을 불러오지 못했습니다.')
  }
}

async function loadOverdueQna() {
  qnaError.value = ''
  try {
    const json = await getJson('/api/v1/partner/qna')
    const rows = Array.isArray(json.data) ? json.data : []
    const cutoff = Date.now() - 24 * 3600 * 1000
    overdueQna.value = rows.filter((q: any) => q.status === 'WAITING' && new Date(String(q.created_at).replace(' ', 'T')).getTime() < cutoff)
  } catch (e: any) {
    qnaError.value = userErrorMessage(e, '미답변 문의를 불러오지 못했습니다.')
  }
}

async function loadShippingGaps() {
  try {
    const [list, pols] = await Promise.all([
      getJson('/api/v1/partner/products?shipping=unassigned&per_page=1'),
      getJson('/api/v1/partner/shipping-policies')
    ])
    unassignedCount.value = Number(list.pagination?.total ?? 0) || 0
    policyCount.value = Array.isArray(pols.data) ? pols.data.length : 0
  } catch { unassignedCount.value = null }
}

onMounted(async () => {
  loading.value = true
  await Promise.all([loadPipeline(), loadMetrics(), loadDue(), loadOverdueQna(), loadShippingGaps()])
  loading.value = false
})
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-ink">대시보드</h1>
      <p class="mt-1 text-xs text-ink-muted">처리해야 할 일부터 보여줍니다. 카드 숫자는 눌렀을 때 열리는 목록 건수와 같습니다.</p>
    </div>

    <div v-if="unassignedCount" class="flex flex-col gap-3 rounded-xl border border-warning bg-warning-soft p-4 text-xs sm:flex-row sm:items-center" role="status" data-shipping-gap>
      <p class="min-w-0 flex-1 text-ink">
        <strong class="text-warning">배송정책 미지정 상품 {{ unassignedCount.toLocaleString('ko-KR') }}개</strong>는 구매자에게 노출되지 않고 주문도 받을 수 없습니다.
        {{ policyCount ? '상품 목록에서 선택한 뒤 배송정책을 일괄 지정해 주세요.' : '먼저 배송정책을 만든 뒤 상품에 지정해 주세요.' }}
      </p>
      <OmButton v-if="policyCount" to="/products?shipping=unassigned" variant="primary" size="sm">미지정 상품 일괄 지정</OmButton>
      <OmButton v-else to="/store/shipping-policies" variant="primary" size="sm">배송정책 만들기</OmButton>
    </div>

    <div v-if="pipeError" class="rounded-xl border border-danger bg-danger-soft p-3.5 text-xs font-bold text-danger" role="alert">
      {{ pipeError }}
      <button type="button" class="ml-2 underline hover:no-underline" @click="loadPipeline">다시 시도</button>
    </div>

    <!-- Row 1: action pipeline -->
    <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
      <OmKpiCard label="신규 주문" :value="pipe ? String(pipe.new_orders) : '-'" :loading="loading" :error="pipeError" to="/shipments?tab=new" @retry="loadPipeline" />
      <OmKpiCard label="발송 대기" :value="pipe ? String(pipe.preparing) : '-'" :loading="loading" :error="pipeError" to="/shipments?tab=waiting" @retry="loadPipeline" />
      <OmKpiCard label="배송 중" :value="pipe ? String(pipe.in_transit) : '-'" :loading="loading" :error="pipeError" to="/shipments?tab=shipping" @retry="loadPipeline" />
      <OmKpiCard label="취소 요청" :value="pipe ? String(pipe.cancel_requests) : '-'" :loading="loading" :error="pipeError" to="/claims/cancel" @retry="loadPipeline" />
      <OmKpiCard label="반품 요청" :value="pipe ? String(pipe.return_requests) : '-'" :loading="loading" :error="pipeError" to="/claims/return" @retry="loadPipeline" />
      <OmKpiCard label="교환 요청" :value="pipe ? String(pipe.exchange_requests) : '-'" :loading="loading" :error="pipeError" to="/claims/exchange" @retry="loadPipeline" />
      <OmKpiCard label="미답변 문의" :value="pipe ? String(pipe.unanswered_qna) : '-'" :loading="loading" :error="pipeError" to="/qna?status=WAITING" @retry="loadPipeline" />
      <OmKpiCard label="정산 예정금" :value="pipe ? won(pipe.settlement?.expected_amount) : '-'" :loading="loading" :error="pipeError" to="/settlements" @retry="loadPipeline" />
    </div>
    <p v-if="pipe" class="om-num -mt-3 text-xs text-ink-muted">출금 가능 {{ won(pipe.settlement?.withdrawable_amount) }} · 지급은 출금 신청 후 승인 시 (다음 지급일 없음)</p>

    <!-- Row 2: sales trend + ops health -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div class="space-y-4 rounded-2xl border border-line bg-surface p-6 lg:col-span-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 class="text-sm font-bold text-ink">매출 추이</h2>
            <p class="om-num mt-0.5 text-xs text-ink-muted">합계 {{ won(trendTotal) }}</p>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="trendDelta !== null && trendDelta !== undefined" class="om-num rounded-full px-2.5 py-1 text-xs font-bold" :class="Number(trendDelta) >= 0 ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'">
              전기 대비 {{ Number(trendDelta) >= 0 ? '+' : '' }}{{ trendDelta }}% {{ Number(trendDelta) >= 0 ? '▲' : '▼' }}
            </span>
            <div class="flex rounded-full border border-line p-0.5 text-xs font-bold" role="group" aria-label="집계 기간">
              <button type="button" :class="['rounded-full px-3 py-1', trendRange === '7' ? 'bg-secondary text-secondary-on' : 'text-ink-muted']" @click="trendRange = '7'">7일</button>
              <button type="button" :class="['rounded-full px-3 py-1', trendRange === '30' ? 'bg-secondary text-secondary-on' : 'text-ink-muted']" @click="trendRange = '30'">30일</button>
            </div>
          </div>
        </div>
        <div v-if="loading"><OmSkeleton variant="rect" height="h-44" /></div>
        <p v-else-if="metricError" class="text-xs font-bold text-danger" role="alert">{{ metricError }} <button type="button" class="underline hover:no-underline" @click="loadMetrics">다시 시도</button></p>
        <div v-else class="h-44 w-full pt-2">
          <svg viewBox="0 0 500 120" class="h-full w-full overflow-visible" role="img" aria-label="일별 매출 추이 그래프">
            <defs>
              <linearGradient id="gmvGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" class="gmv-stop-top" />
                <stop offset="100%" class="gmv-stop-bottom" />
              </linearGradient>
            </defs>
            <line x1="0" y1="30" x2="500" y2="30" class="gmv-grid" stroke-dasharray="3,3" />
            <line x1="0" y1="70" x2="500" y2="70" class="gmv-grid" stroke-dasharray="3,3" />
            <line x1="0" y1="110" x2="500" y2="110" class="gmv-axis" />
            <path :d="areaPath" fill="url(#gmvGradient)" />
            <path :d="linePath" fill="none" class="gmv-line" stroke-width="3" stroke-linecap="round" />
          </svg>
        </div>
      </div>

      <div class="space-y-4 rounded-2xl border border-line bg-surface p-6">
        <h2 class="text-sm font-bold text-ink">운영 지표 · 페널티 · 등급</h2>
        <dl class="space-y-3 text-xs">
          <div class="flex items-center justify-between gap-2"><dt class="text-ink-muted">출고 준수율(24시간 내)</dt><dd class="om-num font-bold text-ink">{{ metrics.ship_on_time_rate ?? '-' }}{{ metrics.ship_on_time_rate === null || metrics.ship_on_time_rate === undefined ? '' : '%' }}</dd></div>
          <div class="flex items-center justify-between gap-2"><dt class="text-ink-muted">평균 배송일</dt><dd class="om-num font-bold text-ink">{{ metrics.avg_delivery_days ?? '-' }}{{ metrics.avg_delivery_days === null || metrics.avg_delivery_days === undefined ? '' : '일' }}</dd></div>
          <div class="flex items-center justify-between gap-2"><dt class="text-ink-muted">클레임률</dt><dd class="om-num font-bold text-ink">{{ metrics.claim_rate_pct ?? '-' }}{{ metrics.claim_rate_pct === null || metrics.claim_rate_pct === undefined ? '' : '%' }}</dd></div>
          <div class="flex items-center justify-between gap-2 border-t border-line-divider pt-3"><dt class="text-ink-muted">최근 30일 페널티</dt><dd class="om-num font-bold text-ink">{{ pipe ? `${pipe.penalty_count}건 ${pipe.penalty_points}점` : '-' }}</dd></div>
          <div class="flex items-center justify-between gap-2"><dt class="text-ink-muted">등급</dt><dd class="font-bold text-ink">{{ pipe?.grade ? `${pipe.grade.grade_code} (${pipe.grade.month})` : '미부여' }}</dd></div>
        </dl>
      </div>
    </div>

    <!-- Row 3: hot lists -->
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div class="rounded-2xl border border-line bg-surface p-6">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-bold text-ink">출고기한 임박 주문 (최대 10건)</h2>
          <RouterLink to="/shipments?tab=waiting" class="text-xs font-bold text-primary hover:underline">전체보기</RouterLink>
        </div>
        <p v-if="dueError" class="text-xs font-bold text-danger" role="alert">{{ dueError }} <button type="button" class="underline hover:no-underline" @click="loadDue">다시 시도</button></p>
        <OmEmptyState v-else-if="!loading && !dueList.length" compact title="출고 대기 주문이 없습니다" />
        <ul v-else class="divide-y divide-line-divider text-xs">
          <li v-for="o in dueList" :key="o.id" class="flex items-center justify-between gap-2 py-2">
            <span class="min-w-0 truncate font-mono text-ink">{{ o.sub_order_no }}</span>
            <span class="shrink-0 text-ink-muted">{{ o.recipient_name }}</span>
            <span class="om-num shrink-0 font-bold" :class="String(o.ship_by_deadline) <= new Date().toISOString().slice(0, 10) ? 'text-danger' : 'text-ink'">{{ fmtDate(o.ship_by_deadline) }}</span>
          </li>
        </ul>
      </div>
      <div class="rounded-2xl border border-line bg-surface p-6">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-bold text-ink">24시간 넘은 미답변 문의</h2>
          <RouterLink to="/qna?status=WAITING" class="text-xs font-bold text-primary hover:underline">전체보기</RouterLink>
        </div>
        <p v-if="qnaError" class="text-xs font-bold text-danger" role="alert">{{ qnaError }} <button type="button" class="underline hover:no-underline" @click="loadOverdueQna">다시 시도</button></p>
        <OmEmptyState v-else-if="!loading && !overdueQna.length" compact title="24시간 넘은 미답변 문의가 없습니다" />
        <ul v-else class="divide-y divide-line-divider text-xs">
          <li v-for="q in overdueQna.slice(0, 10)" :key="q.id" class="flex items-center justify-between gap-2 py-2">
            <span class="min-w-0 truncate text-ink">{{ q.question }}</span>
            <span class="om-num shrink-0 text-ink-muted">{{ fmtDate(q.created_at) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gmv-stop-top { stop-color: rgb(var(--om-primary) / 0.25); }
.gmv-stop-bottom { stop-color: rgb(var(--om-primary) / 0); }
.gmv-grid { stroke: rgb(var(--om-divider)); stroke-width: 1; }
.gmv-axis { stroke: rgb(var(--om-border)); stroke-width: 1; }
.gmv-line { stroke: rgb(var(--om-primary)); }
</style>
