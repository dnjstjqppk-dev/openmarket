<script setup lang="ts">
// Settlement batches (4-17): payout-eligible settlements grouped by seller
// payout cycle, per-seller amounts and payout confirmation.
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { adminApi, won } from '../../config'
import { userErrorMessage, useConfirm, useToast, formatNumber, OmEmptyState, OmModal, OmSkeleton } from '@olmoa/ui'

const route = useRoute()
const { confirm: askConfirm } = useConfirm()
const toastApi = useToast()
const U = '문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const CYCLE_LABEL: Record<string, string> = { WEEKLY: '주간', BIWEEKLY: '격주', MONTHLY: '월간' }

const pending = ref<any[]>([])
const payouts = ref<any[]>([])
const loading = ref(true)
const loadError = ref('')
const msg = ref('')
const confirming = ref<string | null>(null)
const transferOpen = ref(false)
const transferTarget = ref<any>(null)
const transferRef = ref('')
const highlightPartner = computed(() => typeof route.query.partner_id === 'string' ? route.query.partner_id : '')

const byCycle = computed(() => {
  const groups = new Map<string, any[]>()
  for (const p of pending.value) {
    const c = p.settlement_cycle || 'UNKNOWN'
    if (!groups.has(c)) groups.set(c, [])
    groups.get(c)!.push(p)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
})

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await adminApi('/api/v1/admin/finance/payouts')
    if (!r.ok) throw new Error(r.data.error || '지급 대상을 불러오지 못했습니다.')
    pending.value = r.data.data?.pending || []
    payouts.value = r.data.data?.payouts || []
  } catch (e: any) {
    loadError.value = userErrorMessage(e, U)
  } finally {
    loading.value = false
  }
}

async function confirmBatch(p: any) {
  const reserveNote = p.reserve_to_hold || p.reserve_to_release
    ? `\n(정산 ${won(p.gross_amount)} − 리저브 보류 ${won(p.reserve_to_hold)} + 리저브 해제 ${won(p.reserve_to_release)})` : ''
  const ok = await askConfirm({ title: '지급 확정', body: `실제 이체는 은행에서 별도로 진행합니다.${reserveNote}`, amounts: [`${p.business_name} ${formatNumber(p.amount)}`], danger: true })
  if (!ok) return
  confirming.value = p.partner_id
  try {
    const r = await adminApi('/api/v1/admin/finance/payouts', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': `batch-${p.partner_id}-${Date.now()}` },
      json: { partner_id: p.partner_id }
    })
    const d = r.data?.data || {}
    msg.value = r.ok
      ? `지급 확정 ${d.payout_id} · ${won(d.amount)}${d.reserve_held ? ` (리저브 ${won(d.reserve_held)} ${d.reserve_release_days}일 보류)` : ''} — 이체 후 참조번호를 기록하세요.`
      : (r.data.error || '지급 실패')
  } catch (e: any) {
    msg.value = userErrorMessage(e, '지급 실패')
  } finally {
    confirming.value = null
  }
  void load()
}

function openTransfer(po: any) {
  transferTarget.value = po
  transferRef.value = ''
  transferOpen.value = true
}

async function submitTransfer() {
  if (!transferTarget.value || !transferRef.value.trim()) return
  try {
    const r = await adminApi(`/api/v1/admin/finance/payouts/${transferTarget.value.id}/transferred`, {
      method: 'POST', json: { bank_transfer_ref: transferRef.value.trim() }
    })
    msg.value = r.ok ? '이체 완료로 기록되었습니다.' : (r.data.error || '기록 실패')
    transferOpen.value = false
  } catch (e: any) {
    msg.value = userErrorMessage(e, '기록 실패')
  }
  void load()
}

