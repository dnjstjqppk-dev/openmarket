<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { API_BASE_URL, getAuthHeaders } from '../config';
import ClaimModal from '../components/ClaimModal.vue';

const route = useRoute();
const order = ref<any>(null);
const loading = ref(true);
const actionError = ref('');
const actionMessage = ref('');

const showClaimModal = ref(false);
const activeSubOrder = ref<any>(null);
const claimLoading = ref(false);

const canCancel = computed(() => {
  if (!order.value || order.value.payment_status === 'CANCELLED') return false;
  const subs = order.value.sub_orders || [];
  return !subs.some((s: any) => ['SHIPPED', 'DELIVERED', 'COMPLETED', 'PURCHASE_CONFIRMED'].includes(s.status));
});

async function loadOrder() {
  const ordId = route.params.id as string;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/orders/${ordId}`, {
      headers: getAuthHeaders()
    });
    const json = await res.json();
    if (json.success && json.data) {
      order.value = json.data;
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
}

async function handleCancelOrder() {
  if (!confirm('정말 이 주문을 전액 취소하시겠습니까? 재고가 즉시 복원됩니다.')) return;
  actionError.value = '';
  actionMessage.value = '';
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/orders/${order.value.id}/cancel`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' })
    });
    const json = await res.json();
    if (res.ok && json.success) {
      actionMessage.value = '주문이 취소되었으며 결제 및 재고가 환원되었습니다.';
      await loadOrder();
    } else {
      actionError.value = json.error || '주문 취소에 실패했습니다.';
    }
  } catch (e: any) {
    actionError.value = '취소 요청 실패: ' + e.message;
  }
}

function openClaim(sub: any) {
  activeSubOrder.value = sub;
  showClaimModal.value = true;
}

