import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import '@olmoa/ui/styles.css';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';

const app = createApp(App);
app.use(createPinia());
app.use(router);
import { API_BASE_URL, clearPartnerSession, ensurePartnerSession } from './config';
import { installApiFetch } from '@olmoa/ui';

// PWA (OPS-10): conservative shell worker, production only — a worker would
// fight Vite HMR in dev. API/auth traffic always bypasses the cache.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
// P0-2 + P2: cookie sessions via the shared fetch wrapper (see @olmoa/ui).
installApiFetch({
  apiBaseUrl: API_BASE_URL,
  onExpiredSession: () => {
    clearPartnerSession();
    router.push({ path: '/login', query: { expired: '1' } });
  }
});
// The session is memory-only: restore it on every boot so public pages (no
// route guard runs for them) also see the logged-in state.
void ensurePartnerSession();
// Client error telemetry (POST /api/v1/client-errors): throttled to one report per 10s,
// message + page path only. Telemetry must never break the app.
let lastErrorReport = 0;
function reportClientError(kind: string, message: string) {
  const now = Date.now();
  if (now - lastErrorReport < 10000) return;
  lastErrorReport = now;
  try {
    const body = JSON.stringify({ app: 'partner', kind, message: String(message).slice(0, 500), url: window.location.pathname.slice(0, 200) });
    if (navigator.sendBeacon) navigator.sendBeacon(`${API_BASE_URL}/api/v1/client-errors`, new Blob([body], { type: 'text/plain' }));
    else fetch(`${API_BASE_URL}/api/v1/client-errors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* ignore */ }
}
window.addEventListener('error', (e) => reportClientError('window.onerror', e.message || 'unknown'));
window.addEventListener('unhandledrejection', (e: any) => reportClientError('unhandledrejection', (e.reason && (e.reason.message || String(e.reason))) || 'unknown'));
app.mount('#app');

