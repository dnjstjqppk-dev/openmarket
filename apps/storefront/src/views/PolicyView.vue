<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, RouterLink } from 'vue-router'

const route = useRoute()
const policyType = computed(() => String(route.params.type || 'terms'))

const policies: Record<string, { title: string; subtitle: string; clauses: string[] }> = {
  'price-match': {
    title: '30-Day Price-Match Adjustment Guarantee',
    subtitle: 'Automatic difference credit if an OLMOA direct deal drops in price within 30 days of purchase.',
    clauses: [
      '1. Eligibility: Any paid order placed on OLMOA where the identical SKU drops in sale price within 30 calendar days.',
      '2. Instant Claim Execution: Visit My Orders → Order Detail → click "30-Day Price-Match Claim" to receive an immediate Olmoa Reward Credit refund.',
      '3. Ledger Transparency: All price-match adjustments are recorded in your immutable Customer Credit Ledger.'
    ]
  },
  'returns': {
    title: '90-Day Free Return & Exchange Guarantee',
    subtitle: 'Zero-fee return pickup on your first return for every qualifying order within 90 days.',
    clauses: [
      '1. 90-Day Window: Items may be returned or exchanged within 90 days of delivery.',
      '2. Free Return Shipping: First return per order includes complimentary courier pickup via CJ Logistics / Lotte Global.',
      '3. Atomic Escrow Refund: Once inspected or approved by Admin/Partner, your payment and SKU stock are atomically reconciled.'
    ]
  },
  'shipping': {
    title: 'Partner-Grouped Split Delivery & On-Time Guarantee',
    subtitle: 'Transparent per-partner shipping calculation and ₩5,000 delay compensation.',
    clauses: [
      '1. Partner Free Shipping Threshold: Orders totaling ₩30,000 or more per partner qualify for FREE shipping (otherwise ₩3,000 base fee per partner).',
      '2. On-Time Compensation: If an order arrives after the guaranteed delivery date, a ₩5,000 compensation credit is issued.'
    ]
  },
  'terms': {
    title: 'Terms of Service (올모아 전자상거래 표준약관)',
    subtitle: 'Compliant with the Korean Act on the Consumer Protection in Electronic Commerce (전자상거래법).',
    clauses: [
      '제1조 (목적): 본 약관은 주식회사 올모아글로벌이 운영하는 오픈마켓 플랫폼(OLMOA)에서 제공하는 전자상거래 관련 서비스의 이용 조건 및 절차를 규정합니다.',
      '제2조 (통신판매중개 및 에스크로 보호): 올모아는 입점 파트너와 구매자 간의 안전한 거래를 위해 모든 결제 건에 대해 결제대금예치(에스크로) 및 구매확정 정산 프로세스를 적용합니다.',
      '제3조 (청약철회 및 최저가 보상): 소비자는 전자상거래법 및 올모아 특약에 따라 90일 무료반품 및 30일 최저가 차액보상을 신청할 수 있습니다.'
    ]
  },
  'privacy': {
    title: 'Privacy Policy (개인정보처리방침)',
    subtitle: 'Strict zero-trust data protection and minimal PII retention policy.',
    clauses: [
      '1. 수집하는 개인정보 항목: 주문자 성명, 배송지 주소, 연락처, 결제 및 정산 원장 식별자.',
      '2. 개인정보의 보유 및 파기: 전자상거래법상 계약·청약철회 및 대금결제 기록은 5년간 안전하게 암호화 보관 후 즉시 파기합니다.',
      '3. 보안 헤더 및 접근 통제: Cloudflare Edge Gateway에서 X-Content-Type-Options, X-Frame-Options, Customer Ownership Guard를 강제합니다.'
    ]
  },
  'escrow': {
    title: 'Escrow Purchase Safety Guarantee (결제대금예치 안내)',
    subtitle: '100% escrow hold until customer delivery & purchase confirmation.',
    clauses: [
      '1. Escrow Protection: Seller payouts remain in PENDING state in the Partner Settlement Ledger until delivery is verified.',
      '2. +1% Confirmation Reward: When you click "Confirm Purchase" on your delivered order, you immediately earn 1% of the order total in Olmoa Credits.'
    ]
  }
}

const currentPolicy = computed(() => policies[policyType.value] || policies['terms'])
</script>

<template>
  <div class="max-w-[900px] mx-auto px-4 sm:px-6 py-10">
    <div class="bg-white rounded-3xl p-6 sm:p-10 border border-gray-200/80 shadow-xs">
      <div class="flex flex-wrap gap-2 mb-6">
        <RouterLink
          v-for="(val, key) in policies"
          :key="key"
          :to="`/policy/${key}`"
          :class="['px-3 py-1.5 rounded-full text-xs font-bold transition-colors', policyType === key ? 'bg-[#FF5000] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200']"
        >
          {{ val.title.split('(')[0].trim() }}
        </RouterLink>
      </div>

      <h1 class="text-2xl sm:text-3xl font-black text-gray-900 mb-2">{{ currentPolicy.title }}</h1>
      <p class="text-xs sm:text-sm text-gray-500 mb-6 pb-4 border-b border-gray-100">{{ currentPolicy.subtitle }}</p>

      <div class="space-y-4 text-xs sm:text-sm text-gray-700 leading-relaxed">
        <p v-for="(clause, i) in currentPolicy.clauses" :key="i" class="p-4 rounded-xl bg-gray-50 border border-gray-100">
          {{ clause }}
        </p>
      </div>
    </div>
  </div>
</template>
