# OLMOA Commercial Go-Live Verification Gate & Acceptance Checklist

## 1. Executive Go-Live Verdict
> Revised 2026-11-13: the 2026-11-10 verdict (169 open) is stale. Phase3-6 + Waves A-K + NEW-25 scope decision landed since. Authoritative remaining work: this checklist + `reports/HUMAN_CHECKLIST.md` + `docs/NEW25_CONNECTOR_INTEGRATION_PLAN.md` + `reports/P2_WAVE_K_2026-11-13.md`.
- **Current Operational Status**: **NO-GO for public launch (standby: code standby-complete, commercial blockers open)**
- **Public Launch Blocking Grounds**: **code P0 zero; 3 P0 human/external open** (OPS-01 production secrets, OPS-02 Toss live contract, OPS-04 business entity). Closed with code+tests: A07, OPS-N01 (11-10), NEW-P0-01/02 fund-abuse guards 11/11 (11-11).
- **Readiness Score**: **Not scored — gated on P0 closure + human sign-offs in `reports/HUMAN_CHECKLIST.md`**
- **E2E Automated Verification**: **`npm test` exit 0 on 2026-11-13 (full local chain incl. e2e 26/26, multichannel 8/8); remote edge last verified at 11-11 deploy (`/health` UP, d1_50)**

---

## 2. 15 Essential Commercial Go-Live Gates

| # | Commercial Gate Criteria | Status | Verified Evidence / Audit Finding | Action Required for PASS |
| :-: | :--- | :---: | :--- | :--- |
| **G01** | Core E-Commerce Scenarios E2E Pass | **PASS** | `npm test` exit 0 on 2026-11-13 (full local chain; `full_platform_e2e.mjs` 26/26, multichannel 8/8, funds 11/11, p1_store 15/15, p1_admin 17/17) | Maintained in CI; re-run after final deploy |
| **G02** | Zero P0 Severity Defects | **FAIL** | Code P0 zero (A07, OPS-N01, NEW-P0-01/02 closed with tests). 3 P0 human/external open: OPS-01 secrets, OPS-02 Toss live, OPS-04 business entity | Human/external action below |
| **G03** | P1 Defects Explicitly Approved / Closed | **FAIL** | Code P1 zero (storefront/admin/partner/mobile/API P1 closed through phase3-6 + Waves A-K). Open P1-class = external/contract only: carrier API (OPS-03), Toss live + methods (NEW-07/08), R2 bucket (NEW-06), 2FA enrollment (OPS-05), legal review (OPS-09), contracts (OPS-11), DNS/HSTS (OPS-12), store accounts, Wave I integrations (NEW-25 plan) | Contract/human action per item; none is code-fixable pre-contract |
| **G04** | Real Production Database Data Binding | **PASS** | Remote D1 `openmarket-db` bound, verified at 11-11 deploy (`/health` CONNECTED, schema d1_50). Pending: d1_51/d1_52 remote apply at final deploy (additive: FTS, push, remote zones) | Apply d1_51/d1_52 before final deploy |
| **G05** | Server-Side Authentication & Authz | **PASS** | `Authorization: Bearer` JWT only + role guards + 2FA enforcement + refresh rotation (d1_48); p1_sec 14/14, security 85/85 | Set `ADMIN_MFA_APPROVAL_REQUIRED=true` in prod (NEW-13) |
| **G06** | Mobile & Desktop Responsive Parity | **PASS** | Responsive layouts verified (route_smoke 342 cells, 0 horizontal scroll); PWA on all 3 web apps (Wave K); Flutter apps build (APK/AAB) | iOS build + store screenshots remain human items |
| **G07** | Automated Build, Deploy & Rollback | **PASS** | Forward deploy 5 targets + `docs/deployment/ROLLBACK_GUIDE.md` (D1-aware, `wrangler rollback`) + dispatch-only `migrate-d1-remote.yml` (Wave K) | None |
| **G08** | Custom Domain & SSL/TLS Configuration | **READY** | Staging and live workers operational on `*.workers.dev`; route architecture mapped for `olmoa.com`, `api.olmoa.com`, `partner.olmoa.com`, `admin.olmoa.com` | Awaiting registrar DNS CNAME pointer |
| **G09** | Deep Route Refreshing & SPA Handling | **PASS** | Tested `/category/:slug`, `/cart`, `/checkout`, `/orders`, `/channel/*`, `/policy/*`, `/addresses`, `/marketing` returning 200 OK | Verified in assets config |
| **G10** | Error Monitoring & Edge Observability | **PASS** | Worker logs + structured JSON errors with correlation IDs + server Sentry envelope sender (DSN-gated, Wave D) + client-errors table | Inject `SENTRY_DSN` (else no-op) |
| **G11** | Operator & Partner Management Readiness| **PASS** | Partner CSV bulk upload (`POST /partner/products/bulk`), live settlement ledger (`GET /partner/settlements`), and Admin Marketing / Banner manager (`/marketing`) bound to real D1 | Verified in tests |
| **G12** | Mandatory Terms, Privacy & Legal Notice | **FAIL** | Live pages `/legal/*` + `/policy/:type` ALL carry pre-review draft banners pinned by honesty tests (OPS-09); e-finance review open (NEW-14) | 로펌 review → finalize texts → escrow ref |
| **G13** | Git Repository & Server Version Parity | **FAIL** | Branch `fix/v3.2-integrity-regressions` 1 commit ahead of origin + 23 uncommitted paths (Wave K + NEW-25 + this checklist, incl. d1_51/d1_52 consumers); server runs 11-11 build (d1_50) | Final commit + push + deploy on user instruction |
| **G14** | Database Disaster Recovery & Backup | **PASS** | `docs/database/BACKUP_RECOVERY.md` rewritten for D1 (time-travel + `d1 export`, honest RPO/RTO) + local drill record (Wave D) | None (paid-plan 30d vs free 7d caveat in runbook) |
| **G15** | Formal Operator Handover Documentation | **PASS** | Architecture, OpenAPI (201 paths), Wave A-K reports, NEW-25 plan, runbooks, E2E suites | Completed |

---

## 3. Go / No-Go Decision Framework
1. **NO-GO**: If any gate from G02, G08, G11, or G12 is marked FAIL or BLOCKED. *(4 NO-GO triggers active: G02, G03, G12, G13 FAIL; G08 READY-awaiting-DNS)*
2. **CONDITIONAL GO**: Internal pilot testing allowed on `*.workers.dev` staging environments with verified credentials. *(Current state)*
3. **FULL GO**: When G01 through G15 are 100% verified PASS with zero mock data and custom domain `olmoa.com` active. *(Not reached — see remaining-work report)*
