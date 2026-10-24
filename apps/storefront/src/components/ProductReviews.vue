<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { API_BASE_URL } from '../config';

const props = defineProps<{ productId: string }>();

const reviews = ref<any[]>([]);
const avgRating = ref(4.8);
const reviewCount = ref(0);
const loading = ref(true);

const isWriting = ref(false);
const newRating = ref(5);
const newReviewer = ref('');
const newContent = ref('');
const submitLoading = ref(false);
const submitMessage = ref('');

async function loadReviews() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${props.productId}/reviews`);
    if (res.ok) {
      const json = await res.json();
      reviews.value = json.data || [];
      avgRating.value = json.avg_rating || 4.8;
      reviewCount.value = json.review_count || reviews.value.length;
    }
  } catch (_) {}
  finally {
    loading.value = false;
  }
}

async function submitReview() {
  if (!newContent.value.trim()) return;
  submitLoading.value = true;
  submitMessage.value = '';

  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${props.productId}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reviewer_name: newReviewer.value || '구매자',
        rating: newRating.value,
        content: newContent.value,
        sku_option_summary: '기본 구매'
      })
    });
    if (res.ok) {
      submitMessage.value = '리뷰가 성공적으로 등록되었습니다!';
      newContent.value = '';
      isWriting.value = false;
      await loadReviews();
    }
  } catch (_) {}
  finally {
    submitLoading.value = false;
  }
}

onMounted(() => {
  loadReviews();
});
</script>

<template>
  <div class="space-y-6 pt-6 border-t border-slate-200">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-base font-bold text-slate-900">실구매자 상품평 ({{ reviewCount }})</h3>
        <div class="flex items-center gap-2 mt-1">
          <div class="flex text-amber-400 text-sm">
            <i v-for="i in 5" :key="i" class="fa-solid fa-star" :class="i <= Math.round(avgRating) ? 'text-amber-400' : 'text-slate-200'"></i>
          </div>
          <span class="text-sm font-extrabold text-slate-900">{{ avgRating }}</span>
          <span class="text-xs text-slate-400">/ 5.0</span>
        </div>
      </div>
      <button 
        @click="isWriting = !isWriting"
        class="px-4 py-2 bg-orange-50 hover:bg-orange-100 text-orange-600 font-bold rounded-xl text-xs transition border border-orange-200"
      >
        <i class="fa-solid fa-pen-to-square mr-1.5"></i>{{ isWriting ? '닫기' : '리뷰 작성' }}
      </button>
    </div>

    <!-- Review Form -->
    <div v-if="isWriting" class="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-3 text-xs">
      <div class="font-bold text-slate-800">구매 상품에 대한 솔직한 리뷰를 남겨주세요</div>
      <div class="flex items-center gap-3">
        <label class="font-semibold text-slate-600">별점:</label>
        <div class="flex gap-1 text-base cursor-pointer">
          <i 
            v-for="star in 5" 
            :key="star"
            @click="newRating = star"
            class="fa-solid fa-star transition"
            :class="star <= newRating ? 'text-amber-400 scale-110' : 'text-slate-300'"
          ></i>
        </div>
        <span class="font-bold text-slate-700 font-mono">{{ newRating }}점</span>
      </div>
      <div>
        <input v-model="newReviewer" type="text" placeholder="작성자명 (예: 김*수)" class="w-full sm:w-64 px-3 py-2 bg-white rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-orange-500 focus:outline-none" />
      </div>
      <div>
        <textarea v-model="newContent" rows="3" placeholder="상품의 품질, 배송, 가성비 등에 대한 후기를 적어주세요 (최대 500자)" class="w-full p-3 bg-white rounded-xl border border-slate-300 text-xs focus:ring-2 focus:ring-orange-500 focus:outline-none"></textarea>
      </div>
      <div class="flex justify-end">
        <button 
          @click="submitReview" 
          :disabled="submitLoading || !newContent.trim()"
          class="px-5 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-bold rounded-xl transition shadow-md"
        >
          {{ submitLoading ? '등록 중...' : '리뷰 등록하기' }}
        </button>
      </div>
      <div v-if="submitMessage" class="text-emerald-600 font-bold text-center">{{ submitMessage }}</div>
    </div>

    <!-- Reviews List -->
    <div v-if="loading" class="py-8 text-center text-xs text-slate-400">
      <i class="fa-solid fa-spinner fa-spin mr-1"></i>리뷰를 불러오는 중...
    </div>
    <div v-else-if="reviews.length === 0" class="py-8 text-center text-xs text-slate-400 bg-slate-50 rounded-2xl">
      아직 작성된 구매 리뷰가 없습니다. 첫 번째 리뷰어가 되어보세요!
    </div>
    <div v-else class="space-y-4">
      <div 
        v-for="rev in reviews" 
        :key="rev.id" 
        class="bg-slate-50/70 p-4 rounded-2xl border border-slate-100 space-y-2 text-xs"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-bold text-slate-800">{{ rev.reviewer_name }}</span>
            <span v-if="rev.is_verified_purchase" class="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-md text-[10px] font-bold">
              <i class="fa-solid fa-check mr-0.5"></i>구매인증
            </span>
            <span class="text-slate-400 text-[11px]">{{ rev.sku_option_summary }}</span>
          </div>
          <div class="flex text-amber-400 text-xs">
            <i v-for="i in 5" :key="i" class="fa-solid fa-star" :class="i <= Math.round(rev.rating) ? 'text-amber-400' : 'text-slate-200'"></i>
          </div>
        </div>
        <p class="text-slate-700 leading-relaxed">{{ rev.content }}</p>
        <div class="text-[10px] text-slate-400 font-mono">{{ rev.created_at }}</div>
      </div>
    </div>
  </div>
</template>

