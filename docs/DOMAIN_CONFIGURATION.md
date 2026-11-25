# OLMOA Domain Architecture & Cloudflare Configuration
**Document Version:** 1.1.0 (2026-11-25, corrected against the code)
**Target Domain:** `olmoa.com`
**Brand:** OLMOA (올모아)

The step-by-step cutover procedure, verification commands and rollback live in
`reports/DOMAIN_CUTOVER_RUNBOOK.md`. This document describes the target state only.

---

## 1. Hostname → Worker Mapping

| Hostname | Worker (wrangler config) | Role |
|---|---|---|
| `olmoa.com` | `openmarket` (root `wrangler.toml`) | Customer storefront (static SPA) + crawl paths forwarded to the API |
| `www.olmoa.com` | — (Redirect Rule) | 301 → `https://olmoa.com` (path and query kept) |
| `api.olmoa.com` | `olmoa-api` (`apps/cloudflare-gateway/wrangler.jsonc`) | D1 edge gateway |
| `admin.olmoa.com` | `olmoa-admin` (`apps/admin/wrangler.jsonc`) | Operator console |
| `partner.olmoa.com` | `olmoa-partner` (`apps/partner/wrangler.jsonc`) | Seller console |
| — | `olmoa-storefront` (`apps/storefront/wrangler.jsonc`) | Same storefront build on workers.dev only, kept as a warm spare; not attached to the apex |

The apex worker serves `/robots.txt`, `/sitemap.xml`, `/sitemap-index.xml`, `/sitemaps/*`, `/llms.txt` and
`/llms-full.txt` by forwarding them over the `API` service binding to `olmoa-api` (`run_worker_first`,
`apps/storefront/edge/apex-worker.js`). Every other path is the static SPA. These documents are generated from D1
with `PUBLIC_STOREFRONT_URL` as the URL base, so that secret must be `https://olmoa.com`.

---

## 2. DNS

Worker **Custom Domains** create their own proxied DNS records and edge certificates. Do **not** pre-create
`A`/`CNAME` records for `olmoa.com`, `api`, `admin` or `partner`: an existing record on the same name blocks the
Custom Domain. (Version 1.0.0 of this document listed such records, including `CNAME → olmoa-*.workers.dev`
targets that lacked the account subdomain; they must not be used.)

The only manual record:

```dns
;; Zone: olmoa.com
AAAA   www   100::   Proxied   ; placeholder so the www → apex Redirect Rule can run
```

Mail records (Resend SPF/DKIM, DMARC, inbound MX) are added when email is enabled — see the runbook §3-8.

---

## 3. TLS & Security Headers

1. **Always Use HTTPS**: on (HTTP 301 → HTTPS).
2. **HSTS**: `max-age=31536000; includeSubDomains`. The API already sends this header (`lib/http.js`).
   Do not submit to the preload list until the domain has run stably for several weeks — preload removal is slow.
3. **SSL/TLS mode**: Workers have no origin server; the default is fine. `Full (Strict)` does no harm.
4. **CSP**: per-console `public/_headers`; `connect-src 'self' https:` already allows `api.olmoa.com`.
   Toss redirects use `window.location.origin`, so no hostname is baked in.

---

## 4. CORS (`api.olmoa.com`)

- `ALLOWED_ORIGINS` (worker secret) is matched exactly against `Origin`; no hostname is hardcoded in the gateway.
- Target value: `https://olmoa.com,https://www.olmoa.com,https://admin.olmoa.com,https://partner.olmoa.com`
  (during the cutover window also keep the old `*.workers.dev` origins, then remove them).
- Allowed headers: `Content-Type`, `Authorization`, `X-Idempotency-Key`. Methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`.

---

## 5. Session Storage (actual behaviour)

The gateway sets **no cookies**. Each console keeps its JWT in `localStorage` on its own origin
(storefront `olmoa_token`, partner `partner_token`, admin `olmoa_admin_token`) and sends it as `Authorization: Bearer`.
Isolation between consoles therefore comes from the browser's per-origin storage, which the separate
`admin.` / `partner.` hostnames preserve. (Version 1.0.0 described `Domain=…; HttpOnly` cookies; that was never implemented.)

---

## 6. Build-time Endpoints (`VITE_*`)

`VITE_API_BASE_URL`, `VITE_STOREFRONT_URL`, `VITE_PARTNER_URL` and `VITE_ADMIN_URL` are baked into the bundles at build
time. DNS changes alone do not move the frontends: every cutover needs a rebuild and redeploy of all five workers (OPS-N05).

- CI: job-level `env` in `.github/workflows/deploy.yml`. It has to be job-level because every `wrangler deploy`
  step re-runs its config's `[build]` command.
- Cloudflare Git-connected builds: the worker's Build → Variables in the dashboard.
- `scripts/vite-require-env.mjs` fails the build when a value is missing in Workers Builds (`WORKERS_CI`) or
  with `OLMOA_REQUIRE_BUILD_ENV=1`, instead of shipping a bundle that throws on boot.
