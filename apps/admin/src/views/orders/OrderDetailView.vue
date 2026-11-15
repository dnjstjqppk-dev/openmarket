<script setup lang="ts">
// Admin order detail (4-16): order, sub-orders and items, payment and
// refund history, settlement states, journal records and partial refunds.
import { ref, computed, onMounted } from 'vue'
import { useRoute, RouterLink } from 'vue-router'
import { adminApi, API_BASE_URL, getAdminHeaders } from '../../config'
import { userErrorMessage, useConfirm, useToast, formatNumber, OmSkeleton } from '@olmoa/ui'

const route = useRoute()
const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const STATUS_LABEL: Record<string, string> = { READY: '결제 대기', PAID: '결제완료', FAILED: '결제실패', CANCELLED: '취소', PARTIAL_REFUNDED: '부분환불', DELIVERED: '배송완료' }

const data = ref<any>(null)
const loading = ref(true)
const loadError = ref('')
const refunding = ref(false)
const actionMsg = ref('')
const picked = ref<Record<string, number>>({})
const reason = ref('')

const id = computed(() => String(route.params.id || ''))
const order = computed(() => data.value?.order || null)
const won = (v: any) => `${(Number(v) || 0).toLocaleString('ko-KR')}원`

function refundableLines() {
  const lines: { order_item_id: string; quantity: number }[] = []
  for (const s of data.value?.sub_orders || []) {
    for (const it of s.items || []) {
      const left = Number(it.quantity || 0) - Number(it.refunded_quantity || 0)
      if (left > 0) lines.push({ order_item_id: it.id, quantity: left })
    }
  }
  return lines
}

