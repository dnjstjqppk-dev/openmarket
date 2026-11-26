<script setup lang="ts">
// Product coupon download sheet (3-4): applicable coupons with claim state.
// Anonymous buyers see the list and are routed to login on claim.
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { OmModal, OmButton, OmSkeleton, OmErrorState, OmEmptyState, useToast, userErrorMessage, formatNumber } from '@olmoa/ui'
import { useAuthStore } from '../../stores/auth'
import { API_BASE_URL } from '../../config'

const props = defineProps<{ productId: string }>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ remaining: [count: number] }>()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const coupons = ref<any[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const claiming = ref<string | null>(null)

async function load() {
  loading.value = true
  loadError.value = null
  try {
    // P0-2: cookies authenticate (see the fetch wrapper); no header needed.
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${encodeURIComponent(props.productId)}/coupons`)
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '쿠폰을 불러오지 못했습니다')
    coupons.value = Array.isArray(json.data) ? json.data : []
    emit('remaining', coupons.value.filter((x: any) => !x.claimed).length)
  } catch (e: any) {
    loadError.value = userErrorMessage(e, '쿠폰을 불러오지 못했습니다')
  } finally {
    loading.value = false
  }
}

watch(open, (v) => { if (v) void load() })

function discountText(c: any): string {
  if (c.discount_type === 'PERCENT') return `${c.discount_value}%${c.max_discount_amount ? ` (최대 ${formatNumber(c.max_discount_amount)}원)` : ''}`
  return `${formatNumber(c.discount_value)}원`
}

async function claim(c: any) {
  if (!(await auth.ensureSession())) {
    open.value = false
    router.push(`/login?redirect=${encodeURIComponent(route.fullPath)}`)
    return
  }
  claiming.value = c.id
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/coupons/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': `dl-${c.id}-${Date.now()}` },
      body: JSON.stringify({ coupon_id: c.id })
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '쿠폰을 받지 못했습니다')
    coupons.value = coupons.value.map((x) => (x.id === c.id ? { ...x, claimed: true } : x))
    emit('remaining', coupons.value.filter((x: any) => !x.claimed).length)
    toast.success('쿠폰을 받았습니다')
  } catch (e: any) {
    toast.error(userErrorMessage(e, '쿠폰을 받지 못했습니다'))
  } finally {
    claiming.value = null
  }
}
</script>

<template>
  <OmModal v-model:open="open" title="받을 수 있는 쿠폰" data-testid="coupon-modal">
    <div v-if="loading" class="space-y-2"><OmSkeleton :lines="2" :count="3" /></div>
    <OmErrorState v-else-if="loadError" compact :message="loadError" @retry="load" />
    <OmEmptyState v-else-if="!coupons.length" compact title="받을 수 있는 쿠폰이 없습니다" />
    <ul v-else class="space-y-2">
      <li v-for="c in coupons" :key="c.id" class="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-bold text-ink">{{ c.title }}</p>
          <p class="mt-0.5 text-xs text-ink-muted">
            {{ discountText(c) }}<template v-if="Number(c.min_order_amount) > 0"> · {{ formatNumber(c.min_order_amount) }}원 이상</template>
          </p>
        </div>
        <OmButton
          size="sm"
          :variant="c.claimed ? 'ghost' : 'outline'"
          :disabled="!!c.claimed || claiming === c.id"
          :loading="claiming === c.id"
          @click="claim(c)"
        >
          {{ c.claimed ? '받음' : '받기' }}
        </OmButton>
      </li>
    </ul>
  </OmModal>
</template>
