import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@olmoa/ui/styles.css';
import { createApp } from 'vue';
import router from './router';
import App from './App.vue';

const app = createApp(App);
// P2-A10: no pinia — the admin console keeps session in config.ts localStorage
// helpers and has zero defineStore modules, so no store plugin is registered.
app.use(router);
import { API_BASE_URL, getAdminToken, getAdminRole, clearAdminToken, setAdminToken, getAdminRefreshToken, setAdminRefreshToken } from './config';

// PWA (OPS-10): conservative shell worker, production only — a worker would
// fight Vite HMR in dev. API/auth traffic always bypasses the cache.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
// P1-A01: token presence + per-route role check (server still enforces per-call;
// an unknown role fails open to the server rather than locking operators out).
router.beforeEach((to) => {
  if (to.path !== '/login' && !getAdminToken()) return { path: '/login', query: { redirect: to.fullPath } };
  const roles = (to.meta?.roles as string[] | undefined) || (to.matched?.flatMap((r: any) => (r.meta?.roles as string[] | undefined) || []) as string[]);
  const role = getAdminRole();
  if (roles && roles.length && role && !roles.includes(role)) return { path: '/', query: { denied: to.path } };
  return true;
});
// Session refresh (P2-SEC-07): access tokens live 1h. On 401, one single-flight
// refresh is attempted and the original request retried once; only a failed
// refresh ends the session. The x-olmoa-retried marker stops refresh loops.
let refreshInflight: Promise<string | null> | null = null;
async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInflight) {
    refreshInflight = (async () => {
      try {
        const rt = getAdminRefreshToken();
        if (!rt) return null;
        const res = await nativeFetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: rt })
        });
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok || !data.success || !data.token || !data.refresh_token) return null;
        setAdminToken(data.token);
        setAdminRefreshToken(data.refresh_token);
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
    clearAdminToken();
    router.push({ path: '/login', query: { expired: '1' } });
  }
  return res;
};
// Client error telemetry (POST /api/v1/client-errors): throttled to one report per 10s,
// message + page path only. Telemetry must never break the app.
let lastErrorReport = 0;
function reportClientError(kind: string, message: string) {
  const now = Date.now();
  if (now - lastErrorReport < 10000) return;
  lastErrorReport = now;
  try {
    const body = JSON.stringify({ app: 'admin', kind, message: String(message).slice(0, 500), url: window.location.pathname.slice(0, 200) });
    if (navigator.sendBeacon) navigator.sendBeacon(`${API_BASE_URL}/api/v1/client-errors`, new Blob([body], { type: 'text/plain' }));
    else nativeFetch(`${API_BASE_URL}/api/v1/client-errors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* ignore */ }
}
window.addEventListener('error', (e) => reportClientError('window.onerror', e.message || 'unknown'));
window.addEventListener('unhandledrejection', (e: any) => reportClientError('unhandledrejection', (e.reason && (e.reason.message || String(e.reason))) || 'unknown'));
app.mount('#app');
