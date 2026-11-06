<script setup lang="ts">
// Buyer policy pages (PHASE 2 redesign). Every number here is a server rule, with its source:
//   배송 지연 보상 5,300원         routes/temu-ops.js LATE_COMPENSATION_KRW (sub-order past estimated_delivery_date)
//   기본 배송비 3,000 / 30,000원    services/orders.js defaults; each seller sets its own (partners.base_shipping_fee, …)
//   판매가 인하 차액 30일, 주문당 1회  routes/orders.js PRICE_ADJUST_WINDOW_DAYS, ALREADY_ADJUSTED
//   구매확정 1% 적립(직접 확정 시)     services/orders.js applyBps(paid, 100), 0 on auto-confirm
// The previous version promised a 90-day free return with free courier pickup, "100% escrow", and named a
// corporation ("주식회사 올모아글로벌") although the operator entity is configurable and currently not a
// corporation (V3 directive: never hardcode the entity). Those texts are removed; terms/privacy/returns live on
// the /legal/* pages, and the operator / escrow facts come from /business-info.
// DRAFT — final wording requires legal review (same status as the /legal/* pages).
import { computed, ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { OmBreadcrumb, OmAlert, OmEmptyState, OmButton, OmSkeleton } from '@olmoa/ui'
import { API_BASE_URL } from '../config'

const route = useRoute()
const router = useRouter()
const type = computed(() => String(route.params.type || ''))

// Old URLs that now have a proper legal page.
const MOVED: Record<string, string> = { terms: '/legal/terms', privacy: '/legal/privacy', returns: '/legal/refund', refund: '/legal/refund' }
function redirectIfMoved() { if (MOVED[type.value]) router.replace(MOVED[type.value]) }
onMounted(redirectIfMoved)
watch(type, redirectIfMoved)

interface Section { heading: string; body: string[] }
const POLICIES: Record<string, { title: string; summary: string; sections: Section[] }> = {
  shipping: {
    title: '배송 정책',
    summary: '배송비는 판매자(직영·입점)마다 다르며, 한 주문에 여러 판매자의 상품이 있으면 판매자별로 따로 계산됩니다.',
    sections: [
      { heading: '배송비와 무료배송 기준', body: [
        '각 판매자가 기본 배송비와 무료배송 기준 금액을 정합니다. 판매자가 따로 정하지 않은 경우 기본 배송비 3,000원, 같은 판매자 상품 30,000원 이상 구매 시 무료입니다.',
        '판매자별 기준은 판매자 스토어, 장바구니, 주문서에서 확인할 수 있으며, 주문서에 표시된 금액이 실제 결제 금액입니다.'
      ] },
      { heading: '배송 지연 보상', body: [
        '판매자 출고 단위(부분 주문)의 배송 예정일이 지났는데 배송이 완료되지 않았거나, 예정일 이후에 배송이 완료된 경우 주문 상세에서 보상을 신청할 수 있습니다.',
        '해당 부분 주문마다 5,300원이 적립금으로 지급되며, 같은 부분 주문은 한 번만 보상됩니다. 취소·만료되었거나 결제 대기 중인 주문은 대상이 아닙니다.'
      ] }
    ]
  },
  'price-match': {
    title: '판매가 인하 차액 보상',
    summary: '결제 후 30일 이내에 구매한 옵션(SKU)의 판매가가 내려가면, 그 차액을 적립금으로 받을 수 있습니다.',
    sections: [
      { heading: '대상', body: [
        '결제가 완료된 주문(일부 환불된 주문 포함)으로, 결제 시각으로부터 30일 이내에 신청한 경우입니다.',
        '구매한 것과 같은 옵션의 현재 판매가(수량 할인 적용 후)가 구매 단가보다 낮을 때만 지급되며, 환불된 수량은 제외됩니다.'
      ] },
      { heading: '신청과 지급', body: [
        '주문 상세에서 신청하면 차액이 즉시 계산되어 적립금으로 지급됩니다. 주문당 한 번만 신청할 수 있습니다.',
        '인하가 확인되지 않으면 지급되지 않으며, 다른 판매자·다른 옵션의 가격과는 비교하지 않습니다.'
      ] }
    ]
  },
  'purchase-confirm': {
    title: '구매확정 적립',
    summary: '배송 완료된 주문을 직접 구매확정하면 실제 결제 금액의 1%가 적립금으로 지급됩니다.',
    sections: [
      { heading: '지급 기준', body: [
        '판매자 출고 단위(부분 주문)별로 결제된 금액의 1%를 지급합니다. 배송 완료 후 일정 기간이 지나 자동으로 구매확정된 경우에는 지급되지 않습니다.',
        '구매확정 후에는 반품을 신청할 수 없습니다.'
      ] }
    ]
  }
}
const policy = computed(() => POLICIES[type.value] || null)

// Escrow / 구매안전서비스: only what the operator has registered (business-info).
const biz = ref<any>(null)
const bizLoaded = ref(false)
onMounted(() => {
  fetch(`${API_BASE_URL}/api/v1/business-info`).then((r) => r.json()).then((j) => { biz.value = j?.configured ? j.data : null }).catch(() => { biz.value = null }).finally(() => { bizLoaded.value = true })
})
const crumbs = computed(() => [{ label: '홈', to: '/' }, { label: type.value === 'escrow' ? '구매안전서비스' : policy.value?.title || '안내' }])
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
    <OmBreadcrumb :items="crumbs" />

    <article v-if="policy" class="mt-3 rounded-xl border border-line bg-surface p-6 sm:p-8">
      <h1 class="text-2xl font-bold text-ink">{{ policy.title }}</h1>
      <p class="mt-2 text-md text-ink-muted">{{ policy.summary }}</p>
      <section v-for="s in policy.sections" :key="s.heading" class="mt-6 border-t border-line-divider pt-5">
        <h2 class="text-lg font-semibold text-ink">{{ s.heading }}</h2>
        <p v-for="(b, i) in s.body" :key="i" class="mt-2 text-sm leading-relaxed text-ink">{{ b }}</p>
      </section>
      <OmAlert tone="warning" class="mt-6">본 안내는 법률 검토 전 초안이며, 정식 서비스 개시 전 확정됩니다. 실제 지급·환불은 위 기준에 따라 시스템이 계산한 금액으로 처리됩니다.</OmAlert>
      <nav class="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted" aria-label="관련 안내">
        <RouterLink v-for="(p, k) in POLICIES" v-show="k !== type" :key="k" :to="`/policy/${k}`" class="hover:text-ink">{{ p.title }}</RouterLink>
        <RouterLink to="/legal/refund" class="hover:text-ink">취소·반품·환불</RouterLink>
        <RouterLink to="/legal/terms" class="hover:text-ink">이용약관</RouterLink>
      </nav>
    </article>

    <article v-else-if="type === 'escrow'" class="mt-3 rounded-xl border border-line bg-surface p-6 sm:p-8">
      <h1 class="text-2xl font-bold text-ink">구매안전서비스</h1>
      <OmSkeleton v-if="!bizLoaded" class="mt-4" :lines="2" />
      <template v-else-if="biz?.escrow_service_ref">
        <p class="mt-3 text-sm leading-relaxed text-ink">{{ biz.legal_name }}는 다음 구매안전서비스에 가입되어 있습니다: <strong>{{ biz.escrow_service_ref }}</strong></p>
        <p class="mt-2 text-sm leading-relaxed text-ink-muted">입점 판매자의 판매대금은 구매확정(또는 배송 완료 후 자동 확정) 이후 정산됩니다.</p>
      </template>
      <OmAlert v-else tone="warning" class="mt-4">운영 사업자의 구매안전서비스 정보가 아직 등록되지 않았습니다.</OmAlert>
    </article>

    <OmEmptyState v-else-if="!MOVED[type]" class="mt-6" title="안내 페이지를 찾을 수 없습니다">
      <OmButton to="/policy/shipping" variant="outline" size="sm">배송 정책</OmButton>
      <OmButton to="/legal/refund" variant="ghost" size="sm">취소·반품·환불</OmButton>
    </OmEmptyState>
  </div>
</template>
