<template>
  <!-- DRAFT: aligned with the implemented system behaviour; final text requires legal review (reports/v3/F_COMMERCIAL_VERDICT.md §법률). -->
  <div class="mx-auto max-w-4xl space-y-6 rounded-3xl border border-line bg-surface p-8 text-xs leading-relaxed text-ink-muted sm:p-12 sm:text-sm">
    <div role="note" class="rounded-xl border border-warning bg-warning-soft p-3 text-xs font-bold text-warning">본 문서는 법률 검토 전 초안입니다. 정식 서비스 개시 전 확정됩니다.</div>
    <div class="border-b border-line pb-4">
      <h1 class="text-2xl font-bold text-ink">취소 · 반품 · 환불 안내</h1>
      <p class="mt-1 text-xs text-ink-subtle">시행일자: {{ EFFECTIVE_DATE }} · 현행 {{ VERSION }}</p>
    </div>

    <nav class="rounded-2xl border border-line bg-surface-2 p-4" aria-label="목차">
      <p class="mb-2 text-xs font-bold text-ink">목차</p>
      <ol class="grid gap-1 text-xs sm:grid-cols-2">
        <li v-for="t in TOC" :key="t.id"><a :href="`#${t.id}`" class="text-ink-muted hover:text-primary hover:underline">{{ t.label }}</a></li>
      </ol>
    </nav>

    <section id="a1" class="scroll-mt-24 space-y-2">
      <h2 class="text-base font-bold text-ink">1. 결제 전 주문</h2>
      <p>결제가 완료되지 않은 주문은 언제든 취소할 수 있으며, 주문 후 30분 내 결제가 이루어지지 않으면 자동 취소됩니다. 이때 사용한 쿠폰과 적립금은 즉시 복원됩니다.</p>
    </section>
    <section id="a2" class="scroll-mt-24 space-y-2">
      <h2 class="text-base font-bold text-ink">2. 출고 전 취소</h2>
      <p>판매자가 상품을 출고하기 전에는 주문 전체 또는 판매자별로 취소할 수 있습니다. 결제 금액은 원래의 결제수단으로, 사용한 적립금은 적립금으로 환불됩니다. 주문 전체 취소 시 사용한 쿠폰도 복원됩니다.</p>
    </section>
    <section id="a3" class="scroll-mt-24 space-y-2">
      <h2 class="text-base font-bold text-ink">3. 반품(청약철회)</h2>
      <p>상품을 받은 날부터 7일 이내에 반품을 신청할 수 있습니다(전자상거래 등에서의 소비자보호에 관한 법률 제17조). 반품 신청 후 판매자가 상품 회수·확인을 마치면 환불이 진행됩니다. 단순 변심에 의한 반품의 경우 반품 배송비가 부과될 수 있으며, 구체적인 금액은 판매자별로 상이합니다.</p>
      <p>환불 금액은 해당 상품에 실제로 결제된 금액(쿠폰 할인·적립금 사용분을 상품별로 배분한 금액)을 기준으로 계산됩니다.</p>
    </section>
    <section id="a4" class="scroll-mt-24 space-y-2">
      <h2 class="text-base font-bold text-ink">4. 환불 시기</h2>
      <p>환불 사유 확정 후 3영업일 이내에 결제 취소를 요청합니다. 카드사·결제사 사정에 따라 실제 반영까지 추가 기간이 소요될 수 있습니다.</p>
    </section>
    <section id="a5" class="scroll-mt-24 space-y-2">
      <h2 class="text-base font-bold text-ink">5. 판매 주체</h2>
      <p>'올모아 직영' 상품은 운영 사업자가 판매자이며, 입점 판매자 상품은 각 판매자가 반품·환불의 당사자입니다. 판매자 정보는 상품 상세 및 주문 상세에서 확인할 수 있습니다.</p>
    </section>

    <section id="versions" class="scroll-mt-24 space-y-2 rounded-2xl border border-line bg-surface-2 p-4">
      <h2 class="text-sm font-bold text-ink">이전 버전</h2>
      <p class="text-xs">현행 {{ VERSION }} (시행 {{ EFFECTIVE_DATE }}). 개정 이력이 생기면 이전 버전을 이곳에서 볼 수 있습니다.</p>
    </section>

    <div class="flex gap-4 border-t border-line pt-4 text-[11px] text-ink-subtle">
      <router-link to="/legal/terms" class="hover:text-ink">이용약관</router-link>
      <router-link to="/legal/privacy" class="hover:text-ink">개인정보처리방침</router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
const EFFECTIVE_DATE = '2026년 1월 1일'
const VERSION = 'v1.0'
const TOC = [
  { id: 'a1', label: '1. 결제 전 주문' },
  { id: 'a2', label: '2. 출고 전 취소' },
  { id: 'a3', label: '3. 반품(청약철회)' },
  { id: 'a4', label: '4. 환불 시기' },
  { id: 'a5', label: '5. 판매 주체' },
  { id: 'versions', label: '이전 버전' }
]
</script>