onMounted(() => void load())
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold text-ink">정산 배치</h1>
      <p class="mt-1 text-xs text-ink-muted">지급액 = 정산 + 이월 차감 − 롤링 리저브 보류 + 보류 기간이 끝난 리저브. 확정 후 실제 이체는 은행에서 별도로 진행합니다.</p>
    </div>

    <div v-if="msg" role="status" class="rounded-xl bg-secondary p-3 text-xs font-bold text-secondary-on">{{ msg }}</div>

    <div v-if="loading && !pending.length" class="rounded-2xl border border-line bg-surface p-6">
      <p class="mb-3 text-xs text-ink-muted">불러오는 중입니다…</p>
      <OmSkeleton variant="row" :count="8" />
    </div>
    <div v-else-if="loadError" class="rounded-2xl border border-danger bg-danger-soft p-6 text-center text-xs text-danger" role="alert">
      <p class="font-bold">{{ U }}</p>
      <p class="mt-1">{{ loadError }}</p>
      <button type="button" class="mx-auto mt-2 block rounded-full bg-secondary px-4 py-1.5 font-bold text-secondary-on hover:bg-secondary-hover" @click="load">다시 시도</button>
    </div>

    <div v-else class="space-y-4">
      <p v-if="highlightPartner" class="rounded-xl bg-primary-soft p-2 text-xs font-bold text-primary-soft-ink">원장에서 이동 — 판매자 {{ highlightPartner }}의 지급 대기가 강조 표시됩니다.</p>
      <OmEmptyState v-if="!pending.length" compact title="구매확정된 지급 대상이 없습니다." description="구매확정 정산이 쌓이면 주기별로 표시됩니다." />
      <section v-for="[cycle, rows] in byCycle" :key="cycle" class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <h2 class="text-sm font-bold text-ink">{{ CYCLE_LABEL[cycle] || cycle }} 정산 · {{ rows.length }}개 판매자</h2>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[640px] text-xs">
            <thead class="text-ink-muted"><tr><th class="p-1 text-left">판매자</th><th class="p-1 text-right">정산 건</th><th class="p-1 text-right">이월 차감</th><th class="p-1 text-right">정산액</th><th class="p-1 text-right">리저브 보류</th><th class="p-1 text-right">리저브 해제</th><th class="p-1 text-right">지급액</th><th></th></tr></thead>
            <tbody>
              <tr v-for="p in rows" :key="p.partner_id" class="border-t border-line-divider" :class="p.partner_id === highlightPartner ? 'bg-primary-soft' : ''">
                <td class="p-1 font-bold text-ink">{{ p.business_name }}<div v-if="p.reserve_outstanding" class="font-normal text-ink-subtle">보류 중 리저브 {{ won(p.reserve_outstanding) }} · 다음 해제 {{ p.next_reserve_release }}</div></td>
                <td class="om-num p-1 text-right text-ink-muted">{{ p.settlements }}</td>
                <td class="om-num p-1 text-right text-ink-muted">{{ p.carried_adjustments }}</td>
                <td class="om-num p-1 text-right text-ink">{{ won(p.gross_amount) }}</td>
                <td class="om-num p-1 text-right text-warning">{{ p.reserve_to_hold ? `−${won(p.reserve_to_hold)}` : '-' }}</td>
                <td class="om-num p-1 text-right text-success">{{ p.reserve_to_release ? `+${won(p.reserve_to_release)}` : '-' }}</td>
                <td class="om-num p-1 text-right font-bold" :class="p.amount <= 0 ? 'text-danger' : 'text-ink'">{{ won(p.amount) }}</td>
                <td class="p-1 text-right"><button type="button" :disabled="p.amount <= 0 || confirming === p.partner_id" class="rounded-lg bg-primary px-3 py-1.5 font-bold text-primary-on hover:bg-primary-hover disabled:opacity-40" @click="confirmBatch(p)">{{ confirming === p.partner_id ? '확정 중…' : '확정' }}</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="space-y-2 rounded-2xl border border-line bg-surface p-5">
        <h2 class="text-sm font-bold text-ink">지급 이력</h2>
        <p v-if="!payouts.length" class="text-xs text-ink-muted">지급 이력이 없습니다.</p>
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[520px] text-xs">
            <tbody>
              <tr v-for="po in payouts" :key="po.id" class="border-t border-line-divider">
                <td class="om-num p-1 text-ink-muted">{{ String(po.id).slice(0, 14) }}</td>
                <td class="p-1 font-bold text-ink">{{ po.business_name }}</td>
                <td class="om-num p-1 text-right text-ink">{{ won(po.amount) }}<div v-if="po.reserve_held || po.reserve_released" class="text-ink-subtle">리저브 −{{ won(po.reserve_held) }} / +{{ won(po.reserve_released) }}</div></td>
                <td class="p-1 text-ink-muted">{{ po.status === 'TRANSFERRED' ? `이체 완료 (${po.bank_transfer_ref})` : '확정 · 이체 대기' }}</td>
                <td class="p-1 text-right"><button v-if="po.status === 'APPROVED'" type="button" class="rounded-lg border border-line px-2 py-1 font-bold text-ink hover:bg-surface-2" @click="openTransfer(po)">이체 기록</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <OmModal v-model:open="transferOpen" title="이체 결과 기록">
      <div class="space-y-3 text-xs">
        <p class="font-bold text-ink">{{ transferTarget?.business_name }} · {{ won(transferTarget?.amount) }}</p>
        <input v-model="transferRef" maxlength="100" placeholder="은행 이체 참조번호" aria-label="이체 참조번호" class="h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink" />
      </div>
      <template #footer>
        <button type="button" class="h-10 rounded-lg border border-line px-4 text-sm font-bold text-ink hover:bg-surface-2" @click="transferOpen = false">취소</button>
        <button type="button" :disabled="!transferRef.trim()" class="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-on hover:bg-primary-hover disabled:opacity-50" @click="submitTransfer">기록</button>
      </template>
    </OmModal>
  </div>
</template>
