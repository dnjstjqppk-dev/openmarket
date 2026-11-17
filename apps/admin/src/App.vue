<script setup lang="ts">
import { Bell, Boxes, ChartPie, LogOut, Megaphone, MessageSquare, Receipt, Settings, ShieldCheck, Users } from 'lucide-vue-next'
import { ref, computed, watch, onMounted } from 'vue';
import { RouterLink, useRouter, useRoute } from 'vue-router';
import { OmConsoleShell, OmConfirmDialog, OmToast, type ConsoleMenuItem } from '@olmoa/ui';
import { API_BASE_URL, getAdminToken, getAdminHeaders, clearAdminToken, getAdminRole, ADMIN_ROLE_LABEL } from './config';

const router = useRouter();
const route = useRoute();
const collapsed = ref(false);
const isLoggedIn = ref(false);
const adminRole = ref('');

const checkAuth = () => {
  isLoggedIn.value = !!getAdminToken() && route.path !== '/login';
  adminRole.value = getAdminRole();
};

// P1-A01: hide nav entries the operator role cannot open (route meta.roles).
// Unknown role fails open — the server still denies unauthorized API calls.
const canSee = (path: string) => {
  const role = adminRole.value || getAdminRole();
  if (!role) return true;
  try {
    const resolved = router.resolve(path);
    const roles = resolved.matched.flatMap((r: any) => (r.meta?.roles as string[] | undefined) || []);
    return roles.length === 0 || roles.includes(role);
  } catch {
    return true;
  }
};

// Work order 1-7: grouped menu. Items whose views land in stage 4 are added
// with those views; every entry below opens a working screen today.
const rawMenu: ConsoleMenuItem[] = [
  { to: "/", label: '대시보드', icon: ChartPie },
  {
    to: "/partner-applications", label: '입점·셀러', icon: Users,
    children: [
      { to: "/partner-applications", label: '입점 심사' },
      { to: "/partners", label: '셀러 관리' },
      { to: "/partners/penalties-grades", label: '페널티·등급' }
    ]
  },
  {
    to: "/products", label: '상품', icon: Boxes,
    children: [
      { to: "/products", label: '전체 상품' },
      { to: "/products/review-queue", label: '검수 대기열' },
      { to: "/categories", label: '카테고리' }
    ]
  },
  {
    to: "/orders", label: '주문·클레임', icon: Receipt,
    children: [
      { to: "/orders", label: '주문 목록' },
      { to: "/claims", label: '분쟁 판정' }
    ]
  },
  {
    to: "/reconciliation", label: '정산·재무', icon: ChartPie,
    children: [
      { to: "/reconciliation", label: '데이터 대사' },
      { to: "/finance/batches", label: '정산 배치' },
      { to: "/finance/payout-requests", label: '출금 승인' },
      { to: "/finance/policies", label: '수수료 정책' },
      { to: "/ledger", label: '원장 감사' }
    ]
  },
  {
    to: "/marketing", label: '마케팅', icon: Megaphone,
    children: [
      { to: "/marketing/banners", label: '배너' },
      { to: "/marketing/exhibitions", label: '기획전' },
      { to: "/marketing/flash-sales", label: '타임딜' },
      { to: "/coupons", label: '플랫폼 쿠폰' },
      { to: "/marketing/notifications", label: '알림 발송' }
    ]
  },
  {
    to: "/users", label: '고객', icon: MessageSquare,
    children: [
      { to: "/users", label: '회원' },
      { to: "/inquiries", label: '1:1 문의' },
      { to: "/reviews", label: '리뷰' }
    ]
  },
  {
    to: "/business", label: '운영', icon: Settings,
    children: [
      { to: "/business", label: '사업자' },
      { to: "/suppliers", label: '공급사' },
      { to: "/supplier-integrations", label: '공급사 연동' },
      { to: "/shipping-zones", label: '도서산간 배송비' },
      { to: "/legal-documents", label: '약관 문서' },
      { to: "/supplier-integrations", label: '기능 플래그' }
    ]
  },
  {
    to: "/security", label: '보안', icon: ShieldCheck,
    children: [
      { to: "/security", label: '관리자 계정' },
      { to: "/audit-log", label: '감사 로그' }
    ]
  }
];
const menu = computed<ConsoleMenuItem[]>(() =>
  rawMenu
    .map((m) => ({ ...m, children: m.children?.filter((c) => canSee(c.to)) }))
    .filter((m) => canSee(m.to) || (m.children?.length ?? 0) > 0)
    .map((m) => ({ ...m, to: (m.children?.[0]?.to ?? m.to) }))
);

const operatorName = ref('');
const payMode = ref('');

