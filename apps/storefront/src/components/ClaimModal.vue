<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  subOrder: any;
  loading: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'submit', payload: { claimType: 'RETURN' | 'EXCHANGE'; reason: string }): void;
}>();

const claimType = ref<'RETURN' | 'EXCHANGE'>('RETURN');
const claimReason = ref('');

function handleSubmit() {
  if (!claimReason.value.trim()) return;
  emit('submit', { claimType: claimType.value, reason: claimReason.value.trim() });
}
</script>

<template>
  <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 text-xs">
      <div class="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 class="font-bold text-slate-900 text-sm">반품 / 교환 신청</h3>
        <button @click="$emit('close')" class="text-slate-400 hover:text-slate-700 text-base">&times;</button>
      </div>
      <div class="space-y-3">
        <div>
          <label class="block font-bold text-slate-700 mb-1">신청 구분</label>
          <div class="grid grid-cols-2 gap-2">
            <button 
              type="button" 
              @click="claimType = 'RETURN'"
              class="py-2 rounded-xl font-bold border transition"
              :class="claimType === 'RETURN' ? 'border-orange-600 bg-orange-50 text-orange-600' : 'border-slate-200 text-slate-600'"
            >
              90일 무료 반품
            </button>
            <button 
              type="button" 
              @click="claimType = 'EXCHANGE'"
              class="py-2 rounded-xl font-bold border transition"
              :class="claimType === 'EXCHANGE' ? 'border-orange-600 bg-orange-50 text-orange-600' : 'border-slate-200 text-slate-600'"
            >
              상품 맞교환
            </button>
          </div>
        </div>
        <div>
          <label class="block font-bold text-slate-700 mb-1">신청 사유</label>
          <textarea v-model="claimReason" rows="3" placeholder="사유를 상세히 기재해주세요 (예: 단순변심, 사이즈 불일치, 상품 하자 등)" class="w-full p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500"></textarea>
        </div>
      </div>
      <div class="flex gap-2 pt-2">
        <button @click="$emit('close')" class="flex-1 py-2.5 bg-slate-100 text-slate-700 font-bold rounded-xl">취소</button>
        <button @click="handleSubmit" :disabled="loading || !claimReason.trim()" class="flex-1 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-md">
          {{ loading ? '접수 중...' : '신청 접수' }}
        </button>
      </div>
    </div>
  </div>
</template>
