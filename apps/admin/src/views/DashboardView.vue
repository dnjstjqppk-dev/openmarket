<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { API_BASE_URL, getAdminHeaders } from '../config';

const metrics = ref({
  totalProducts: 0,
  totalOrders: 0,
  totalGmv: 0,
  totalPartners: 0,
  totalUsers: 0,
  bannersCount: 0,
  notifsCount: 0
});
const loading = ref(true);

onMounted(async () => {
  try {
    const [dashRes, bnrRes, notifRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/admin/dashboard`, { headers: getAdminHeaders() }),
      fetch(`${API_BASE_URL}/api/v1/admin/banners`, { headers: getAdminHeaders() }).catch(() => ({ json: async () => ({}) })),
      fetch(`${API_BASE_URL}/api/v1/admin/notifications`, { headers: getAdminHeaders() }).catch(() => ({ json: async () => ({}) }))
    ]);
    const json = await dashRes.json();
    const bnrJson = await bnrRes.json().catch(() => ({}));
    const notifJson = await notifRes.json().catch(() => ({}));

    if (json.success && json.metrics) {
      metrics.value.totalProducts = json.metrics.total_products || 0;
      metrics.value.totalOrders = json.metrics.total_orders || 0;
      metrics.value.totalGmv = json.metrics.total_gmv_amount || 0;
      metrics.value.totalPartners = json.metrics.total_partners || 0;
      metrics.value.totalUsers = json.metrics.total_users || 0;
    }
    if (bnrJson?.data && Array.isArray(bnrJson.data)) {
      metrics.value.bannersCount = bnrJson.data.length;
    }
    if (notifJson?.data && Array.isArray(notifJson.data)) {
      metrics.value.notifsCount = notifJson.data.length;
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
      <div>
        <h2 class="text-xl font-black text-slate-900">OLMOA 글로벌 플랫폼 운영 총괄 대시보드</h2>
        <p class="text-xs text-slate-500 mt-0.5">올모아 전 세계 주문, 에스크로 보관 자금 및 셀러 심사 현황</p>
      </div>
      <div class="flex gap-2">
        <span class="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold border border-emerald-200 flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          시스템 정상 가동 (Cloudflare D1 연동)
        </span>
      </div>
    </div>

    <div v-if="loading" class="p-12 text-center text-slate-400 text-xs">
      <i class="fa-solid fa-spinner fa-spin mr-2"></i>운영 지표를 집계하는 중입니다...
    </div>

    <div v-else class="space-y-6">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div class="text-slate-500 font-medium">총 누적 결제액 (GMV)</div>
          <div class="text-2xl font-black text-slate-900 mt-1">₩ {{ metrics.totalGmv.toLocaleString() }}</div>
          <div class="text-emerald-600 font-bold mt-1">D1 실시간 집계</div>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div class="text-slate-500 font-medium">플랫폼 총 주문 건수</div>
          <div class="text-2xl font-black text-indigo-700 mt-1">{{ metrics.totalOrders }} 건</div>
          <div class="text-slate-400 mt-1">Split-Order 분기 완료</div>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div class="text-slate-500 font-medium">활성 판매 파트너사</div>
          <div class="text-2xl font-black text-orange-600 mt-1">{{ metrics.totalPartners }} 개사</div>
          <div class="text-slate-400 mt-1">입점 승인 파트너</div>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div class="text-slate-500 font-medium">등록 활성 상품 (33개 대분류)</div>
          <div class="text-2xl font-black text-blue-600 mt-1">{{ metrics.totalProducts }} 개</div>
          <div class="text-slate-400 mt-1">전 카테고리 실재고 연동</div>
        </div>
      </div>

      <!-- Quick Action Navigation Cards -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <RouterLink to="/marketing" class="bg-white p-5 rounded-2xl border border-slate-200 hover:border-orange-500 transition shadow-xs group block">
          <div class="flex items-center justify-between mb-2">
            <span class="p-2.5 bg-orange-50 text-orange-600 rounded-xl group-hover:bg-orange-500 group-hover:text-white transition">
              <i class="fa-solid fa-images text-base"></i>
            </span>
            <span class="text-xs font-bold text-orange-600">활성 {{ metrics.bannersCount }}개 →</span>
          </div>
          <h3 class="font-black text-slate-900 text-sm">홈 배너 & 프로모션 관리</h3>
          <p class="text-slate-500 mt-1">스토어프론트 메인 롤링 배너 등록, 그라디언트 테마 설정 및 우선순위 조정</p>
        </RouterLink>

        <RouterLink to="/marketing" class="bg-white p-5 rounded-2xl border border-slate-200 hover:border-indigo-500 transition shadow-xs group block">
          <div class="flex items-center justify-between mb-2">
            <span class="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl group-hover:bg-indigo-500 group-hover:text-white transition">
              <i class="fa-solid fa-bell text-base"></i>
            </span>
            <span class="text-xs font-bold text-indigo-600">누적 {{ metrics.notifsCount }}건 →</span>
          </div>
          <h3 class="font-black text-slate-900 text-sm">고객 알림 및 푸시 발송</h3>
          <p class="text-slate-500 mt-1">전체 고객 또는 특정 주문 고객에게 할인, 주문 상태 변경, 공지사항 실시간 전송</p>
        </RouterLink>

        <RouterLink to="/ledger" class="bg-white p-5 rounded-2xl border border-slate-200 hover:border-emerald-500 transition shadow-xs group block">
          <div class="flex items-center justify-between mb-2">
            <span class="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl group-hover:bg-emerald-500 group-hover:text-white transition">
              <i class="fa-solid fa-scale-balanced text-base"></i>
            </span>
            <span class="text-xs font-bold text-emerald-600">원장 감사 →</span>
          </div>
          <h3 class="font-black text-slate-900 text-sm">에스크로 정산 원장</h3>
          <p class="text-slate-500 mt-1">파트너사별 정산 대금 검증, 수수료 차감 및 에스크로 지급 승인 처리</p>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
