<script setup lang="ts">
import { Boxes, ChartPie, Globe, LogOut, MessageSquare, Monitor, Moon, Network, Receipt, Reply, Settings, Sun, Ticket, Truck } from 'lucide-vue-next'
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { OmConsoleShell, OmConfirmDialog, OmToast, useTheme, nextThemeMode, useUiLocale, uiT, type ConsoleMenuItem, type UiLocale } from '@olmoa/ui';
import { API_BASE_URL, STOREFRONT_URL, getPartnerHeaders, getPartnerName, getPartnerId, clearPartnerSession, ensurePartnerSession } from './config';

// Raw enum codes (APPROVED…) were shown in the header; show localized labels, keep unknown codes visible.
const PARTNER_STATUS_LABEL: Record<string, string> = { APPROVED: '승인', PENDING: '심사 중', REJECTED: '반려', SUSPENDED: '정지', TERMINATED: '해지' }
const partnerStatusLabel = (s?: string | null) => uiT(s ? PARTNER_STATUS_LABEL[s] || s : '확인 필요')

const router = useRouter();
const route = useRoute();
const collapsed = ref(false);

const { mode: themeMode, set: setTheme } = useTheme();
const cycleTheme = () => setTheme(nextThemeMode(themeMode.value));
const { locale: uiLoc, options: localeOptions, setLocale: setUiLoc } = useUiLocale();
const onLocaleChange = (v: string) => setUiLoc(v as UiLocale, true);

const isLoginPage = computed(() => ['/login', '/apply', '/application'].includes(route.path));
const partnerName = computed(() => (route.path, getPartnerName()));

// Grouped console menu; OmConsoleShell renders uiT() on every group and child label.
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
  // Wait for the initial navigation (route.path is '/' before it resolves, which used to fire
  // seller-only calls on /apply) and only ask for seller data with a seller session.
  await router.isReady();
  if (isLoginPage.value || !(await ensurePartnerSession())) return;
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
      <span class="flex items-center gap-2.5">
        <img src="/olmoa-symbol.svg" alt="OLMOA" class="h-8 w-8 shrink-0 object-contain" />
        <span v-if="!collapsed" class="truncate text-md font-extrabold tracking-tight text-ink">OLMOA <span class="text-xs font-bold text-primary">{{ uiT('판매자 센터') }}</span></span>
      </span>
    </template>
    <template #header>
      <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-xs">
        <span class="truncate font-bold text-ink">{{ partnerName }}</span>
        <template v-if="profile">
          <span class="hidden shrink-0 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-2xs font-bold text-ink-muted sm:inline-block">입점 상태 {{ partnerStatusLabel(profile.status) }}</span>
          <span
            class="hidden shrink-0 rounded-full px-2.5 py-0.5 text-2xs font-bold sm:inline-block"
            :class="profile.payout_account_verified ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'"
          >
            정산계좌 {{ profile.payout_account_verified ? uiT('확인됨') : uiT('미확인') }}
          </span>
          <span v-if="profile.penalty_count > 0" class="shrink-0 rounded-full bg-danger-soft px-2.5 py-0.5 text-2xs font-bold text-danger">페널티 {{ profile.penalty_count }}건</span>
          <span v-if="profile.grade_code" class="hidden shrink-0 rounded-full bg-primary-soft px-2.5 py-0.5 text-2xs font-bold text-primary-soft-ink sm:inline-block">{{ profile.grade_code }}</span>
        </template>
      </div>
      <label class="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface-2/80 px-2.5 py-1 text-xs">
        <Globe class="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        <span class="sr-only">{{ uiT('언어') }}</span>
        <select :value="uiLoc" class="cursor-pointer bg-transparent text-xs font-semibold text-ink focus:outline-none" @change="onLocaleChange(($event.target as HTMLSelectElement).value)">
          <option v-for="o in localeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
      <button type="button" :aria-label="uiT('테마 변경')" class="shrink-0 rounded-full p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink" @click="cycleTheme">
        <Sun v-if="themeMode === 'light'" class="h-4 w-4" aria-hidden="true" />
        <Moon v-else-if="themeMode === 'dark'" class="h-4 w-4" aria-hidden="true" />
        <Monitor v-else class="h-4 w-4" aria-hidden="true" />
      </button>
      <a v-if="storeUrl" :href="storeUrl" target="_blank" rel="noopener" class="hidden shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-bold text-ink shadow-sm transition-colors hover:border-primary hover:text-primary sm:flex">{{ uiT('판매 전환') }}</a>
      <button type="button" class="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-bold text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink sm:px-3" :aria-label="uiT('로그아웃')" @click="handleLogout">
        <LogOut class="h-4 w-4" aria-hidden="true" /><span class="hidden sm:inline">{{ uiT('로그아웃') }}</span>
      </button>
    </template>
    <router-view />
    <OmToast />
    <OmConfirmDialog />
  </OmConsoleShell>
</template>
