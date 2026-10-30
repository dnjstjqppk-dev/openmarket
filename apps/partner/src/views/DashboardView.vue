<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { API_BASE, getPartnerHeaders } from '../config';

const metrics = ref({
  totalProducts: 0,
  ordersCount: 0,
  totalSales: 0,
  settlementExpected: 0
});

const recentOrders = ref<any[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const [metRes, ordRes] = await Promise.all([
      fetch(`${API_BASE}/api/v1/partner/metrics`, { headers: getPartnerHeaders() }),
      fetch(`${API_BASE}/api/v1/partner/orders`, { headers: getPartnerHeaders() })
    ]);

    const metJson = await metRes.json();
    if (metJson.success) {
      metrics.value.totalProducts = metJson.products_count || 0;
      metrics.value.ordersCount = metJson.orders_count || 0;
      metrics.value.totalSales = metJson.total_sales_amount || 0;
      metrics.value.settlementExpected = Math.round(metrics.value.totalSales * 0.9);
    }

    const ordJson = await ordRes.json();
    if (ordJson.success && ordJson.data) {
      recentOrders.value = ordJson.data.slice(0, 5);
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">판매자 비즈니스 대시보드</h1>
        <p class="text-xs text-slate-500 mt-1">D1 데이터베이스에 기록된 입점사의 실시간 판매 현황 및 출고 지표입니다.</p>
      </div>
      <div class="flex gap-2">
        <router-link to="/products" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm transition">
          <i class="fa-solid fa-boxes-stacked mr-1.5"></i>상품 재고 관리
        </router-link>
        <router-link to="/shipments" class="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold shadow-sm transition">
          <i class="fa-solid fa-truck-fast mr-1.5"></i>송장 출고 관리
        </router-link>
      </div>
    </div>

    <!-- Metric Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-xs font-semibold text-slate-500 mb-1">등록 상품 수</div>
        <div class="text-2xl font-bold text-slate-900">{{ metrics.totalProducts }}개</div>
        <div class="text-[10px] text-emerald-600 font-semibold mt-1">D1 활성 카탈로그</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-xs font-semibold text-slate-500 mb-1">인입된 총 주문건수</div>
        <div class="text-2xl font-bold text-indigo-600">{{ metrics.ordersCount }}건</div>
        <div class="text-[10px] text-slate-400 mt-1">실시간 고객 주문</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-xs font-semibold text-slate-500 mb-1">총 누적 매출</div>
        <div class="text-2xl font-bold text-slate-900">₩{{ metrics.totalSales.toLocaleString() }}</div>
        <div class="text-[10px] text-emerald-600 font-semibold mt-1">에스크로 확정 매출</div>
      </div>
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div class="text-xs font-semibold text-slate-500 mb-1">정산 예정 금액 (수수료 10% 제외)</div>
        <div class="text-2xl font-bold text-emerald-600">₩{{ metrics.settlementExpected.toLocaleString() }}</div>
        <div class="text-[10px] text-slate-400 mt-1">월 2회 정산 자동 지급</div>
      </div>
    </div>

    <!-- Analytics & Fulfillment Health Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- 7-Day GMV & Sales Trend SVG Sparkline Card -->
      <div class="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="font-black text-slate-900 text-sm flex items-center gap-2">
              <span>📈 주간 매출 추이 (최근 7일 GMV)</span>
            </h2>
            <p class="text-[11px] text-slate-400">일별 주문 금액 및 D1 에스크로 정산 확정액</p>
          </div>
          <span class="text-xs font-black text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
            전주 대비 +18.4% ▲
          </span>
        </div>

        <!-- Interactive SVG Area Chart -->
        <div class="h-44 w-full pt-2">
          <svg viewBox="0 0 500 120" class="w-full h-full overflow-visible">
            <defs>
              <linearGradient id="gmvGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#4F46E5" stop-opacity="0.25" />
                <stop offset="100%" stop-color="#4F46E5" stop-opacity="0.0" />
              </linearGradient>
            </defs>
            <!-- Grid Lines -->
            <line x1="0" y1="30" x2="500" y2="30" stroke="#F1F5F9" stroke-width="1" stroke-dasharray="3,3" />
            <line x1="0" y1="70" x2="500" y2="70" stroke="#F1F5F9" stroke-width="1" stroke-dasharray="3,3" />
            <line x1="0" y1="110" x2="500" y2="110" stroke="#E2E8F0" stroke-width="1" />

            <!-- Area Path -->
            <path
              d="M 20 95 Q 90 75 160 55 T 300 45 T 440 25 L 480 30 L 480 110 L 20 110 Z"
              fill="url(#gmvGradient)"
            />
            <!-- Line Path -->
            <path
              d="M 20 95 Q 90 75 160 55 T 300 45 T 440 25 L 480 30"
              fill="none"
              stroke="#4F46E5"
              stroke-width="3"
              stroke-linecap="round"
            />
            <!-- Data Points -->
            <circle cx="20" cy="95" r="4" fill="#4F46E5" stroke="#FFFFFF" stroke-width="2" />
            <circle cx="160" cy="55" r="4" fill="#4F46E5" stroke="#FFFFFF" stroke-width="2" />
            <circle cx="300" cy="45" r="4" fill="#4F46E5" stroke="#FFFFFF" stroke-width="2" />
            <circle cx="440" cy="25" r="5" fill="#FF5000" stroke="#FFFFFF" stroke-width="2" />
            <circle cx="480" cy="30" r="4" fill="#4F46E5" stroke="#FFFFFF" stroke-width="2" />
          </svg>
        </div>

        <div class="flex justify-between text-[11px] font-bold text-slate-400 px-2 border-t pt-2">
          <span>10.24 (월)</span>
          <span>10.25 (화)</span>
          <span>10.26 (수)</span>
          <span>10.27 (목)</span>
          <span>10.28 (금)</span>
          <span>10.29 (토)</span>
          <span class="text-indigo-600 font-black">오늘 (10.30)</span>
        </div>
      </div>

      <!-- SLA & Fulfillment Health Gauge -->
      <div class="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm space-y-4 flex flex-col justify-between">
        <div>
          <h2 class="font-black text-slate-900 text-sm">🚚 풀필먼트 서비스 품질 지수</h2>
          <p class="text-[11px] text-slate-400 mt-0.5">우수 셀러 평가 및 상위 노출 가산점</p>
        </div>

        <div class="space-y-3">
          <div>
            <div class="flex justify-between text-xs font-bold mb-1">
              <span class="text-slate-700">24시간 내 당일 출고율</span>
              <span class="text-emerald-600 font-black">98.5% (우수)</span>
            </div>
            <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div class="bg-emerald-500 h-full rounded-full" style="width: 98.5%"></div>
            </div>
          </div>

          <div>
            <div class="flex justify-between text-xs font-bold mb-1">
              <span class="text-slate-700">평균 배송 소요일</span>
              <span class="text-indigo-600 font-black">1.8일 (우수)</span>
            </div>
            <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div class="bg-indigo-500 h-full rounded-full" style="width: 92%"></div>
            </div>
          </div>

          <div>
            <div class="flex justify-between text-xs font-bold mb-1">
              <span class="text-slate-700">반품 및 클레임율</span>
              <span class="text-amber-600 font-black">0.4% (정상)</span>
            </div>
            <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div class="bg-amber-400 h-full rounded-full" style="width: 15%"></div>
            </div>
          </div>
        </div>

        <div class="pt-2 border-t">
          <router-link
            to="/returns"
            class="w-full py-2 bg-slate-50 hover:bg-orange-50 hover:text-[#FF5000] text-slate-700 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition border border-slate-200"
          >
            <span>🔄 반품·교환 클레임 센터 바로가기</span>
            <span class="text-[10px]">→</span>
          </router-link>
        </div>
      </div>
    </div>

    <!-- Recent Orders Table -->
    <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div class="p-5 border-b border-slate-100 flex items-center justify-between">
        <h2 class="font-bold text-slate-800 text-sm">실시간 인입 주문 내역</h2>
        <router-link to="/shipments" class="text-xs text-indigo-600 hover:underline">전체보기 &rarr;</router-link>
      </div>

      <div v-if="loading" class="p-8 text-center text-slate-400 text-xs">
        <i class="fa-solid fa-spinner fa-spin mr-2"></i>주문 정보를 불러오는 중...
      </div>

      <div v-else-if="recentOrders.length === 0" class="p-8 text-center text-slate-400 text-xs">
        인입된 신규 주문이 없습니다.
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-50 text-slate-500 uppercase font-semibold">
            <tr>
              <th class="py-3 px-4">주문번호</th>
              <th class="py-3 px-4">수령인</th>
              <th class="py-3 px-4">결제금액</th>
              <th class="py-3 px-4">진행상태</th>
              <th class="py-3 px-4 text-right">관리</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="order in recentOrders" :key="order.id" class="hover:bg-slate-50 transition">
              <td class="py-3 px-4 font-mono font-medium text-slate-900">{{ order.sub_order_no || order.order_no }}</td>
              <td class="py-3 px-4 font-medium text-slate-800">{{ order.recipient_name }}</td>
              <td class="py-3 px-4 font-semibold text-slate-900">₩{{ order.total_amount.toLocaleString() }}</td>
              <td class="py-3 px-4">
                <span 
                  class="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                  :class="order.status === 'SHIPPED' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'"
                >
                  {{ order.status === 'SHIPPED' ? '출고완료' : '결제확인' }}
                </span>
              </td>
              <td class="py-3 px-4 text-right">
                <router-link to="/shipments" class="text-indigo-600 hover:text-indigo-800 font-semibold text-[11px]">처리</router-link>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
