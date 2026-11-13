# OLMOA Official Domain Architecture & Cloudflare Configuration
**Document Version:** 1.0.0  
**Target Domain:** `olmoa.com`  
**Brand:** OLMOA (올모아)  
**Tagline:** 내가 찾는 모든 것, 여기. (Everything You Seek. All Here.)

---

## 1. Official Subdomain Routing & Worker Mapping

| Domain / Subdomain | Target Cloudflare Worker | Role | Status |
|---|---|---|---|
| `https://olmoa.com` | `olmoa-storefront` | Official Customer E-Commerce Storefront | Prepared for Custom Domain |
| `https://www.olmoa.com` | `olmoa-storefront` | CNAME / 301 Permanent Redirect to `olmoa.com` | Prepared for Custom Domain |
| `https://admin.olmoa.com` | `olmoa-admin` | Platform Internal Operator Admin Console | Prepared for Custom Domain |
| `https://partner.olmoa.com` | `olmoa-partner` | Seller Operations & Merchant Portal | Prepared for Custom Domain |
| `https://api.olmoa.com` | `olmoa-api` | Cloudflare D1 Edge Gateway | Prepared for Custom Domain |

---

## 2. Cloudflare DNS Configuration Table

Once `olmoa.com` domain registration is confirmed in Cloudflare Registrar or external registrar:

```dns
;; Zone: olmoa.com
;; Type  Name     Target                               Proxy Status  TTL
A        @        192.0.2.1                            Proxied (Orange Cloud)  Auto
CNAME    www      olmoa.com                            Proxied (Orange Cloud)  Auto
CNAME    admin    olmoa-admin.workers.dev              Proxied (Orange Cloud)  Auto
CNAME    partner  olmoa-partner.workers.dev            Proxied (Orange Cloud)  Auto
CNAME    api      olmoa-api.workers.dev                Proxied (Orange Cloud)  Auto
```

*Note: Worker Custom Domains (`Workers & Pages` -> `Settings` -> `Domains & Routes` -> `Custom Domains`) automatically provision Cloudflare Edge SSL certificates without manual origin server certificates.*

---

## 3. SSL / TLS & Security Policy

1. **SSL/TLS Encryption Mode**: `Full (Strict)` with Cloudflare Universal Edge SSL.
2. **Always Use HTTPS**: Enabled (`HTTP 301` -> `HTTPS`).
3. **HTTP Strict Transport Security (HSTS)**:
   - Max-Age: `31536000` (1 Year)
   - Include Subdomains: `true`
   - Preload: `true`
4. **CORS Policy (`api.olmoa.com`)**:
   - Allowed Origins: `https://olmoa.com`, `https://www.olmoa.com`, `https://admin.olmoa.com`, `https://partner.olmoa.com`
   - Allowed Headers: `Content-Type`, `Authorization`, `X-Idempotency-Key`
   - Allowed Methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`
5. **Cookie Isolation**:
   - Operator and partner JWT/session tokens are bound strictly to their respective subdomains (`admin.olmoa.com` and `partner.olmoa.com`) using `Domain=admin.olmoa.com; Secure; HttpOnly; SameSite=Strict`.
   - Prevent admin credentials from leaking to public storefront cookies.

---

## 5. DNS Cutover Checklist — Frontend Rebuild Required (OPS-N05)

`VITE_*` endpoint URLs are baked into the frontend bundles at build time
(`.env.example`, `.github/workflows/deploy.yml`), so flipping DNS alone leaves
every shipped bundle calling `*.workers.dev`. On cutover day:

1. Set the four build-time URLs to the custom domains:
   - `VITE_API_BASE_URL=https://api.olmoa.com`
   - `VITE_STOREFRONT_URL=https://olmoa.com`
   - `VITE_PARTNER_URL=https://partner.olmoa.com`
   - `VITE_ADMIN_URL=https://admin.olmoa.com`
   (CI: `deploy.yml` env block; manual builds: shell env before `npm run build`.)
2. Update `ALLOWED_ORIGINS` (worker secret) to the four `https://` custom
   domains above — no `workers.dev` leftovers.
3. Rebuild and redeploy all five workers (`npm run deploy:all` or the deploy
   workflow on `main`). A deploy without a rebuild does NOT move traffic.
4. Verify: `/health` on `api.olmoa.com` (`UP`, expected `schemaVersion`),
   one page load per console over the custom domain, and one sandbox test
   order end to end before announcing the cutover.

