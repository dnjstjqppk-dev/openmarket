<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { API_BASE_URL, getAdminHeaders } from '../config';

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
  if (!confirm('이 리뷰를 삭제하시겠습니까?')) return;
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
        <i class="fa-solid fa-rotate mr-1"></i>새로고침
      </button>
    </div>

    <div v-if="loading" class="p-12 text-center text-slate-400 text-xs">
      <i class="fa-solid fa-spinner fa-spin mr-2"></i>리뷰 목록을 불러오는 중...
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
            <td class="p-3 text-slate-600 max-w-xs truncate">{{ r.content }}</td>
            <td class="p-3 text-slate-400">{{ new Date(r.created_at).toLocaleString() }}</td>
            <td class="p-3">
              <button @click="deleteReview(r.id)" class="text-rose-600 font-bold hover:underline">삭제</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="reviews.length === 0" class="p-8 text-center text-slate-400">
        등록된 리뷰가 없습니다.
      </div>
    </div>
  </div>
</template>