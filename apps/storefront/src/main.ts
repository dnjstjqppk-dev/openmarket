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
import { useTheme, applyRouteHead } from '@olmoa/ui';

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

// Session refresh (P2-SEC-07): access tokens live 1h. On 401, one single-flight
// refresh is attempted and the original request retried once; only a failed
// refresh ends the session. The x-olmoa-retried marker stops refresh loops.
let refreshInflight: Promise<string | null> | null = null;
async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInflight) {
    refreshInflight = (async () => {
      try {
        const auth = useAuthStore(pinia);
        const rt = auth.refreshToken;
        if (!rt) return null;
        const res = await nativeFetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: rt })
        });
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok || !data.success || !data.token || !data.refresh_token) return null;
        auth.applyRefresh(data.token, data.refresh_token);
        return data.token as string;
      } catch {
        return null;
      } finally {
        refreshInflight = null;
      }
    })();
  }
  return refreshInflight;
}
const nativeFetch = window.fetch.bind(window);
const NO_REFRESH_PATHS = ['/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/register'];
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await nativeFetch(input, init);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const initHeaders = new Headers(init?.headers);
  const skipRefresh = initHeaders.get('x-olmoa-retried') === '1'
    || input instanceof Request
    || NO_REFRESH_PATHS.some((p) => url.includes(p));
  if (res.status === 401 && url.startsWith(API_BASE_URL) && !skipRefresh) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      const merged: Record<string, string> = {};
      initHeaders.forEach((v, k) => { merged[k] = v; });
      merged['authorization'] = `Bearer ${fresh}`;
      merged['x-olmoa-retried'] = '1';
      return nativeFetch(input, { ...init, headers: merged });
    }
    const auth = useAuthStore(pinia);
    if (auth.isAuthenticated) {
      auth.logout();
      const here = router.currentRoute.value.fullPath;
      router.push({ path: '/login', query: { redirect: here, expired: '1' } });
    }
  }
  return res;
};

router.beforeEach((to, from) => {
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
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
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
