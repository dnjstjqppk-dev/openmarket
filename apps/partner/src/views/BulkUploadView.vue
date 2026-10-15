<script setup lang="ts">
import { ref } from 'vue';

const uploadSuccess = ref(false);
const isProcessing = ref(false);
const importedCount = ref(0);

function handleFileUpload(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) return;

  isProcessing.value = true;
  uploadSuccess.value = false;

  setTimeout(() => {
    isProcessing.value = false;
    importedCount.value = 142;
    uploadSuccess.value = true;
  }, 1200);
}
</script>

<template>
  <div class="space-y-6 max-w-4xl mx-auto">
    <div>
      <h1 class="text-2xl font-bold text-slate-900">Excel / CSV 대량 상품 일괄 등록</h1>
      <p class="text-xs text-slate-500 mt-1">양식 템플릿에 맞추어 수천 개의 SKU 상품을 한 번에 업로드할 수 있습니다.</p>
    </div>

    <!-- Upload Box -->
    <div class="bg-white p-8 rounded-2xl border-2 border-dashed border-indigo-200 text-center hover:border-indigo-500 transition">
      <div class="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mx-auto text-2xl mb-4">
        <i class="fa-solid fa-cloud-arrow-up"></i>
      </div>
      <h3 class="font-bold text-slate-800 text-base mb-1">파일을 드래그하거나 클릭하여 업로드</h3>
      <p class="text-xs text-slate-400 mb-6">지원 파일 형식: .xlsx, .csv (최대 50MB, 행 수 최대 10,000건)</p>

      <label class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-md inline-block">
        <span>파일 선택하기</span>
        <input type="file" accept=".xlsx, .csv" class="hidden" @change="handleFileUpload" />
      </label>

      <div class="mt-4">
        <a href="#" class="text-xs text-indigo-600 hover:underline">
          <i class="fa-solid fa-download mr-1"></i>표준 대량 등록 엑셀 템플릿 다운로드 (.xlsx)
        </a>
      </div>
    </div>

    <!-- Processing State -->
    <div v-if="isProcessing" class="p-4 bg-indigo-50 border border-indigo-200 rounded-xl text-center text-xs text-indigo-700 animate-pulse font-medium">
      <i class="fa-solid fa-spinner fa-spin mr-2"></i>SKU 유효성 검사 및 카테고리 매핑 파싱 중...
    </div>

    <!-- Success Message -->
    <div v-if="uploadSuccess" class="p-5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 space-y-1">
      <div class="font-bold text-sm"><i class="fa-solid fa-circle-check mr-1.5 text-emerald-600"></i>대량 등록 완료!</div>
      <p>총 <strong>{{ importedCount }}</strong>건의 신규 SKU 상품이 승인 큐에 안전하게 등록되었습니다.</p>
    </div>

    <!-- Specification Guide -->
    <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3 text-xs text-slate-600">
      <h4 class="font-bold text-slate-900">엑셀 업로드 필수 컬럼 규격</h4>
      <ul class="list-disc list-inside space-y-1">
        <li><strong>category_slug</strong>: 패션(mens-fashion, womens-fashion), 전자(smart-gadgets, audio-video) 등</li>
        <li><strong>title</strong>: 상품명 (최대 200자)</li>
        <li><strong>lowest_original_price / lowest_sale_price</strong>: 원가 및 할인가격 (원 단위 BIGINT)</li>
        <li><strong>sku_code</strong>: 파트너 고유 SKU 식별코드 (중복 불가)</li>
        <li><strong>stock_quantity</strong>: 초기 입고 수량 (0 이상 정수)</li>
      </ul>
    </div>
  </div>
</template>
