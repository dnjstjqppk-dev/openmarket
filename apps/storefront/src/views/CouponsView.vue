<script setup lang="ts">
// Buyer coupon wallet (3-11): usable / claimable / used-expired tabs with the
// real wallet groups (Q-3-6(c) fixed the same mis-parse in CheckoutView).
// Card fields come straight from the coupon row; D-day derives from expires_at.
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useLocaleStore } from '../stores/locale'
import { API_BASE_URL, authHeader, newIdempotencyKey } from '../config'
import { userErrorMessage, OmButton, OmEmptyState, OmStatusTabs } from '@olmoa/ui'

const auth = useAuthStore()
const locale = useLocaleStore()
const usable = ref<any[]>([])
const claimable = ref<any[]>([])
const usedExpired = ref<any[]>([])
const creditData = ref<any>({ balance: null, history: [] })
const claimMsg = ref('')
const loadError = ref<string | null>(null)
const loading = ref(true)
const claimingId = ref<string | null>(null)
const tab = ref('usable')

const SCOPE_LABEL: Record<string, string> = {
  ALL: '전체 상품',
  SELLER: '스토어 전용',
  CATEGORY: '카테고리 전용',
  PRODUCT: '특정 상품'
}

const issuerOf = (c: any) => (c.issuer === 'PLATFORM' || c.dup_group === 'PLATFORM' ? '올모아' : (c.seller_name || '스토어'))
const discountText = (c: any) => (c.discount_type === 'PERCENT'
  ? `${c.discount_value}%${c.max_discount_amount ? ` (최대 ${locale.formatPrice(c.max_discount_amount)})` : ''}`
  : locale.formatPrice(c.discount_value))
const ddayOf = (c: any) => {
  const ms = new Date(String(c.valid_until || c.expires_at).replace(' ', 'T')).getTime() - Date.now()
  if (!Number.isFinite(ms)) return '기한 정보 없음'
  const days = Math.ceil(ms / 86400000)
  if (days < 0) return '만료됨'
  if (days === 0) return '오늘 만료'
  return `D-${days}`
}
const usedLabel = (c: any) => {
  if (Number(c.is_used) === 1) return '사용됨'
  const ms = new Date(String(c.valid_until || c.expires_at).replace(' ', 'T')).getTime() - Date.now()
  return Number.isFinite(ms) && ms < 0 ? '만료됨' : '사용 불가'
}

const tabRows = computed(() => (tab.value === 'usable' ? usable.value : tab.value === 'claimable' ? claimable.value : usedExpired.value))
const emptyTitle = computed(() => (tab.value === 'usable'
  ? '사용 가능한 쿠폰이 없습니다'
  : tab.value === 'claimable' ? '받을 수 있는 쿠폰이 없습니다' : '사용·만료된 쿠폰이 없습니다'))

const loadWallet = async () => {
  const cid = auth.user?.id || ''
  loadError.value = null
  claimMsg.value = ''
  loading.value = true
  try {
    const [cRes, crRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/coupons?customer_id=${encodeURIComponent(cid)}`, { headers: { ...authHeader() } }),
      fetch(`${API_BASE_URL}/api/v1/credits?customer_id=${encodeURIComponent(cid)}`, { headers: { ...authHeader() } })
    ])
    const cJson = await cRes.json().catch(() => null)
    const crJson = await crRes.json().catch(() => null)
    if (!cRes.ok || !cJson?.success) throw new Error(cJson?.error || '쿠폰 목록을 불러오지 못했습니다')
    if (!crRes.ok || !crJson?.success) throw new Error(crJson?.error || '적립금 잔액을 불러오지 못했습니다')
    usable.value = cJson.usable || cJson.data?.usable || []
    claimable.value = cJson.claimable || cJson.data?.claimable || []
    usedExpired.value = cJson.used_expired || cJson.data?.used_expired || []
    creditData.value = crJson.data || { balance: 0, history: [] }
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '지갑 정보를 불러오지 못했습니다')
  } finally {
    loading.value = false
  }
}

const claimCoupon = async (couponId: string) => {
  if (claimingId.value) return
  claimingId.value = couponId
  try {
    const cid = auth.user?.id || ''
    const res = await fetch(`${API_BASE_URL}/api/v1/coupons/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(), 'X-Idempotency-Key': newIdempotencyKey('clm') },
      body: JSON.stringify({ customer_id: cid, coupon_id: couponId })
    })
    const json = await res.json().catch(() => null)
    if (res.ok && json?.success) {
      claimMsg.value = '쿠폰을 받았습니다. 주문서에서 사용할 수 있습니다.'
      await loadWallet()
    } else {
      claimMsg.value = `${json?.error || '쿠폰 받기에 실패했습니다.'}`
    }
  } finally {
    claimingId.value = null
  }
}

onMounted(loadWallet)
</script>

