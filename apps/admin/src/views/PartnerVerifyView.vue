<script setup lang="ts">
import { ref } from 'vue';

interface Partner {
  id: string;
  name: string;
  regNo: string;
  date: string;
  rate: string;
  status: 'PENDING' | 'APPROVED';
}

const partners = ref<Partner[]>([
  { id: 'p-1', name: '앤커코리아 공식스토어', regNo: '120-88-99120', date: '2026-10-15', rate: '10%', status: 'PENDING' },
  { id: 'p-2', name: '베이스어스코리아 (주)', regNo: '214-85-11049', date: '2026-10-14', rate: '12%', status: 'APPROVED' },
  { id: 'p-3', name: '노르딕홈 라이프스타일', regNo: '107-82-44912', date: '2026-10-16', rate: '10%', status: 'PENDING' }
]);

const approve = (p: Partner) => {
  p.status = 'APPROVED';
};
</script>

<template>
  <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
    <h2 class="text-base font-bold text-slate-900 border-b pb-3">입점 파트너사 서류 심사 및 승인</h2>
    <div class="overflow-x-auto text-xs">
      <table class="w-full text-left">
        <thead class="bg-slate-50 text-slate-500 uppercase border-b text-[10px]">
          <tr>
            <th class="p-3">파트너 상호명</th>
            <th class="p-3">사업자등록번호</th>
            <th class="p-3">신청일</th>
            <th class="p-3">수수료율</th>
            <th class="p-3">상태</th>
            <th class="p-3 text-right">조치</th>
          </tr>
        </thead>
        <tbody class="divide-y text-slate-700">
          <tr v-for="p in partners" :key="p.id" class="hover:bg-slate-50">
            <td class="p-3 font-bold text-slate-900">{{ p.name }}</td>
            <td class="p-3 font-mono">{{ p.regNo }}</td>
            <td class="p-3 font-mono">{{ p.date }}</td>
            <td class="p-3 font-bold text-blue-600">{{ p.rate }}</td>
            <td class="p-3">
              <span :class="p.status === 'APPROVED' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'" class="px-2 py-0.5 rounded-full text-[10px] font-bold">
                {{ p.status }}
              </span>
            </td>
            <td class="p-3 text-right">
              <button v-if="p.status === 'PENDING'" @click="approve(p)" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1 rounded text-xs transition">
                승인(Approve)
              </button>
              <span v-else class="text-slate-400">승인완료</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
