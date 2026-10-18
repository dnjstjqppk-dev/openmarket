# OLMOA Custom Domain & Production Infrastructure Readiness Guide

## 1. Executive Summary
This document defines the technical roadmap for transitioning OLMOA from the temporary staging domains (`*.workers.dev`) to the official commercial production domain (`olmoa.com`).

```
                    +--------------------+
                    | Cloudflare DNS WAF |
                    +---------+----------+
                              |
    +---------------+---------+---------+---------------+
    |               |                   |               |
    v               v                   v               v
 Storefront      API Gateway      Partner Center   Admin Console
 olmoa.com     api.olmoa.com     partner.olmoa.com admin.olmoa.com
 www.olmoa.com
```

## 2. DNS Zone & Subdomain Mapping Architecture

| Subdomain | Target Service | Cloudflare Binding Type | SSL/TLS Mode |
| :--- | :--- | :--- | :--- |
| `olmoa.com` | `openmarket` (Storefront) | Custom Domain / Apex CNAME | Full (Strict) |
| `www.olmoa.com` | `openmarket` (Storefront) | CNAME to `olmoa.com` | Full (Strict) |
| `api.olmoa.com` | `olmoa-api` (Gateway) | Custom Domain / Worker Route | Full (Strict) |
| `partner.olmoa.com` | `olmoa-partner` (Seller) | Custom Domain / Worker Asset | Full (Strict) |
| `admin.olmoa.com` | `olmoa-admin` (Operator) | Custom Domain / Worker Asset | Full (Strict) |

## 3. SSL/TLS & Security Policy
- **Minimum TLS Version**: TLS 1.3 enforced.
- **HSTS (HTTP Strict Transport Security)**: Enabled with `max-age=31536000; includeSubDomains; preload`.
- **Apex vs WWW Policy**: 
  - Standard Canonical: `https://olmoa.com` (Apex).
  - Rule: `http://*` and `https://www.*` 301 permanently redirects to `https://olmoa.com/$1`.
- **Security Headers Injection**:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY` (for storefront and admin)
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Content-Security-Policy: default-src 'self' ...`

## 4. CORS & Cookie Isolation Matrix

```
Client Origin                Allowed Target API       Allowed Headers
-----------------------------------------------------------------------------------------
https://olmoa.com            https://api.olmoa.com    Content-Type, Authorization, X-Customer-Id
https://partner.olmoa.com    https://api.olmoa.com    Content-Type, Authorization, X-Partner-Id
https://admin.olmoa.com      https://api.olmoa.com    Content-Type, Authorization, X-Admin-Secret
* (External PriceScanner)    https://api.olmoa.com    X-Integration-Key
```

## 5. Cloudflare CDN Caching & Edge WAF Rules
- **Static Assets (`/assets/*`, `.svg`, `.png`)**: `Cache-Control: public, max-age=31536000, immutable`.
- **HTML SPA Shell (`index.html`)**: `Cache-Control: no-cache, no-transform`.
- **Dynamic API Routes (`/api/v1/*`)**: Bypass cache (`no-store`), except PriceScanner feed (`public, max-age=60`).
- **WAF Bot Fight Mode**: Active on all paths, strictly protecting catalog against headless scrapers.
- **Rate Limiting**: 120 req/min for general endpoints; 30 req/min for `/api/v1/orders/checkout`.

## 6. Zero-Downtime Transition Checklist
1. Purchase/transfer `olmoa.com` to Cloudflare Registrar.
2. In Cloudflare Workers Dashboard, navigate to each Worker > Settings > Triggers > Add Custom Domain.
3. Update `apps/storefront/src/config.ts`, `apps/admin/src/config.ts`, `apps/partner/src/config.ts` to point `API_BASE_URL` to `https://api.olmoa.com`.
4. Rebuild frontends (`npm run build`) and execute `wrangler deploy`.
5. Verify live SSL handshake, canonical 301 redirects, and CORS cross-domain calls.
