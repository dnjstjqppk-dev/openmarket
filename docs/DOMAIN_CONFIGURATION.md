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
| `https://api.olmoa.com` | `olmoa-api` | Go Backend & Cloudflare D1 Edge Gateway | Prepared for Custom Domain |

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

