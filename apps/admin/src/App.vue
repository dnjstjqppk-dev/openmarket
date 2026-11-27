<script setup lang="ts">
import { Bell, Boxes, ChartPie, Globe, LogOut, Megaphone, MessageSquare, Monitor, Moon, Receipt, Settings, ShieldCheck, Sun, Users } from 'lucide-vue-next'
import { ref, computed, watch, onMounted } from 'vue';
import { RouterLink, useRouter, useRoute } from 'vue-router';
import { OmConsoleShell, OmConfirmDialog, OmToast, useTheme, nextThemeMode, useUiLocale, uiT, type ConsoleMenuItem, type UiLocale } from '@olmoa/ui';
import { API_BASE_URL, getAdminHeaders, clearAdminToken, getAdminRole, ensureAdminSession, ADMIN_ROLE_LABEL } from './config';

const router = useRouter();
const route = useRoute();
const collapsed = ref(false);
const isLoggedIn = ref(false);
const adminRole = ref('');

const { mode: themeMode, set: setTheme } = useTheme();
const cycleTheme = () => setTheme(nextThemeMode(themeMode.value));
const { locale: uiLoc, options: localeOptions, setLocale: setUiLoc } = useUiLocale();
const onLocaleChange = (v: string) => setUiLoc(v as UiLocale, true);

const checkAuth = async () => {
  isLoggedIn.value = route.path !== '/login' && await ensureAdminSession();
  adminRole.value = getAdminRole();
};

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

// Grouped console menu; OmConsoleShell translates every group/child label via uiT().
const rawMenu: ConsoleMenuItem[] = [
  { to: "/", label: '대시보드', icon: ChartPie },
  {
    to: "/partner-applications", label: '입점·셀러', icon: Users,
    children: [
      { to: "/partner-applications", label: '입점 심사' },
      { to: "/partners", label: '셀러 관리' },
      { to: "/partners/penalties-grades", label: '페널티·등급' },
      { to: "/shipping/badges", label: '출고 뱃지 정책' }
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
      { to: "/finance/fx-rates", label: '환율 관리' },
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
      { to: "/faqs", label: 'FAQ 관리' },
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
      <span class="flex items-center gap-2.5">
        <img src="/olmoa-symbol.svg" alt="OLMOA" class="h-8 w-8 shrink-0 object-contain" />
        <span v-if="!collapsed" class="truncate text-md font-extrabold tracking-tight text-ink">OLMOA <span class="text-xs font-bold text-primary">ADMIN</span></span>
      </span>
    </template>
    <template #header>
      <div class="flex min-w-0 flex-1 items-center gap-2 text-xs">
        <span v-if="operatorName" class="truncate font-bold text-ink" :aria-label="uiT('운영 사업자')">{{ operatorName }}</span>
        <span v-if="payMode" class="shrink-0 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-2xs font-bold text-ink-muted">{{ uiT(payMode) }}</span>
        <span class="hidden shrink-0 rounded-full bg-primary-soft px-2.5 py-0.5 text-2xs font-bold text-primary-soft-ink sm:inline-block">
          {{ ADMIN_ROLE_LABEL[adminRole] || '운영자' }}
        </span>
      </div>
      <label class="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2/80 px-2.5 py-1 text-xs">
        <Globe class="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        <span class="sr-only">{{ uiT('언어') }}</span>
        <select :value="uiLoc" class="cursor-pointer bg-transparent text-xs font-semibold text-ink focus:outline-none" @change="onLocaleChange(($event.target as HTMLSelectElement).value)">
          <option v-for="o in localeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
      <button type="button" :aria-label="uiT('테마 변경')" class="rounded-full p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink" @click="cycleTheme">
        <Sun v-if="themeMode === 'light'" class="h-4 w-4" aria-hidden="true" />
        <Moon v-else-if="themeMode === 'dark'" class="h-4 w-4" aria-hidden="true" />
        <Monitor v-else class="h-4 w-4" aria-hidden="true" />
      </button>
      <RouterLink v-if="canSee('/marketing')" to="/marketing" class="shrink-0 rounded-full p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink" :aria-label="uiT('알림')">
        <Bell class="h-4 w-4" aria-hidden="true" />
      </RouterLink>
      <button type="button" class="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink" @click="handleLogout">
        <LogOut class="h-4 w-4" aria-hidden="true" />{{ uiT('로그아웃') }}
      </button>
    </template>
    <router-view @auth-changed="checkAuth" />
    <OmToast />
    <OmConfirmDialog />
  </OmConsoleShell>
</template>
