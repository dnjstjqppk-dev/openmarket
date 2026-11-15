<script setup lang="ts">
import { Boxes, ChartPie, LogOut, MessageSquare, Network, Receipt, Reply, Settings, Ticket, Truck } from 'lucide-vue-next'
import { ref, computed, watch, onMounted } from 'vue';
import { RouterLink, useRouter, useRoute } from 'vue-router';
import { OmConsoleShell, OmConfirmDialog, OmToast, type ConsoleMenuItem } from '@olmoa/ui';
import { API_BASE_URL, STOREFRONT_URL, getPartnerHeaders, getPartnerName, getPartnerId, clearPartnerSession } from './config';

const router = useRouter();
const route = useRoute();
const collapsed = ref(false);

const isLoginPage = computed(() => ['/login', '/apply', '/application'].includes(route.path));
const partnerName = computed(() => (route.path, getPartnerName()));

// Work order 1-7: grouped menu. Items whose views land in stage 4 are added
// with those views; every entry below opens a working screen today.
const menu = computed<ConsoleMenuItem[]>(() => [
  { to: '/', label: '대시보드', icon: ChartPie },
  {
    to: '/products', label: '상품', icon: Boxes,
    children: [
      { to: '/products', label: '목록' },
      { to: '/products/new', label: '등록' },
      { to: '/bulk-upload', label: '대량 등록' },
      { to: '/imports', label: 'URL 수집' }
    ]
  },
  { to: '/shipments', label: '주문·배송', icon: Truck },
  {
    to: '/claims/return', label: '클레임', icon: Reply,
    children: [
      { to: '/claims/cancel', label: '취소 내역' },
      { to: '/claims/return', label: '반품' },
      { to: '/claims/exchange', label: '교환' }
    ]
  },
  {
    to: '/settlements', label: '정산', icon: Receipt,
    children: [
      { to: '/settlements', label: '정산 내역' },
      { to: '/settlements?action=payout', label: '출금 신청' },
      { to: '/settlements/deposits', label: '출금 가능 예치금' }
    ]
  },
  {
    to: '/promotions/coupons', label: '프로모션', icon: Ticket,
    children: [
      { to: '/promotions/coupons', label: '스토어 쿠폰' },
      { to: '/promotions/flash-sales', label: '번개특가 신청' },
      { to: '/promotions/exhibitions', label: '기획전 현황' }
    ]
  },
  {
    to: '/qna', label: '고객', icon: MessageSquare,
    children: [
      { to: '/qna', label: '상품 문의' },
      { to: '/reviews', label: '리뷰 관리' }
    ]
  },
  {
    to: '/profile', label: '스토어', icon: Settings,
    children: [
      { to: '/profile', label: '판매자 설정' },
      { to: '/store-profile', label: '스토어 장식' },
      { to: '/store/shipping-policies', label: '배송·반품 정책' }
    ]
  },
  {
    to: '/channels', label: '확장', icon: Network,
    children: [
      { to: '/channels', label: '멀티채널' },
      { to: '/bidding', label: '역경매' }
    ]
  }
]);

interface HeaderProfile { status: string; payout_account_verified: boolean; penalty_count: number; grade_code: string }
const profile = ref<HeaderProfile | null>(null);
const storeUrl = computed(() => {
  const id = (route.path, getPartnerId());
  return id ? `${STOREFRONT_URL}/store/${id}` : '';
});

