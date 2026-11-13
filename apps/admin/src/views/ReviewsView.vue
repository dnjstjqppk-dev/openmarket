<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { API_BASE_URL, getAdminHeaders } from '../config';
import { useConfirm } from '@olmoa/ui'

const { confirm } = useConfirm()

interface AdminReview {
  id: string;
  product_id: string;
  product_title?: string;
  reviewer_name: string;
  rating: number;
  content: string;
  created_at: string;
}

const reviews = ref<AdminReview[]>([]);
const loading = ref(true);
// A-N04: the moderator reads the full text in a modal before deleting.
const selectedReview = ref<AdminReview | null>(null);

async function loadReviews() {
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/reviews`, {
      headers: getAdminHeaders()
    });
    const json = await res.json();
    if (json.success && json.data) {
      reviews.value = json.data;
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
}

async function deleteReview(id: string) {
  if (!(await confirm({ title: '리뷰 삭제', body: '이 리뷰를 삭제하시겠습니까?', danger: true }))) return;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/reviews/${id}`, {
      method: 'DELETE',
      headers: getAdminHeaders()
    });
    if (res.ok) {
      reviews.value = reviews.value.filter(r => r.id !== id);
    }
  } catch (_) {
  }
}

onMounted(loadReviews);
</script>

<template>
  <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
    <div class="flex items-center justify-between border-b pb-3">
      <div>
        <h2 class="text-base font-bold text-slate-900">리뷰 모더레이션</h2>
        <p class="text-xs text-slate-500 mt-0.5">고객 리뷰를 조회하고 부적절한 콘텐츠를 삭제합니다.</p>
      </div>
      <button @click="loadReviews" class="text-xs text-indigo-600 font-bold hover:underline">
        <RotateCw class="h-4 w-4 mr-1" aria-hidden="true" />새로고침
      </button>
    </div>

    <div v-if="loading" class="p-12 text-center text-slate-400 text-xs">
      <LoaderCircle class="h-4 w-4 animate-spin mr-2" aria-hidden="true" />리뷰 목록을 불러오는 중...
    </div>

    <div v-else class="overflow-x-auto text-xs">
      <table class="w-full text-left">
        <thead class="bg-slate-50 text-slate-500 uppercase border-b text-[10px]">
          <tr>
            <th class="p-3">상품</th>
            <th class="p-3">작성자</th>
            <th class="p-3">평점</th>
            <th class="p-3">내용</th>
            <th class="p-3">작성일</th>
            <th class="p-3">관리</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="r in reviews" :key="r.id" class="hover:bg-slate-50">
            <td class="p-3 text-slate-700">{{ r.product_title || r.product_id }}</td>
            <td class="p-3 font-bold text-slate-900">{{ r.reviewer_name }}</td>
            <td class="p-3 text-amber-500 font-bold">{{ r.rating }} ★</td>
            <td class="p-3 text-slate-600 max-w-xs truncate" :title="r.content">{{ r.content }}</td>
            <td class="p-3 text-slate-400">{{ new Date(r.created_at).toLocaleString() }}</td>
            <td class="p-3 whitespace-nowrap">
              <button @click="selectedReview = r" class="text-indigo-600 font-bold hover:underline mr-3">전체보기</button>
              <button @click="deleteReview(r.id)" class="text-rose-600 font-bold hover:underline">삭제</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="reviews.length === 0" class="p-8 text-center text-slate-400">
        등록된 리뷰가 없습니다.
      </div>
    </div>

    <div v-if="selectedReview" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" @click.self="selectedReview = null">
      <div class="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-3 text-xs">
        <div class="flex items-start justify-between gap-3">
          <h3 class="text-sm font-black text-slate-900">리뷰 전문</h3>
          <button @click="selectedReview = null" class="text-slate-400 hover:text-slate-700 font-bold">닫기</button>
        </div>
        <dl class="space-y-1 text-slate-600">
          <div><dt class="inline font-bold text-slate-800">상품: </dt><dd class="inline">{{ selectedReview.product_title || selectedReview.product_id }}</dd></div>
          <div><dt class="inline font-bold text-slate-800">작성자: </dt><dd class="inline">{{ selectedReview.reviewer_name }}</dd></div>
          <div><dt class="inline font-bold text-slate-800">평점: </dt><dd class="inline text-amber-500 font-bold">{{ selectedReview.rating }} ★</dd></div>
          <div><dt class="inline font-bold text-slate-800">작성일: </dt><dd class="inline">{{ new Date(selectedReview.created_at).toLocaleString() }}</dd></div>
        </dl>
        <p class="whitespace-pre-wrap rounded-xl bg-slate-50 border border-slate-200 p-3 text-slate-800">{{ selectedReview.content }}</p>
        <div class="flex justify-end gap-2">
          <button @click="selectedReview = null" class="px-4 py-2 rounded-lg border border-slate-300 font-bold hover:bg-slate-50">닫기</button>
          <button @click="deleteReview(selectedReview.id); selectedReview = null" class="px-4 py-2 rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700">이 리뷰 삭제</button>
        </div>
      </div>
    </div>
  </div>
</template>