function pickedLines() {
  return Object.entries(picked.value)
    .filter(([, q]) => Number(q) > 0)
    .map(([order_item_id, quantity]) => ({ order_item_id, quantity: Number(quantity) }))
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi(`/api/v1/admin/orders/${encodeURIComponent(id.value)}`)
    if (!r.ok) throw new Error(r.data.error || '주문을 불러오지 못했습니다.')
    data.value = r.data.data
    picked.value = {}
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

async function refund(lines: { order_item_id: string; quantity: number }[], label: string) {
  if (!lines.length || refunding.value) return
  if (!reason.value.trim()) { toastApi.error('환불 사유를 입력해 주세요.'); return }
  const ok = await askConfirm({
    title: label, body: `${lines.length}개 품목을 원결제수단/적립금으로 환불합니다.`,
    amounts: [`환불 ${formatNumber(order.value.total_pay_amount)}`], danger: true
  })
  if (!ok) return
  refunding.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/orders/${order.value.id}/refund`, {
      method: 'POST',
      headers: { ...getAdminHeaders(), 'Content-Type': 'application/json', 'X-Idempotency-Key': `admfr-${order.value.id}-${Date.now()}` },
      body: JSON.stringify({ lines, reason: reason.value.trim() })
    })
    const json = await res.json().catch(() => ({}))
    actionMsg.value = res.ok && json.success
      ? `전액 환불 접수 (환불ID ${json.data?.refund?.id || '-'})`
      : `${json.error || '환불 실패'}`
    reason.value = ''
    await load()
  } catch {
    actionMsg.value = '환불 요청 중 네트워크 오류'
  } finally {
    refunding.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <RouterLink to="/orders" class="text-xs font-bold text-primary hover:underline">← 주문 목록으로</RouterLink>

    <div v-if="loading" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="8" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="load">다시 시도</button>
    </div>

    <div v-else-if="order" class="space-y-4">
      <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h1 class="om-num text-lg font-bold text-ink">{{ order.order_no || order.id }}</h1>
          <span class="rounded-full px-2 py-0.5 text-2xs font-bold" :class="order.payment_status === 'PAID' ? 'bg-warning-soft text-warning' : order.payment_status === 'CANCELLED' || order.payment_status === 'FAILED' ? 'bg-danger-soft text-danger' : order.payment_status === 'DELIVERED' ? 'bg-success-soft text-success' : 'bg-surface-3 text-ink-muted'">{{ STATUS_LABEL[order.payment_status] || order.payment_status }}</span>
        </div>
        <dl class="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
          <div><dt class="text-ink-subtle">구매자</dt><dd class="text-ink">{{ order.buyer_email || order.customer_id }}</dd></div>
          <div><dt class="text-ink-subtle">수령인</dt><dd class="text-ink">{{ order.recipient_name }} ({{ order.recipient_phone }})</dd></div>
          <div><dt class="text-ink-subtle">결제금액</dt><dd class="om-num font-bold text-ink">{{ won(order.total_pay_amount) }}</dd></div>
          <div class="sm:col-span-3"><dt class="text-ink-subtle">배송지</dt><dd class="text-ink">{{ order.shipping_address_line1 }} {{ order.shipping_address_line2 }} ({{ order.shipping_postal_code }})</dd></div>
        </dl>
      </section>

      <section v-for="s in (data.sub_orders || [])" :key="s.id" class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-sm font-bold text-ink">{{ s.business_name || s.partner_id }} <span class="om-num font-mono text-2xs font-normal text-ink-subtle">{{ s.sub_order_no }}</span></h2>
          <span class="rounded-full bg-surface-3 px-2 py-0.5 text-2xs font-bold text-ink-muted">{{ s.status }}</span>
        </div>
        <ul class="divide-y divide-line-divider text-xs">
          <li v-for="it in (s.items || [])" :key="it.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
            <div class="min-w-0">
              <p class="truncate font-bold text-ink">{{ it.product_title }}</p>
              <p class="om-num mt-0.5 text-ink-subtle">{{ it.option_summary }} · {{ won(it.unit_price) }} × {{ it.quantity }}개 (환불됨 {{ it.refunded_quantity || 0 }}개)</p>
            </div>
            <label v-if="['PAID', 'PARTIAL_REFUNDED'].includes(order.payment_status) && Number(it.quantity) - Number(it.refunded_quantity) > 0" class="flex items-center gap-1 text-2xs font-bold text-ink-muted">
              환불 수량
              <input v-model.number="picked[it.id]" type="number" min="0" :max="Number(it.quantity) - Number(it.refunded_quantity)" class="h-8 w-16 rounded-lg border border-line bg-surface px-2 text-ink" />
            </label>
          </li>
        </ul>
        <p class="text-xs text-ink-muted">
          정산: <b class="text-ink">{{ s.settlement ? `${s.settlement.status} · ${won(s.settlement.net_payout_amount)}` : '없음' }}</b>
          <span v-if="s.tracking_number" class="om-num"> · 송장 {{ s.tracking_number }}</span>
        </p>
      </section>

      <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <h2 class="text-sm font-bold text-ink">결제 · 환불 이력</h2>
        <ul class="space-y-1 text-xs">
          <li v-for="pay in (data.payments || [])" :key="pay.id" class="om-num text-ink-muted">결제 {{ pay.method }} {{ won(pay.amount) }} · {{ pay.status }} · {{ String(pay.created_at || '').slice(0, 16).replace('T', ' ') }}</li>
          <li v-for="rf in (data.refunds || [])" :key="rf.id" class="om-num text-ink-muted">환불 PG {{ won(rf.pg_amount) }} + 적립금 {{ won(rf.credit_amount) }} · {{ rf.status }} · {{ String(rf.created_at || '').slice(0, 16).replace('T', ' ') }}</li>
          <li v-if="!(data.payments || []).length && !(data.refunds || []).length" class="text-ink-subtle">기록이 없습니다.</li>
        </ul>
      </section>

      <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <h2 class="text-sm font-bold text-ink">회계 기록</h2>
        <p v-if="!(data.journal || []).length" class="text-xs text-ink-muted">회계 기록이 없습니다.</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[520px] text-xs">
            <thead class="text-ink-muted"><tr><th class="p-1 text-left">거래</th><th class="p-1 text-left">계정</th><th class="p-1 text-right">차변</th><th class="p-1 text-right">대변</th></tr></thead>
            <tbody>
              <tr v-for="j in data.journal" :key="j.id" class="border-t border-line-divider">
                <td class="om-num p-1 text-ink-muted">{{ j.txn_id }}</td>
                <td class="p-1 font-mono text-ink">{{ j.account_code }}</td>
                <td class="om-num p-1 text-right text-ink">{{ won(j.debit) }}</td>
                <td class="om-num p-1 text-right text-ink">{{ won(j.credit) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="['PAID', 'PARTIAL_REFUNDED'].includes(order.payment_status)" class="space-y-3 rounded-2xl border border-line bg-surface p-5">
        <h2 class="text-sm font-bold text-ink">환불 조치</h2>
        <p v-if="actionMsg" role="status" class="rounded-xl bg-secondary p-3 text-xs font-bold text-secondary-on">{{ actionMsg }}</p>
        <input v-model="reason" placeholder="환불 사유 (필수, 환불 원장에 기록됩니다)" aria-label="환불 사유" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-xs text-ink" />
        <div class="flex flex-wrap gap-2">
          <button type="button" :disabled="refunding || !refundableLines().length" class="h-10 rounded-lg border border-danger px-4 text-sm font-bold text-danger hover:bg-danger-soft disabled:opacity-50" @click="refund(refundableLines(), '주문 전액 환불')">{{ refunding ? '처리 중…' : '전액 환불' }}</button>
          <button type="button" :disabled="refunding || !pickedLines().length" class="h-10 rounded-lg bg-secondary px-4 text-sm font-bold text-secondary-on hover:bg-secondary-hover disabled:opacity-50" @click="refund(pickedLines(), '주문 부분 환불')">{{ refunding ? '처리 중…' : '선택 부분 환불' }}</button>
        </div>
      </section>
    </div>
  </div>
</template>