async function loadHeader() {
  if (!isLoggedIn.value) return;
  try {
    const biz = await (await fetch(`${API_BASE_URL}/api/v1/business-info`, { headers: getAdminHeaders() })).json().catch(() => ({}));
    if (biz?.success && biz?.data?.legal_name) operatorName.value = biz.data.legal_name;
  } catch { /* badge stays hidden */ }
  try {
    const cfg = await (await fetch(`${API_BASE_URL}/api/v1/payments/config`, { headers: getAdminHeaders() })).json().catch(() => ({}));
    if (cfg?.success && cfg?.mode) payMode.value = cfg.mode === 'TOSS' ? '실결제' : cfg.mode === 'SANDBOX_SIMULATOR' ? '테스트' : '비활성';
  } catch { /* badge stays hidden */ }
}

const handleLogout = () => {
  clearAdminToken();
  isLoggedIn.value = false;
  operatorName.value = '';
  payMode.value = '';
  router.push('/login');
};

watch(() => route.path, () => {
  checkAuth();
  loadHeader();
});

onMounted(() => {
  checkAuth();
  loadHeader();
});
</script>

<template>
  <router-view v-if="!isLoggedIn" @auth-changed="checkAuth" />
  <OmConsoleShell v-else v-model:collapsed="collapsed" :menu="menu">
    <template #brand>
      <span class="flex items-center gap-2">
        <img src="/olmoa-symbol.svg" alt="OLMOA" class="h-8 w-8 object-contain" />
        <span class="text-md font-black tracking-tight text-ink">OLMOA <span class="text-xs font-bold text-ink-muted">ADMIN</span></span>
      </span>
    </template>
    <template #header>
      <div class="flex min-w-0 flex-1 items-center gap-2 text-xs">
        <span v-if="operatorName" class="truncate font-bold text-ink" aria-label="운영 사업자">{{ operatorName }}</span>
        <span v-if="payMode" class="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-2xs font-bold text-ink-muted">결제 {{ payMode }}</span>
        <span class="hidden shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-2xs font-bold text-primary-soft-ink sm:inline-block">
          {{ ADMIN_ROLE_LABEL[adminRole] || '운영자' }}
        </span>
      </div>
      <RouterLink v-if="canSee('/marketing')" to="/marketing" class="shrink-0 rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink" aria-label="알림">
        <Bell class="h-4 w-4" aria-hidden="true" />
      </RouterLink>
      <button type="button" class="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink" @click="handleLogout">
        <LogOut class="h-4 w-4" aria-hidden="true" />로그아웃
      </button>
    </template>
    <router-view @auth-changed="checkAuth" />
    <OmToast />
    <OmConfirmDialog />
    <!-- Mobile Navigation Dropdown: explicit role-gated links (P1-A02). -->
    <template #mobile-nav>
      <ul class="flex-1 space-y-0.5 overflow-y-auto p-2">
        <li><RouterLink v-if="canSee('/')" to="/" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">대시보드</RouterLink></li>
        <li><RouterLink v-if="canSee('/products')" to="/products" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">상품 관리</RouterLink></li>
        <li><RouterLink v-if="canSee('/orders')" to="/orders" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">주문 관리</RouterLink></li>
        <li><RouterLink v-if="canSee('/users')" to="/users" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">회원 관리</RouterLink></li>
        <li><RouterLink v-if="canSee('/reviews')" to="/reviews" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">리뷰 모더레이션</RouterLink></li>
        <li><RouterLink v-if="canSee('/coupons')" to="/coupons" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">쿠폰 관리</RouterLink></li>
        <li><RouterLink v-if="canSee('/categories')" to="/categories" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">카테고리 관리</RouterLink></li>
        <li><RouterLink v-if="canSee('/partners')" to="/partners" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">셀러 심사</RouterLink></li>
        <li><RouterLink v-if="canSee('/ledger')" to="/ledger" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">에스크로 원장</RouterLink></li>
        <li><RouterLink v-if="canSee('/partner-applications')" to="/partner-applications" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">입점 심사</RouterLink></li>
        <li><RouterLink v-if="canSee('/business')" to="/business" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">운영 사업자</RouterLink></li>
        <li><RouterLink v-if="canSee('/suppliers')" to="/suppliers" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">공급사·발주</RouterLink></li>
        <li><RouterLink v-if="canSee('/supplier-integrations')" to="/supplier-integrations" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">3PL·수집통합</RouterLink></li>
        <li><RouterLink v-if="canSee('/reconciliation')" to="/reconciliation" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">데이터 대사</RouterLink></li>
        <li><RouterLink v-if="canSee('/security')" to="/security" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">계정 보안</RouterLink></li>
        <li><RouterLink v-if="canSee('/audit-log')" to="/audit-log" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">감사 로그</RouterLink></li>
        <li><RouterLink v-if="canSee('/inquiries')" to="/inquiries" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">고객 문의</RouterLink></li>
        <li><RouterLink v-if="canSee('/shipping-zones')" to="/shipping-zones" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">도서산간 배송비</RouterLink></li>
        <li><RouterLink v-if="canSee('/marketing')" to="/marketing" class="block rounded-lg px-2.5 py-2.5 text-sm font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink" active-class="bg-primary-soft text-primary-soft-ink">마케팅·배너</RouterLink></li>
      </ul>
    </template>
  </OmConsoleShell>
</template>
