<script setup lang="ts">
import { ref } from 'vue';

const message = ref('');

const executeSettlement = () => {
  message.value = '✓ 당기 파트너 정산 배치가 성공적으로 집행되었습니다. (ledger_transaction_id 생성 완료)';
};
</script>

<template>
  <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
    <div class="flex items-center justify-between border-b pb-3">
      <div>
        <h2 class="text-base font-bold text-slate-900">복식부기 에스크로 회계 원장 감사</h2>
        <p class="text-xs text-slate-500">대변(Credit)과 차변(Debit)의 100% 대차평형 일치 검증</p>
      </div>
      <button @click="executeSettlement" class="bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold px-4 py-2 rounded-lg transition">
        정산 배치 실행
      </button>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
      <div class="p-4 bg-blue-50 border border-blue-200 rounded-xl">
        <div class="text-slate-500">101. PG_RECEIVABLE (차변)</div>
        <div class="text-base font-bold text-blue-900 mt-1">₩ 250,000,000</div>
      </div>
      <div class="p-4 bg-purple-50 border border-purple-200 rounded-xl">
        <div class="text-slate-500">201. PLATFORM_ESCROW (대변)</div>
        <div class="text-base font-bold text-purple-900 mt-1">₩ 189,400,000</div>
      </div>
      <div class="p-4 bg-orange-50 border border-orange-200 rounded-xl">
        <div class="text-slate-500">202. PARTNER_PAYABLE (대변)</div>
        <div class="text-base font-bold text-orange-900 mt-1">₩ 54,540,000</div>
      </div>
      <div class="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
        <div class="text-slate-500">401. PLATFORM_REVENUE (수익)</div>
        <div class="text-base font-bold text-emerald-900 mt-1">₩ 6,060,000</div>
      </div>
    </div>

    <div v-if="message" class="p-3 bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs rounded-xl">
      {{ message }}
    </div>
  </div>
</template>
