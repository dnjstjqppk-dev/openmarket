// OLMOA storefront service worker. Conservative by design:
// - API calls (/api/*), non-GET requests and cross-origin requests are never
//   cached: they pass through untouched, so prices, stock and orders are always
//   live and authenticated calls never touch the cache.
// - /assets/* (Vite-hashed, immutable) is cache-first for offline repeat visits.
// - navigations are network-first with an inline offline fallback page.
// Bump VERSION to drop old caches; hashed asset URLs make stale entries harmless.
const VERSION = 'olmoa-store-v1';
const ASSETS_CACHE = `olmoa-assets-${VERSION}`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== ASSETS_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const OFFLINE_HTML = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OLMOA — 오프라인</title><style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;background:#f4f5f5;color:#1c1e1f;text-align:center;padding:24px}button{margin-top:16px;padding:12px 24px;font-size:15px;font-weight:700;border:0;border-radius:12px;background:#0e7490;color:#fff;cursor:pointer}</style></head>
<body><main><h1>오프라인 상태입니다</h1><p>네트워크 연결을 확인한 뒤 다시 시도해 주세요.</p><button onclick="location.reload()">다시 시도</button></main></body></html>`;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSETS_CACHE).then((cache) =>
        cache.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok) cache.put(req, res.clone());
              return res;
            })
        )
      )
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response(OFFLINE_HTML, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      )
    );
  }
});
