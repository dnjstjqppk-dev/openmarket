import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@olmoa/ui/styles.css';
import { createApp } from 'vue';
import router from './router';
import App from './App.vue';

const app = createApp(App);
// P2-A10: no pinia — the admin console keeps session in config.ts localStorage
// helpers and has zero defineStore modules, so no store plugin is registered.
app.use(router);
import { API_BASE_URL, getAdminRole, clearAdminToken, ensureAdminSession } from './config';
import { installApiFetch } from '@olmoa/ui';

// PWA (OPS-10): conservative shell worker, production only — a worker would
// fight Vite HMR in dev. API/auth traffic always bypasses the cache.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
// P1-A01: token presence + per-route role check (server still enforces per-call;
// an unknown role fails open to the server rather than locking operators out).
router.beforeEach(async (to) => {
  // P0-2: the session is memory-only; restore it from the cookie on entry.
  if (to.path !== '/login' && !(await ensureAdminSession())) return { path: '/login', query: { redirect: to.fullPath } };
  const roles = (to.meta?.roles as string[] | undefined) || (to.matched?.flatMap((r: any) => (r.meta?.roles as string[] | undefined) || []) as string[]);
  const role = getAdminRole();
  if (roles && roles.length && role && !roles.includes(role)) return { path: '/', query: { denied: to.path } };
  return true;
});
// P0-2 + P2: cookie sessions via the shared fetch wrapper (see @olmoa/ui).
installApiFetch({
  apiBaseUrl: API_BASE_URL,
  onExpiredSession: () => {
    clearAdminToken();
    router.push({ path: '/login', query: { expired: '1' } });
  }
});
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
    else fetch(`${API_BASE_URL}/api/v1/client-errors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* ignore */ }
}
window.addEventListener('error', (e) => reportClientError('window.onerror', e.message || 'unknown'));
window.addEventListener('unhandledrejection', (e: any) => reportClientError('unhandledrejection', (e.reason && (e.reason.message || String(e.reason))) || 'unknown'));
app.mount('#app');
