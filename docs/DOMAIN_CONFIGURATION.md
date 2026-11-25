# OLMOA Domain Architecture & Cloudflare Configuration
**Document Version:** 1.4.0 (2026-11-25, phase-6 crawl surface: llms docs, key file, home meta injection)
**Target Domain:** `olmoa.com` (Cloudflare Registrar, registered 2026-11-25)
**Brand:** OLMOA (올모아)

Procedure history, verification commands and rollback: `reports/DOMAIN_CUTOVER_RUNBOOK.md`.

---

## 1. Account

Everything runs in the **domain account** `f5c363135efe9b22ca66eb39f2f8e1da`, which owns the `olmoa.com` zone
(the operator manages all domains there). Every wrangler config pins `account_id` to it.

The former workers account `6d53e0a853ad74dec5fefcd4b4600e3a` no longer holds anything of OLMOA: its five
workers (`*.dnjstjqppk.workers.dev`), D1 `6935e21b…` and R2 `olmoa-media` were deleted on 2026-11-25 at the
operator's request. The pre-move data survives only as the export in `.ops-backups/` (git-ignored, contains PII).

## 2. Hostname mapping (live)

| Hostname | Worker (config) | Notes |
|---|---|---|
| `olmoa.com` | `openmarket` (root `wrangler.toml`) | Static storefront SPA; crawl paths forwarded to `olmoa-api` over the `API` service binding (`apps/storefront/edge/apex-worker.js`, mirror of `RUN_WORKER_FIRST`): `/robots.txt`, `/sitemap.xml`, `/sitemap-index.xml`, `/sitemaps/*`, `/llms.txt`, `/llms-full.txt`, `/llms/*`, `/*.txt` (6-7 IndexNow key file). `/` runs through the worker for edge verification-meta injection (served from ASSETS, never forwarded) |
| `www.olmoa.com` | `olmoa-edge` (`infra/domain-proxy/`) | 301 → `https://olmoa.com` (path + query kept); nothing else |
| `api.olmoa.com` | `olmoa-api` (`apps/cloudflare-gateway/wrangler.jsonc`) | D1 `openmarket-db` `6e23f7cd…`, R2 `olmoa-media`, rate limiters, cron `*/5` |
| `admin.olmoa.com` | `olmoa-admin` (`apps/admin/wrangler.jsonc`) | Static console |
| `partner.olmoa.com` | `olmoa-partner` (`apps/partner/wrangler.jsonc`) | Static console |

All app workers have `workers_dev: false`; the custom domains are their only public addresses. The former
warm-spare `olmoa-storefront` worker is retired (not deployed in the domain account).

## 3. DNS

Every record is created by a Worker Custom Domain (type "Worker"). Do not add or edit A/CNAME records for
`olmoa.com`, `www`, `api`, `admin` or `partner`. Note: wrangler in a non-interactive shell overrides existing DNS
records and moves a Custom Domain from another worker without asking. Mail records (Resend SPF/DKIM, DMARC,
inbound MX) are added when email is enabled — runbook §3-8.

## 4. TLS & security headers

1. **Always Use HTTPS** (zone → SSL/TLS → Edge Certificates) must be ON: the apex and consoles are static-asset
   workers, so without it `http://olmoa.com` is served as-is (200) instead of 301.
2. **HSTS** `max-age=31536000; includeSubDomains` from every console's `public/_headers`, from the API
   (`lib/http.js`) and from `olmoa-edge`. No preload submission until the domain has run stably for weeks.
3. **CSP**: per-console `public/_headers`; `connect-src 'self' https:` covers `api.olmoa.com`.
   Toss redirects use `window.location.origin`.

## 5. CORS (API)

- `ALLOWED_ORIGINS` (secret on `olmoa-api`), exact match on `Origin`:
  `https://olmoa.com,https://www.olmoa.com,https://admin.olmoa.com,https://partner.olmoa.com`.
- Allowed headers: `Content-Type`, `Authorization`, `X-Idempotency-Key`. Methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`.

---

## 6. Session Storage (actual behaviour)

The gateway sets **no cookies**. Each console keeps its JWT in `localStorage` on its own origin
(storefront `olmoa_token`, partner `partner_token`, admin `olmoa_admin_token`) and sends it as `Authorization: Bearer`.
Isolation between consoles therefore comes from the browser's per-origin storage, which the separate
`admin.` / `partner.` hostnames preserve. Sessions from the workers.dev era do not carry over (different origin, and JWT_SECRET was rotated in the move). (Version 1.0.0 described `Domain=…; HttpOnly` cookies; that was never implemented.)

---

## 7. Build-time Endpoints (`VITE_*`)

`VITE_API_BASE_URL`, `VITE_STOREFRONT_URL`, `VITE_PARTNER_URL` and `VITE_ADMIN_URL` are baked into the bundles at build
time. DNS changes alone do not move the frontends: every cutover needs a rebuild and redeploy of all five workers (OPS-N05).

- CI: job-level `env` in `.github/workflows/deploy.yml`. It has to be job-level because every `wrangler deploy`
  step re-runs its config's `[build]` command.
- Cloudflare Git-connected builds: the worker's Build → Variables in the dashboard.
- `scripts/vite-require-env.mjs` fails the build when a value is missing in Workers Builds (`WORKERS_CI`) or
  with `OLMOA_REQUIRE_BUILD_ENV=1`, instead of shipping a bundle that throws on boot.