async function loadHeader() {
  if (isLoginPage.value) return;
  try {
    const [pr, pp] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/partner/profile`, { headers: getPartnerHeaders() }).then((r) => r.json().catch(() => ({}))),
      fetch(`${API_BASE_URL}/api/v1/partner/dashboard/pipeline`, { headers: getPartnerHeaders() }).then((r) => r.json().catch(() => ({})))
    ]);
    const data = pr?.data || {};
    const pipe = pp?.data || pp || {};
    profile.value = {
      status: data.status ?? '',
      payout_account_verified: data.payout_account_verified === true,
      penalty_count: Number(pipe.penalty_count) || 0,
      grade_code: pipe.grade?.grade_code || ''
    };
  } catch {
    // Header badges stay hidden when the profile cannot load.
  }
}

function handleLogout() {
  clearPartnerSession();
  profile.value = null;
  router.push('/login');
}

watch(() => route.path, () => { loadHeader(); });
onMounted(() => { loadHeader(); });
</script>

<template>
  <router-view v-if="isLoginPage" />
  <OmConsoleShell v-else v-model:collapsed="collapsed" :menu="menu">
    <template #brand>
      <span class="flex items-center gap-2">
        <img src="/olmoa-symbol.svg" alt="OLMOA" class="h-8 w-8 object-contain" />
        <span class="text-md font-black tracking-tight text-ink">OLMOA <span class="text-xs font-bold text-ink-muted">판매자 센터</span></span>
      </span>
    </template>
    <template #header>
      <div class="flex min-w-0 flex-1 items-center gap-2 text-xs">
        <span class="truncate font-bold text-ink">{{ partnerName }}</span>
        <template v-if="profile">
          <span class="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-2xs font-bold text-ink-muted">입점 상태 {{ profile.status || '확인 필요' }}</span>
          <span
            class="hidden shrink-0 rounded-full px-2 py-0.5 text-2xs font-bold sm:inline-block"
            :class="profile.payout_account_verified ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'"
          >
            정산계좌 {{ profile.payout_account_verified ? '확인됨' : '미확인' }}
          </span>
          <span v-if="profile.penalty_count > 0" class="shrink-0 rounded-full bg-danger-soft px-2 py-0.5 text-2xs font-bold text-danger">페널티 {{ profile.penalty_count }}건</span>
          <span v-if="profile.grade_code" class="hidden shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-2xs font-bold text-primary-soft-ink sm:inline-block">{{ profile.grade_code }} 등급</span>
        </template>
      </div>
      <a v-if="storeUrl" :href="storeUrl" target="_blank" rel="noopener" class="hidden shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-ink hover:bg-surface-2 sm:flex">판매 전환</a>
      <button type="button" class="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink" @click="handleLogout">
        <LogOut class="h-4 w-4" aria-hidden="true" />로그아웃
      </button>
    </template>
    <router-view />
    <OmToast />
    <OmConfirmDialog />
    <!-- Mobile Dropdown Menu: explicit links (F-T16). -->
    <template #mobile-nav>
      <ul class="flex-1 space-y-0.5 overflow-y-auto p-2">
        <li><RouterLink to="/" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">대시보드</RouterLink></li>
        <li><RouterLink to="/products" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">상품 관리</RouterLink></li>
        <li><RouterLink to="/bulk-upload" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">대량 등록</RouterLink></li>
        <li><RouterLink to="/imports" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">URL 수집</RouterLink></li>
        <li><RouterLink to="/shipments" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">주문·배송</RouterLink></li>
        <li><RouterLink to="/claims/cancel" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">취소 내역</RouterLink></li>
        <li><RouterLink to="/claims/return" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink">반품 클레임</RouterLink></li>
        <li><RouterLink to="/claims/exchange" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">교환 클레임</RouterLink></li>
        <li><RouterLink to="/settlements" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">정산 내역</RouterLink></li>
        <li><RouterLink to="/promotions/coupons" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">스토어 쿠폰</RouterLink></li>
        <li><RouterLink to="/promotions/flash-sales" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">번개특가 신청</RouterLink></li>
        <li><RouterLink to="/promotions/exhibitions" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">기획전 현황</RouterLink></li>
        <li><RouterLink to="/qna" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">Q&A 문의</RouterLink></li>
        <li><RouterLink to="/reviews" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">리뷰 관리</RouterLink></li>
        <li><RouterLink to="/profile" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">스토어 설정</RouterLink></li>
        <li><RouterLink to="/store-profile" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">스토어 장식</RouterLink></li>
        <li><RouterLink to="/channels" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">멀티채널 연동</RouterLink></li>
        <li><RouterLink to="/bidding" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">역경매</RouterLink></li>
      </ul>
    </template>
  </OmConsoleShell>
</template>