async function handleClaimSubmit(payload: { claimType: 'RETURN' | 'EXCHANGE'; reason: string }) {
  claimLoading.value = true;
  actionError.value = '';
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/orders/${order.value.id}/claim`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        claim_type: payload.claimType,
        reason: payload.reason,
        sub_order_id: activeSubOrder.value?.id
      })
    });
    const json = await res.json();
    if (res.ok && json.success) {
      showClaimModal.value = false;
      actionMessage.value = json.message || '클레임 신청이 완료되었습니다.';
      await loadOrder();
    } else {
      actionError.value = json.error || '신청 실패';
    }
  } catch (e: any) {
    actionError.value = '클레임 요청 실패: ' + e.message;
  } finally {
    claimLoading.value = false;
  }
}

onMounted(() => {
  loadOrder();
});
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <div v-if="loading" class="p-16 text-center text-slate-400">
      <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-orange-500"></i>
      <p class="text-xs font-bold">주문 정보를 불러오는 중입니다...</p>
    </div>

    <div v-else-if="!order" class="bg-white rounded-3xl p-12 text-center border border-slate-200 space-y-3">
      <i class="fa-solid fa-file-circle-question text-4xl text-slate-300"></i>
      <h3 class="font-bold text-slate-800">주문 내역을 찾을 수 없습니다.</h3>
      <router-link to="/orders" class="inline-block mt-2 px-5 py-2.5 bg-orange-600 text-white text-xs font-bold rounded-xl shadow-md">
        내 전체 주문 내역 보기
      </router-link>
    </div>

    <div v-else class="space-y-6">
      <div v-if="actionMessage" class="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-bold">
        <i class="fa-solid fa-circle-check mr-1.5 text-emerald-600"></i>{{ actionMessage }}
      </div>
      <div v-if="actionError" class="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs font-bold">
        <i class="fa-solid fa-circle-exclamation mr-1.5 text-rose-600"></i>{{ actionError }}
      </div>

      <!-- Order Header Banner -->
      <div class="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm space-y-3">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <div class="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full mb-1"
                 :class="order.payment_status === 'CANCELLED' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-600'">
              <i :class="order.payment_status === 'CANCELLED' ? 'fa-solid fa-ban' : 'fa-solid fa-circle-check'"></i>
              <span>{{ order.payment_status === 'CANCELLED' ? '주문 취소 및 환불 완료' : '결제 및 주문 승인 완료' }}</span>
            </div>
            <h1 class="text-xl font-black text-slate-900">주문번호: {{ order.order_no }}</h1>
          </div>
          <div class="flex items-center gap-2">
            <button 
              v-if="canCancel"
              @click="handleCancelOrder" 
              class="px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 text-xs font-bold rounded-xl transition"
            >
              주문 전체 취소
            </button>
            <div class="text-xs text-slate-500 font-mono">
              주문일시: {{ order.created_at }}
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-slate-600 pt-1">
          <div>
            <h4 class="font-bold text-slate-800 mb-1">배송지 정보</h4>
            <p><strong>수령인:</strong> {{ order.recipient_name }} ({{ order.recipient_phone }})</p>
            <p><strong>주소:</strong> ({{ order.shipping_postal_code }}) {{ order.shipping_address_line1 }} {{ order.shipping_address_line2 }}</p>
          </div>
          <div class="sm:text-right">
            <h4 class="font-bold text-slate-800 mb-1">결제 내역</h4>
            <p>상품금액: ₩{{ order.total_goods_amount?.toLocaleString() }}</p>
            <p>배송비: ₩{{ order.total_shipping_amount?.toLocaleString() }}</p>
            <p class="text-sm font-black text-orange-600 mt-1">총 결제금액: ₩{{ order.total_pay_amount?.toLocaleString() }}</p>
          </div>
        </div>
      </div>

      <!-- Sub-Orders by Partner -->
      <div class="space-y-4">
        <h3 class="text-sm font-bold text-slate-800">판매자별 출고 및 배송 현황</h3>
        <div 
          v-for="sub in order.sub_orders" 
          :key="sub.id" 
          class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-3"
        >
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3 text-xs">
            <div>
              <span class="text-slate-400 font-medium">판매 파트너: </span>
              <strong class="text-slate-800">{{ sub.business_name || 'OLMOA Direct' }}</strong>
              <span class="ml-2 font-mono text-slate-400">({{ sub.sub_order_no }})</span>
            </div>
            <div class="flex items-center gap-2">
              <span 
                class="px-3 py-1 rounded-full font-bold text-[11px]"
                :class="sub.status === 'SHIPPED' ? 'bg-sky-50 text-sky-700 border border-sky-200' : sub.status.includes('RETURN') ? 'bg-purple-50 text-purple-700 border border-purple-200' : sub.status === 'CANCELLED' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-amber-50 text-amber-700 border border-amber-200'"
              >
                {{ sub.status === 'SHIPPED' ? '출고완료 (배송중)' : sub.status === 'RETURN_REQUESTED' ? '반품 접수' : sub.status === 'EXCHANGE_REQUESTED' ? '교환 접수' : sub.status === 'CANCELLED' ? '취소완료' : '상품 준비중' }}
              </span>
              <button 
                v-if="['SHIPPED', 'DELIVERED'].includes(sub.status)"
                @click="openClaim(sub)"
                class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold text-[11px]"
              >
                반품/교환 신청
              </button>
            </div>
          </div>

          <div class="divide-y divide-slate-100">
            <div v-for="it in sub.items" :key="it.id" class="py-2.5 flex items-center justify-between text-xs">
              <div class="space-y-0.5">
                <div class="font-bold text-slate-900">{{ it.product_title }}</div>
                <div class="text-slate-400 text-[11px]">옵션: {{ it.option_summary }} | 수량: {{ it.quantity }}개</div>
              </div>
              <div class="font-bold text-slate-800 font-mono">
                ₩{{ it.total_price.toLocaleString() }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Action Footer -->
      <div class="flex justify-between items-center pt-2">
        <router-link to="/orders" class="text-xs font-bold text-slate-600 hover:text-slate-900">
          &larr; 전체 주문 내역으로
        </router-link>
        <router-link to="/" class="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-xl shadow-md">
          쇼핑 계속하기 &rarr;
        </router-link>
      </div>
    </div>

    <!-- Modal Component -->
    <ClaimModal 
      v-if="showClaimModal" 
      :sub-order="activeSubOrder" 
      :loading="claimLoading" 
      @close="showClaimModal = false" 
      @submit="handleClaimSubmit" 
    />
  </div>
</template>
