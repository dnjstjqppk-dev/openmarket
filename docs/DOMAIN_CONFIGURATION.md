# OLMOA Domain Architecture & Cloudflare Configuration
**Document Version:** 1.2.0 (2026-11-25, live state after the olmoa.com connection)
**Target Domain:** `olmoa.com` (Cloudflare Registrar, registered 2026-11-25)
**Brand:** OLMOA (올모아)

Procedure history, verification commands and rollback: `reports/DOMAIN_CUTOVER_RUNBOOK.md`.

---

## 1. Two Cloudflare accounts

| Account | Holds |
|---|---|
| **Domain account** `f5c363135efe9b22ca66eb39f2f8e1da` | `olmoa.com` zone (operator manages all domains here) + worker `olmoa-edge` |
| **Workers account** `6d53e0a853ad74dec5fefcd4b4600e3a` | `olmoa-api`, `openmarket`, `olmoa-storefront`, `olmoa-admin`, `olmoa-partner`, D1, R2, secrets |

Worker Custom Domains can only bind a zone to a worker in the **same** account, so the app workers cannot hold
`olmoa.com` hostnames directly. `olmoa-edge` (`infra/domain-proxy/`) owns the custom domains in the domain account
and forwards each request to the app worker's `*.dnjstjqppk.workers.dev` host.

## 2. Hostname mapping (live)

| Hostname | Served by | Upstream |
|---|---|---|
| `olmoa.com` | `olmoa-edge` | `openmarket.dnjstjqppk.workers.dev` (storefront SPA); crawl paths → `olmoa-api.dnjstjqppk.workers.dev` |
| `www.olmoa.com` | `olmoa-edge` | 301 → `https://olmoa.com` (path + query kept) |
| `admin.olmoa.com` | `olmoa-edge` | `olmoa-admin.dnjstjqppk.workers.dev` |
| `partner.olmoa.com` | `olmoa-edge` | `olmoa-partner.dnjstjqppk.workers.dev` |
| `api.olmoa.com` | **not used** | Browsers call `olmoa-api.dnjstjqppk.workers.dev` directly (`VITE_API_BASE_URL`) |

Crawl paths on the apex (`/robots.txt`, `/sitemap.xml`, `/sitemap-index.xml`, `/sitemaps/*`, `/llms.txt`,
`/llms-full.txt`) go straight to the API, which generates them from D1 with `PUBLIC_STOREFRONT_URL`
(default `https://olmoa.com`) as the URL base. `apps/storefront/edge/apex-worker.js` does the same on the
`openmarket` worker itself (service binding), for its workers.dev host.

**Why the API is not proxied:** a proxy hop makes every browser arrive from the proxy's egress IP, which would
collapse the API's per-IP rate limits (login 5/min, auth 10/min) into one shared bucket. `api.olmoa.com` needs the
API worker (with D1/R2/secrets) in the domain account, or the zone moved to the workers account; until then the
API keeps its workers.dev host. Do not disable workers.dev on any app worker: `olmoa-edge` depends on it.

## 3. DNS

All records are created by the Custom Domains on `olmoa-edge` (type "Worker"). Do not add or edit A/CNAME records
for `olmoa.com`, `www`, `admin` or `partner`. Mail records (Resend SPF/DKIM, DMARC, inbound MX) are added when email
is enabled — runbook §3-8.

## 4. TLS & security headers

1. HTTP → HTTPS 301 and `www` → apex 301 are done in `olmoa-edge`; no Redirect Rule or placeholder record needed.
2. **HSTS** `max-age=31536000; includeSubDomains`, set by `olmoa-edge` on every response (the API sends the same).
   No preload submission until the domain has run stably for several weeks.
3. **CSP**: per-console `public/_headers`, passed through unchanged. Toss redirects use `window.location.origin`.

## 5. CORS (API)

- `ALLOWED_ORIGINS` (secret on `olmoa-api`), exact match on `Origin`. Live value since 2026-11-25:
  the four `*.dnjstjqppk.workers.dev` app origins + `https://olmoa.com`, `https://www.olmoa.com`,
  `https://admin.olmoa.com`, `https://partner.olmoa.com`. Remove the workers.dev origins once nothing links to them.
- Allowed headers: `Content-Type`, `Authorization`, `X-Idempotency-Key`. Methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`.

---

## 6. Session Storage (actual behaviour)

The gateway sets **no cookies**. Each console keeps its JWT in `localStorage` on its own origin
(storefront `olmoa_token`, partner `partner_token`, admin `olmoa_admin_token`) and sends it as `Authorization: Bearer`.
Isolation between consoles therefore comes from the browser's per-origin storage, which the separate
`admin.` / `partner.` hostnames preserve. A session started on a workers.dev host does not carry over to the
custom domain (different origin); users sign in again once. (Version 1.0.0 described `Domain=…; HttpOnly` cookies; that was never implemented.)

---

## 7. Build-time Endpoints (`VITE_*`)

`VITE_API_BASE_URL`, `VITE_STOREFRONT_URL`, `VITE_PARTNER_URL` and `VITE_ADMIN_URL` are baked into the bundles at build
time. DNS changes alone do not move the frontends: every cutover needs a rebuild and redeploy of all five workers (OPS-N05).

- CI: job-level `env` in `.github/workflows/deploy.yml`. It has to be job-level because every `wrangler deploy`
  step re-runs its config's `[build]` command.
- Cloudflare Git-connected builds: the worker's Build → Variables in the dashboard.
- `scripts/vite-require-env.mjs` fails the build when a value is missing in Workers Builds (`WORKERS_CI`) or
  with `OLMOA_REQUIRE_BUILD_ENV=1`, instead of shipping a bundle that throws on boot.
