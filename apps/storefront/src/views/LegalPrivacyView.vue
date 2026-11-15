<template>
  <div class="mx-auto max-w-4xl space-y-6 rounded-3xl border border-line bg-surface p-8 text-xs leading-relaxed text-ink-muted sm:p-12 sm:text-sm">
    <div role="note" class="rounded-xl border border-warning bg-warning-soft p-3 text-xs font-bold text-warning">본 문서는 법률 검토 전 초안이며 일부 내용은 실제 서비스 정책과 다를 수 있습니다. 정식 서비스 개시 전 확정됩니다.</div>
    <div class="border-b border-line pb-4">
      <span class="text-xs font-bold uppercase tracking-wider text-primary">OLMOA Privacy Policy</span>
      <h1 class="mt-1 text-2xl font-bold text-ink">개인정보처리방침</h1>
      <p class="mt-1 text-xs text-ink-subtle">시행일자: {{ EFFECTIVE_DATE }} (개인정보보호법 및 정보통신망법 준수) · 현행 {{ VERSION }}</p>
    </div>

    <nav class="rounded-2xl border border-line bg-surface-2 p-4" aria-label="목차">
      <p class="mb-2 text-xs font-bold text-ink">목차</p>
      <ol class="grid gap-1 text-xs sm:grid-cols-2">
        <li v-for="t in TOC" :key="t.id"><a :href="`#${t.id}`" class="text-ink-muted hover:text-primary hover:underline">{{ t.label }}</a></li>
      </ol>
    </nav>

    <section id="a1" class="scroll-mt-24 space-y-2">
      <h2 class="text-base font-bold text-ink">1. 수집하는 개인정보 항목 및 수집방법</h2>
      <p>회사는 회원가입, 원활한 고객상담, 각종 서비스의 제공을 위해 최초 회원가입 또는 주문서 작성 당시 아래와 같은 최소한의 개인정보를 수집하고 있습니다.</p>
      <ul class="list-inside list-disc space-y-1 text-ink-muted">
        <li><strong>주문 및 배송:</strong> 수령인 성명, 휴대전화번호, 배송지 주소, 통관고유부호(해외직구 시)</li>
        <li><strong>결제:</strong> 신용카드 정보, 계좌번호, 결제 수단 승인 식별값</li>
        <li><strong>서비스 이용과정 자동수집:</strong> IP주소, 쿠키, 접속로그, 기기정보</li>
      </ul>
    </section>

    <section id="a2" class="scroll-mt-24 space-y-2">
      <h2 class="text-base font-bold text-ink">2. 개인정보의 수집 및 이용목적</h2>
      <p>수집된 개인정보는 계약의 이행, 물품배송 및 대금결제, 고객상담 및 불만처리, 맞춤형 서비스 제공 및 통계 분석에 한하여 이용됩니다.</p>
    </section>

    <section id="a3" class="scroll-mt-24 space-y-2">
      <h2 class="text-base font-bold text-ink">3. 개인정보의 보유 및 이용기간</h2>
      <p>전자상거래 등에서의 소비자보호에 관한 법률 등 관련 법령에 의하여 보존할 필요가 있는 경우 다음과 같이 법정 기간 동안 보관합니다.</p>
      <ul class="list-inside list-disc space-y-1 text-ink-muted">
        <li>계약 또는 청약철회 등에 관한 기록: 5년</li>
        <li>대금결제 및 재화 등의 공급에 관한 기록: 5년</li>
        <li>소비자의 불만 또는 분쟁처리에 관한 기록: 3년</li>
      </ul>
    </section>

    <section id="a4" class="scroll-mt-24 space-y-2">
      <h2 class="text-base font-bold text-ink">4. 개인정보보호 책임자</h2>
      <p v-if="business.info?.privacy_officer_name || business.info?.privacy_officer_email" data-testid="privacy-officer">
        개인정보 보호책임자: {{ business.info?.privacy_officer_name || '이름 미등록' }} / {{ business.info?.privacy_officer_email || '이메일 미등록' }}
      </p>
      <p v-else-if="business.loaded" data-testid="privacy-officer-missing">개인정보 보호책임자 정보가 아직 등록되지 않았습니다. 정식 서비스 개시 전 확정됩니다.</p>
      <p v-else>개인정보 보호책임자 정보를 불러오는 중입니다…</p>
    </section>

    <section id="versions" class="scroll-mt-24 space-y-2 rounded-2xl border border-line bg-surface-2 p-4">
      <h2 class="text-sm font-bold text-ink">이전 버전</h2>
      <p class="text-xs">현행 {{ VERSION }} (시행 {{ EFFECTIVE_DATE }}). 개정 이력이 생기면 이전 버전을 이곳에서 볼 수 있습니다.</p>
    </section>

    <div class="flex items-center justify-between border-t border-line pt-6 text-xs text-ink-muted">
      <router-link to="/" class="font-bold text-primary hover:underline">&larr; 홈으로 돌아가기</router-link>
      <div class="space-x-3">
        <router-link to="/legal/terms" class="hover:text-ink">이용약관</router-link>
        <router-link to="/legal/refund" class="hover:text-ink">취소·반품·환불 안내</router-link>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// P2-S16: the officer contact comes from /business-info via the shared store (never hardcoded).
import { onMounted } from 'vue'
import { useBusinessStore } from '../stores/business'

const EFFECTIVE_DATE = '2026년 1월 1일'
const VERSION = 'v1.0'
const TOC = [
  { id: 'a1', label: '1. 수집하는 개인정보 항목 및 수집방법' },
  { id: 'a2', label: '2. 개인정보의 수집 및 이용목적' },
  { id: 'a3', label: '3. 개인정보의 보유 및 이용기간' },
  { id: 'a4', label: '4. 개인정보보호 책임자' },
  { id: 'versions', label: '이전 버전' }
]

const business = useBusinessStore()
onMounted(() => { business.load() })
</script>
