import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@olmoa/ui/styles.css';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import router from './router';
import App from './App.vue';
import { API_BASE_URL } from './config';
import { useAuthStore } from './stores/auth';
import { useLocaleStore } from './stores/locale';
import { i18n } from './i18n';
import { useTheme, applyRouteHead, installApiFetch } from '@olmoa/ui';

useTheme().init();

// PWA: offline-capable shell. Production only — a worker would fight Vite HMR in dev.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);
app.use(i18n);

// P0-2 + P2: cookie sessions via the shared fetch wrapper (see @olmoa/ui).
installApiFetch({
  apiBaseUrl: API_BASE_URL,
  onExpiredSession: () => {
    const auth = useAuthStore(pinia);
    if (auth.isAuthenticated) {
      auth.logout();
      const here = router.currentRoute.value.fullPath;
      router.push({ path: '/login', query: { redirect: here, expired: '1' } });
    }
  }
});
// The session is memory-only: restore it on every boot so public pages (no
// route guard runs for them) also see the logged-in state.
void useAuthStore(pinia).ensureSession();

router.beforeEach(async (to, from) => {
  const auth = useAuthStore(pinia);
  const toPath = String(to.path || '/');
  const toLocale = toPath === '/en' || toPath.startsWith('/en/') ? 'en'
    : toPath === '/ja' || toPath.startsWith('/ja/') ? 'ja' : 'ko';
  // 6-2: the URL is the locale source of truth — apply it for display only
  // (never persisted here, so no silent-setting; never redirected from
  // stored preference, so no redirect loop).
  try {
    useLocaleStore(pinia).applyUrlLocale(toLocale === 'en' ? 'en-US' : toLocale === 'ja' ? 'ja-JP' : 'ko-KR');
    document.documentElement.lang = toLocale === 'en' ? 'en' : toLocale === 'ja' ? 'ja' : 'ko';
  } catch { /* display locale must never break navigation */ }
  // P0-2: the session is memory-only; restore it from the cookie on entry.
  if (to.meta.requiresAuth && !(await auth.ensureSession())) {
    const loginPath = toLocale === 'ko' ? '/login' : `/${toLocale}/login`;
    return { path: loginPath, query: { redirect: to.fullPath } };
  }
  // 6-2: keep the mirror prefix across in-app navigation (explicit locale
  // URLs always win; this only re-applies the current prefix to bare targets).
  const fromPath = String(from.path || '/');
  const fromLocale = fromPath === '/en' || fromPath.startsWith('/en/') ? 'en'
    : fromPath === '/ja' || fromPath.startsWith('/ja/') ? 'ja' : 'ko';
  if (toLocale === 'ko' && fromLocale !== 'ko' && to.name !== 'not-found') {
    return { path: `/${fromLocale}${toPath === '/' ? '' : toPath}`, query: to.query, hash: to.hash };
  }
  return true;
});

// Phase 4-6: per-route head policy (canonical + robots + OG/Twitter) on every
// navigation. Entity views overwrite the title with their own meta afterwards.
router.afterEach((to) => {
  try {
    // 6-2: drop the edge-rendered JSON-LD of the first response; views inject
    // their own graphs, and a stale one must not survive client navigation.
    document.querySelectorAll('script[data-olmoa-edge]').forEach((el) => el.remove());
    applyRouteHead({ path: to.path, base: window.location.origin, title: document.title });
  } catch { /* head policy must never break navigation */ }
});

// Client error telemetry (POST /api/v1/client-errors): throttled to one report per 10s,
// message + page path only, never form contents. Telemetry must never break the app.
let lastErrorReport = 0;
function reportClientError(kind: string, message: string) {
  const now = Date.now();
  if (now - lastErrorReport < 10000) return;
  lastErrorReport = now;
  try {
    const body = JSON.stringify({ app: 'storefront', kind, message: String(message).slice(0, 500), url: window.location.pathname.slice(0, 200) });
    if (navigator.sendBeacon) navigator.sendBeacon(`${API_BASE_URL}/api/v1/client-errors`, new Blob([body], { type: 'text/plain' }));
    else window.fetch(`${API_BASE_URL}/api/v1/client-errors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* ignore */ }
}
window.addEventListener('error', (e) => reportClientError('window.onerror', e.message || 'unknown'));
window.addEventListener('unhandledrejection', (e) => reportClientError('unhandledrejection', (e.reason && (e.reason.message || String(e.reason))) || 'unknown'));

app.mount('#app');
