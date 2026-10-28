<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { API_BASE, getPartnerHeaders } from '../config';

interface QnAItem {
  id: string;
  product_id: string;
  product_title?: string;
  questioner_name: string;
  question: string;
  answer?: string;
  is_secret: number;
  status: 'WAITING' | 'ANSWERED';
  answered_at?: string;
  created_at: string;
}

const qnaList = ref<QnAItem[]>([]);
const loading = ref(true);
const activeTab = ref<'ALL' | 'WAITING' | 'ANSWERED'>('WAITING');
const answeringId = ref<string | null>(null);
const answerText = ref('');
const isSubmitting = ref(false);
const toastMsg = ref('');

const filteredList = computed(() => {
  if (activeTab.value === 'WAITING') {
    return qnaList.value.filter(q => q.status === 'WAITING');
  }
  if (activeTab.value === 'ANSWERED') {
    return qnaList.value.filter(q => q.status === 'ANSWERED');
  }
  return qnaList.value;
});

const waitingCount = computed(() => qnaList.value.filter(q => q.status === 'WAITING').length);
const answeredCount = computed(() => qnaList.value.filter(q => q.status === 'ANSWERED').length);

async function loadQnA() {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/v1/partner/qna`, {
      headers: getPartnerHeaders()
    });
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      qnaList.value = json.data;
    }
  } catch (e) {
    console.error('Failed to load QnA list:', e);
  } finally {
    loading.value = false;
  }
}

function openAnswerBox(q: QnAItem) {
  answeringId.value = q.id;
  answerText.value = q.answer || '';
}

async function submitAnswer(qnaId: string) {
  if (!answerText.value.trim()) return;
  isSubmitting.value = true;

  try {
    const res = await fetch(`${API_BASE}/api/v1/partner/qna/${qnaId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getPartnerHeaders() },
      body: JSON.stringify({ answer: answerText.value.trim() })
    });
    const json = await res.json();
    if (json.success) {
      toastMsg.value = '✓ 답변이 등록되어 상품 상세 페이지에 즉시 노출됩니다.';
      answeringId.value = null;
      answerText.value = '';
      await loadQnA();
      setTimeout(() => { toastMsg.value = ''; }, 3000);
    }
  } catch (e) {
    console.error(e);
  } finally {
    isSubmitting.value = false;
  }
}

onMounted(loadQnA);
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
      <div>
        <h1 class="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
          <span>💬 고객 상품 문의(Q&A) 관리</span>
          <span v-if="waitingCount > 0" class="text-xs px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-black animate-pulse">
            미답변 {{ waitingCount }}건
          </span>
        </h1>
        <p class="text-xs text-slate-500 mt-1">
          고객의 상품 상세 문의에 빠르게 답변하여 구매 전환율을 높이고 브랜드 신뢰도를 확보하세요.
        </p>
      </div>

      <!-- Tab Buttons -->
      <div class="flex items-center gap-1.5 self-start sm:self-auto">
        <button
          @click="activeTab = 'WAITING'"
          :class="[
            'px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer',
            activeTab === 'WAITING' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
          ]"
        >
          답변 대기 ({{ waitingCount }})
        </button>
        <button
          @click="activeTab = 'ANSWERED'"
          :class="[
            'px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer',
            activeTab === 'ANSWERED' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
          ]"
        >
          답변 완료 ({{ answeredCount }})
        </button>
        <button
          @click="activeTab = 'ALL'"
          :class="[
            'px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer',
            activeTab === 'ALL' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
          ]"
        >
          전체 ({{ qnaList.length }})
        </button>
      </div>
    </div>

    <div v-if="toastMsg" class="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-700 flex items-center gap-2 shadow-xs">
      <i class="fa-solid fa-circle-check"></i>
      <span>{{ toastMsg }}</span>
    </div>

    <div v-if="loading" class="p-16 text-center text-slate-400">
      <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-indigo-500"></i>
      <p class="text-xs font-bold">고객 Q&A 문의 내역을 불러오는 중입니다...</p>
    </div>

    <div v-else-if="filteredList.length === 0" class="bg-white rounded-2xl p-12 text-center border border-slate-200 shadow-xs">
      <div class="text-3xl mb-2">💬</div>
      <h3 class="font-bold text-slate-700 text-sm">해당 조건의 고객 문의가 없습니다.</h3>
      <p class="text-xs text-slate-400 mt-1">고객이 상품에 문의를 남기면 실시간으로 수신됩니다.</p>
    </div>

    <div v-else class="space-y-4">
      <div
        v-for="q in filteredList"
        :key="q.id"
        class="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3"
      >
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
          <div class="flex items-center gap-2 text-xs">
            <span
              :class="[
                'px-2 py-0.5 rounded-full text-[10px] font-black',
                q.status === 'ANSWERED' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
              ]"
            >
              {{ q.status === 'ANSWERED' ? '✓ 답변완료' : '● 답변대기' }}
            </span>
            <span class="font-bold text-slate-900">{{ q.product_title || '상품 문의' }}</span>
            <span class="text-slate-400">•</span>
            <span class="text-slate-500 font-medium">{{ q.questioner_name }}</span>
            <span v-if="q.is_secret" class="text-amber-600 text-[11px] font-bold">🔒 비밀글</span>
          </div>
          <span class="text-[11px] text-slate-400 font-mono">{{ new Date(q.created_at).toLocaleString() }}</span>
        </div>

        <!-- Question Body -->
        <div class="p-3 bg-slate-50 rounded-xl text-xs space-y-1">
          <p class="font-bold text-slate-700 flex items-center gap-1.5">
            <span class="text-indigo-600 font-black">Q.</span>
            <span>{{ q.question }}</span>
          </p>
        </div>

        <!-- Answer Body (if answered) -->
        <div v-if="q.answer && answeringId !== q.id" class="p-3 bg-indigo-50/60 rounded-xl text-xs space-y-1 border border-indigo-100">
          <div class="flex items-center justify-between">
            <span class="font-bold text-indigo-900 flex items-center gap-1.5">
              <span class="text-[#FF5000] font-black">A.</span>
              <span>판매자 공식 답변:</span>
            </span>
            <button
              @click="openAnswerBox(q)"
              class="text-[11px] font-bold text-indigo-600 hover:underline cursor-pointer"
            >
              답변 수정
            </button>
          </div>
          <p class="text-slate-800 whitespace-pre-wrap pl-4">{{ q.answer }}</p>
          <p v-if="q.answered_at" class="text-[10px] text-slate-400 pl-4 font-mono">답변일시: {{ new Date(q.answered_at).toLocaleString() }}</p>
        </div>

        <!-- Inline Answer Editor -->
        <div v-if="answeringId === q.id" class="space-y-2 pt-2 border-t border-slate-100">
          <textarea
            v-model="answerText"
            rows="3"
            placeholder="고객 문의에 대한 친절하고 정확한 답변을 입력해 주세요..."
            class="w-full border border-indigo-300 rounded-xl p-3 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
          ></textarea>
          <div class="flex justify-end gap-2">
            <button
              @click="answeringId = null"
              class="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              취소
            </button>
            <button
              @click="submitAnswer(q.id)"
              :disabled="isSubmitting || !answerText.trim()"
              class="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {{ isSubmitting ? '등록 중...' : '답변 등록 완료' }}
            </button>
          </div>
        </div>

        <div v-else-if="!q.answer" class="pt-1 flex justify-end">
          <button
            @click="openAnswerBox(q)"
            class="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition cursor-pointer flex items-center gap-1"
          >
            <i class="fa-solid fa-reply"></i>
            <span>답변 작성하기</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

