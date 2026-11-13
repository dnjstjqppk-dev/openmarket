<script setup lang="ts">
import { Boxes, ChartPie, LogOut, MessageSquare, Network, Receipt, Reply, Settings, Truck } from 'lucide-vue-next'
import { ref, computed, watch, onMounted } from 'vue';
import { RouterLink, useRouter, useRoute } from 'vue-router';
import { OmConsoleShell, OmConfirmDialog, OmToast, formatNumber, type ConsoleMenuItem } from '@olmoa/ui';
import { API_BASE_URL, STOREFRONT_URL, getPartnerHeaders, getPartnerName, clearPartnerSession } from './config';

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
      { to: '/bulk-upload', label: '대량 등록' },
      { to: '/imports', label: 'URL 수집' }
    ]
  },
  { to: '/shipments', label: '주문·배송', icon: Truck },
  { to: '/returns', label: '클레임', icon: Reply },
  { to: '/settlements', label: '정산', icon: Receipt },
  { to: '/qna', label: '고객', icon: MessageSquare },
  { to: '/profile', label: '스토어', icon: Settings },
  {
    to: '/channels', label: '확장', icon: Network,
    children: [
      { to: '/channels', label: '멀티채널' },
      { to: '/bidding', label: '역경매' }
    ]
  }
]);

interface HeaderProfile { status: string; payout_account_verified: boolean }
const profile = ref<HeaderProfile | null>(null);
const operator = ref<any>(null);
const remoteZones = ref<{ zone_name: string; surcharge_amount: number }[]>([]);

async function loadHeader() {
  if (isLoginPage.value) return;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/profile`, { headers: getPartnerHeaders() });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.success && json.data) {
      profile.value = { status: json.data.status ?? '', payout_account_verified: json.data.payout_account_verified === true };
    }
  } catch {
    // Header badges stay hidden when the profile cannot load.
  }
}

async function loadFooter() {
  if (isLoginPage.value) return;
  try {
    const biz = await (await fetch(`${API_BASE_URL}/api/v1/business-info`, { headers: getPartnerHeaders() })).json().catch(() => ({}));
    if (biz?.success && biz?.data?.legal_name) operator.value = biz.data;
  } catch { /* footer stays hidden */ }
  try {
    const zones = await (await fetch(`${API_BASE_URL}/api/v1/shipping/remote-zones`, { headers: getPartnerHeaders() })).json().catch(() => ({}));
    if (zones?.success && Array.isArray(zones.data)) remoteZones.value = zones.data;
  } catch { /* surcharge line stays hidden */ }
}

function handleLogout() {
  clearPartnerSession();
  profile.value = null;
  operator.value = null;
  remoteZones.value = [];
  router.push('/login');
}

watch(() => route.path, () => { loadHeader(); loadFooter(); });
onMounted(() => { loadHeader(); loadFooter(); });
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
        </template>
      </div>
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
        <li><RouterLink to="/returns" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">반품·클레임</RouterLink></li>
        <li><RouterLink to="/settlements" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">정산 내역</RouterLink></li>
        <li><RouterLink to="/qna" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">Q&A 문의</RouterLink></li>
        <li><RouterLink to="/profile" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">스토어 설정</RouterLink></li>
        <li><RouterLink to="/channels" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">멀티채널 연동</RouterLink></li>
        <li><RouterLink to="/bidding" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">역경매</RouterLink></li>
      </ul>
    </template>
  </OmConsoleShell>
  <footer v-if="!isLoginPage && operator" class="border-t border-line-divider bg-surface px-4 py-4 text-xs leading-relaxed text-ink-muted">
    <p>상호 {{ operator.legal_name }} · 대표자 {{ operator.representative_name }} · 사업자등록번호 {{ operator.business_reg_number }} · 통신판매업신고 {{ operator.mail_order_reg_number }}</p>
    <p>주소 {{ operator.address }} · 고객센터 {{ operator.cs_phone }} · {{ operator.cs_email }}</p>
    <p v-if="operator.escrow_service_ref">구매안전서비스 {{ operator.escrow_service_ref }}</p>
    <p v-else><a :href="`${STOREFRONT_URL}/policy/escrow`" target="_blank" rel="noopener" class="underline hover:text-ink">구매안전서비스 안내</a></p>
    <!-- defaults mirror services/orders.js:186 (per-seller fallback) -->
    <p>배송비는 판매자별로 다르며, 미설정 시 기본 배송비 3,000원 · 30,000원 이상 무료배송이 적용됩니다.<template v-if="remoteZones.length"> 도서산간 추가: {{ remoteZones.map((z) => `${z.zone_name} +${formatNumber(z.surcharge_amount)}원`).join(' · ') }}</template></p>
    <p class="pt-1">
      © {{ new Date().getFullYear() }} {{ operator.legal_name }} ·
      <a :href="`${STOREFRONT_URL}/legal/terms`" target="_blank" rel="noopener" class="underline hover:text-ink">이용약관</a> ·
      <a :href="`${STOREFRONT_URL}/legal/privacy`" target="_blank" rel="noopener" class="underline hover:text-ink">개인정보처리방침</a>
    </p>
  </footer>
</template>
