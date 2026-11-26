# Changelog — OLMOA openmarket

All notable changes to this project are documented here. Dates are KST (UTC+9).
History before 2026-11-24 lives in git log only.

## [Unreleased]

### Security
- Storefront product descriptions now use the allowlist HTML sanitizer shared
  with the gateway and partner app; the old regex stripper (which let
  `<img/src=x/onerror=...>` through to `v-html`) is removed
  (`apps/storefront/src/utils/stripHtml.ts`, `tests/ui/sanitize_html.test.mjs`).
- Web sessions moved from localStorage tokens to httpOnly cookies
  (`olmoa_at`/`olmoa_rt`, SameSite=Lax, Secure in production). Bearer tokens
  remain for native/mobile clients (dual-mode). New `POST /api/v1/auth/logout`
  revokes the rotation chain and clears cookies
  (`tests/auth_cookie_test.mjs`, `tests/ui/auth_cookie.test.mjs`).
- Gateway `/health` now answers 503 (was 200) when D1 is unreachable, and
  every error response carries a `request_id` (previously 500s only).
- Cron tick hardened: `expireStaleOrders`/`autoConfirmDelivered` failures are
  isolated per job instead of aborting the whole tick
  (`tests/ops_health_test.mjs`).
- Dependencies: postcss 8.4.49 → 8.5.33, vite 5.4.21/6.4.4 → 8.3.8,
  @vitejs/plugin-vue 5.2.4 → 6.0.11, vue-i18n 9.14.5 → 11.4.24,
  vue-tsc 2.2.12 → 3.3.14. `npm audit` is clean (was 10 advisories).
- Local dev secrets (`.dev.vars`) replaced with documented example values;
  handling rules are recorded in the file header.
- Response headers: API JSON responses now carry
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'deny'`; R2
  public file downloads match the D1 branch (nosniff + sandbox CSP). The
  storefront inline theme script moved to `public/theme-init.js` so the
  existing `public/_headers` CSP (`script-src 'self'`) no longer blocks it
  (`tests/response_headers_test.mjs`).
- Mobile token storage verified: both Flutter apps keep JWTs in
  flutter_secure_storage (Keystore/Keychain) with a one-way prefs→keychain
  migration; no change needed.
- Migration versioning is numeric-aware end to end (gateway, harness,
  local-db-reset, all Python ops scripts, remote workflow): d1_100+ no longer
  misorders or skips (`tests/migration_order_test.mjs`). The remote workflow
  snapshots D1 automatically (export + 30-day artifact) before applying, and
  the restore builder fails closed on FK cycles/violations.
- Third-party notices extended with the full Flutter inventory (134 packages,
  no GPL/AGPL).

### Legal & docs
- Added LICENSE (OLMOA proprietary), NOTICE, THIRD_PARTY_NOTICES.md
  (174 packages inventoried, no GPL/AGPL), and this CHANGELOG.
- README refreshed: current stack (no Go core, Flutter apps shipped), 4
  Workers, D1 migrations through d1_77, FOLLOWUP_2026-11-26 progress.
- Competitor trademark removed from package metadata and user-facing copy
  (keywords, README, storefront index.html).

### Fixed
- vue-tsc 3 surfaced five latent `string | number` template arithmetic issues
  in review/store views; coerced with `Number()` (behavior unchanged).
- Consolidated the last triplicated web logic: the 401/refresh fetch wrapper
  now lives once in `@olmoa/ui` (`installApiFetch`) instead of three mains.
- Wired the spell checker into the lint gate (`lint:spell`, cspell 10.5.2,
  960 files clean): fixed 5 real typos (missing-i in `reconciliation`), extended the project
  dictionary to ~476 words, and excluded generated outputs from the scan.
- Browser-verified the storefront shell under the production CSP (theme init
  executes, zero CSP violations) and spot-checked LCP (15/16 routes within
  2500 ms; the single outlier did not reproduce on re-measurement).
- Hardened cookie-session lifecycle (found via browser e2e 16/16): storefront
  restore requires ROLE_CUSTOMER so a seller/admin cookie from another console
  degrades to clean logged-out instead of wrong-identity calls; sessions
  restore on app boot (public pages have no guards); one-shot auth gates await
  the restore. Local API server forwards every Set-Cookie line instead of
  dropping all but one. e2e script uses Bearer API logins for direct calls and
  re-establishes the UI session after console switches.
- Revived the runtime smoke suite (13/13 on workerd + local D1): updated the
  reconciliation count pin (R01–R24 + R04b) and the seller-application payload
  (business_address, cs_email now required).
- Root `tsconfig.json` aligned to `strict: true` (app configs already were);
  removed the invalid `ignoreDeprecations` flag and added `resolveJsonModule`.
- Fixed the App shell category-bar tremor on scroll: the show/hide logic is
  now direction-locked (12px sustained movement), rAF-throttled, reset on
  navigation, and absorbs the 250ms post-flip settle window (the sticky
  header's own height change used to feed scroll events back into a
  self-sustaining oscillation). The collapse transition no longer animates
  `all` and hides the bar from keyboard focus when collapsed. Verified in a
  real browser across desktop/tablet/mobile: 67 flips → 2 with zero
  no-input flips and correct return-on-up
  (`tests/browser/category_tremble.mjs`, SH05 pins). Known edge: a large
  (>12px) unreserved late layout shift after the settle window can still flip
  the bar once; layouts are skeleton-reserved so this is rare in practice.

## [2026-11-26]

- `56da475` feat(6-2,ui): edge rendering, ko-only hreflang, public FAQ,
  console drawer parity.
- `775c3b8` fix(ui): responsive QA fixes across storefront, partner, admin.
- `reports/FOLLOWUP_2026-11-26.md`: 8 follow-up fixes on top of 775c3b8,
  `npm test` 1,143 PASS / 0 FAIL across 117 suites.

## [2026-11-25]

- `09e2ad0` feat(6): phase-6 tasks 6-0..6-10, gate green, API auto-deploy
  restored.
- `89bbf03` ci(deploy): gate the API step to manual dispatch until the
  48360ae audit.
- `f12a401` / `3c05d4b` docs(phase6): decision-21 admin-managed FAQ
  (task 6-13); owner decisions 18-20 with tasks 6-11 (shipping) and 6-12
  (identifiers).
- `274bf85` docs: phase-6 work order (48360ae audit + SEO/AEO/GEO/LLMO/AIO).
- `b58c62f` / `9e581d7` / `292161b` infra(domain): move OLMOA into the domain
  account, connect olmoa.com via the olmoa-edge proxy, apex crawl proxy and
  build-env guard fixes.

## [2026-11-24]

- `48360ae` feat(audit-gaps): close GAP-01..05 (multichannel live bridge, push
  deeplinks, policy keys, samples, docs).
- `fe4e11f` docs(checklist): record green CI + Cloudflare auto-build hazard
  after the d1_74 go-live.
- `1d99eeb` / `72b7ca9` / `7d73257` test(flutter): golden tolerance 1.0% and
  Flutter pinned to locally verified 3.47.8.