<template>
  <div class="mx-auto max-w-[1100px] space-y-6 px-4 py-8 sm:px-6">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-ink">쿠폰함</h1>
        <p class="mt-1 text-xs text-ink-muted">주문서에서 쿠폰을 골라 쓸 수 있습니다.</p>
      </div>
      <RouterLink to="/my/credits" class="rounded-2xl border border-line bg-surface px-4 py-3 text-right transition-colors hover:border-line-strong">
        <span class="block text-2xs text-ink-muted">보유 적립금</span>
        <span class="om-num block text-xl font-bold text-primary">{{ creditData.balance == null ? '-' : locale.formatPrice(creditData.balance) }}</span>
      </RouterLink>
    </div>

    <div v-if="claimMsg" role="status" class="rounded-xl border border-success bg-success-soft p-3.5 text-xs font-bold text-success">
      {{ claimMsg }}
    </div>

    <div v-if="loadError" class="flex items-center justify-between gap-3 rounded-xl border border-danger bg-danger-soft p-3.5 text-xs font-bold text-danger">
      <span><span class="block">문제가 발생했습니다. 잠시 후 다시 시도해주세요.</span><span class="block font-normal">{{ loadError }}</span></span>
      <button type="button" class="shrink-0 rounded-full bg-secondary px-4 py-2 text-secondary-on hover:bg-secondary-hover" @click="loadWallet">다시 시도</button>
    </div>

    <OmStatusTabs
      v-model="tab"
      :tabs="[
        { value: 'usable', label: '사용 가능', count: usable.length },
        { value: 'claimable', label: '받을 수 있음', count: claimable.length },
        { value: 'used', label: '사용·만료', count: usedExpired.length }
      ]"
    />

    <div v-if="loading" class="grid grid-cols-1 gap-4 md:grid-cols-3" aria-label="쿠폰 목록을 불러오는 중">
      <div v-for="n in 3" :key="n" class="h-44 animate-pulse rounded-2xl border border-line bg-surface-2"></div>
    </div>
    <OmEmptyState
      v-else-if="!tabRows.length && !loadError"
      :title="emptyTitle"
      description="새 쿠폰이 발급되면 이곳에 표시됩니다."
    >
      <OmButton size="sm" @click="loadWallet">다시 불러오기</OmButton>
    </OmEmptyState>
    <div v-else class="grid grid-cols-1 gap-4 md:grid-cols-3">
      <div
        v-for="c in tabRows"
        :key="c.user_coupon_id || c.id"
        class="flex flex-col justify-between rounded-2xl border-2 border-dashed border-primary bg-surface p-5"
      >
        <div>
          <div class="mb-2 flex items-center justify-between">
            <span class="rounded bg-primary-soft px-2.5 py-0.5 text-2xs font-bold text-primary-soft-ink">{{ c.code }}</span>
            <span class="om-num text-2xs font-bold text-ink-muted">{{ ddayOf(c) }}</span>
          </div>
          <div class="om-num mb-1 text-2xl font-bold text-danger">
            {{ discountText(c) }}
          </div>
          <h3 class="text-sm font-bold text-ink">{{ c.name }}</h3>
          <dl class="mt-2 space-y-1 text-xs text-ink-muted">
            <div class="flex justify-between gap-2"><dt>발급처</dt><dd class="font-semibold text-ink">{{ issuerOf(c) }}</dd></div>
            <div class="flex justify-between gap-2"><dt>적용 범위</dt><dd class="font-semibold text-ink">{{ SCOPE_LABEL[c.scope] || '전체 상품' }}</dd></div>
            <div class="flex justify-between gap-2"><dt>최소 주문</dt><dd class="om-num font-semibold text-ink">{{ locale.formatPrice(c.min_order_amount || 0) }}</dd></div>
            <div v-if="c.discount_type === 'PERCENT' && c.max_discount_amount" class="flex justify-between gap-2"><dt>최대 할인</dt><dd class="om-num font-semibold text-ink">{{ locale.formatPrice(c.max_discount_amount) }}</dd></div>
          </dl>
        </div>
        <button
          v-if="tab === 'claimable'"
          type="button"
          :disabled="claimingId === c.id"
          class="mt-4 h-10 w-full rounded-xl bg-primary text-xs font-bold text-primary-on transition-colors hover:bg-primary-hover disabled:opacity-60"
          @click="claimCoupon(c.id)"
        >
          {{ claimingId === c.id ? '받는 중…' : '쿠폰 받기' }}
        </button>
        <p v-else-if="tab === 'used'" class="mt-4 rounded-xl bg-surface-2 py-2.5 text-center text-xs font-bold text-ink-muted">{{ usedLabel(c) }}</p>
        <p v-else class="mt-4 rounded-xl bg-surface-2 py-2.5 text-center text-xs font-bold text-ink-muted">주문서에서 사용</p>
      </div>
    </div>
  </div>
</template>
