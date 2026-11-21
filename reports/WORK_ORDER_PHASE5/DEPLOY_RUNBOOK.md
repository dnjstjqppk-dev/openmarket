# Phase-5 deploy runbook — backup → migrate → gateway → 3 apps → /health → smoke

Date: 2026-11-17, re-run 2026-11-21. Scope: apply `d1_51` … `d1_74` (24 files) to prod D1
(`openmarket-db`, currently `schemaVersion = d1_50`) and ship the phase-5
code. Every remote step needs explicit operator approval first (work-order
rule 12); the 5-10 rehearsal itself ran **0 remote calls**.

Rehearsal evidence (local only):

- `scripts/ops/rehearse_phase5.py` — builds the d1_50 + dev-seed baseline
  (or copies a `--db` file), applies d1_51..latest one transaction per file
  with FKs ON, gates, then restores the baseline copy and proves
  schema + row counts equal.
- `reports/WORK_ORDER_PHASE5/rehearsal-apply.log` — apply PASS 24/24,
  every step `fk_check=0`, final `MAX = pin = d1_74_seo_crawl.sql`.
- `reports/WORK_ORDER_PHASE5/rehearsal-rollback.log` — rollback PASS
  (schema sha + per-table counts + ledger MAX all equal baseline).
- `reports/WORK_ORDER_PHASE5/rehearsal-summary.json` — full per-step
  per-table counts. Logs carry counts and schema names only, no PII.

Pre-open rerun on the real backup copy (still local, still read-only
towards prod):

```bash
npx wrangler d1 export openmarket-db --remote \
  --output .ops-backups/openmarket-db-<date>-pre-d1_51.sql   # approval first
# load the export into a scratch SQLite file -> /tmp/prod-copy.db, then:
python scripts/ops/rehearse_phase5.py --db /tmp/prod-copy.db --out /tmp/rehearsal-preopen
# expect: {"apply": "PASS", "rollback": "PASS", "steps": "24/24", ...}
```

The script copies `--db` into a temp workdir and never modifies the given
file (sha256 verified identical before/after in 5-10 testing). DB bytes
never land in `--out`; only counts/schema logs do.

---

## Step 0 — Freeze and back up (rollback: nothing to undo yet)

1. Merge `work-order/full` to `main` only after the phase-5 gate is green.
2. Take the pre-migration export (PII inside — keep under git-ignored
   `.ops-backups/`):
   `npx wrangler d1 export openmarket-db --remote --output .ops-backups/openmarket-db-<date>-pre-d1_51.sql`
3. Record the Time Travel bookmark:
   `npx wrangler d1 time-travel info openmarket-db --timestamp <now-RFC3339>`
   (see `docs/database/BACKUP_RECOVERY.md` §1–§2).

Go/no-go: export file exists and is non-empty; bookmark timestamp noted.

## Step 1 — Apply migrations (rollback: Time Travel restore)

1. Run `.github/workflows/migrate-d1-remote.yml` (`workflow_dispatch`,
   type `APPLY`). It reads the remote ledger, applies pending
   `migrations/d1_*.sql` in version order, stops at the first failure.
2. Verify the ledger:
   `npx wrangler d1 execute openmarket-db --remote --command "SELECT MAX(version) FROM schema_migrations"`
   must print `d1_74_seo_crawl.sql`.

Rollback: `npx wrangler d1 time-travel restore openmarket-db --timestamp <step-0 bookmark>`,
then re-check the ledger MAX is back at `d1_50_wave_e_fds_purchase.sql`.
For a deleted-DB disaster, re-import the step-0 export into a fresh DB
and swap the binding (`BACKUP_RECOVERY.md` §2) — never overwrite in place.

## Step 2 — Deploy the gateway (rollback: redeploy previous version)

`npx wrangler deploy --config apps/cloudflare-gateway/wrangler.jsonc`
(or `deploy.yml`). Order matters: migrations BEFORE gateway — new code
against an old schema fails closed with `503 SCHEMA_MISMATCH` on
checkout/quote (wave-K guard), while new schema under old code only
adds unused tables/columns.

Rollback: redeploy the previous gateway version from `main` history;
schema stays at d1_74 (additive, old code ignores the new objects).

## Step 3 — Deploy the 3 apps (rollback: redeploy previous versions)

Rebuild + deploy storefront, partner, admin (each has its own
`apps/*/wrangler.jsonc`; `npm run deploy:all` does gateway + all apps).
On DNS-cutover day follow the `VITE_*` rebuild checklist in
`docs/DOMAIN_CONFIGURATION.md` §5 — a deploy without a rebuild does
not move the baked-in endpoints.

Rollback: redeploy the previous build of the affected app(s).

## Step 4 — Verify /health (rollback: steps 1–3 rollbacks above)

`GET https://api.olmoa.com/health` must show `status: UP`,
`schemaVersion: d1_74_seo_crawl.sql`, and the pre-deploy values of
`operator_entity_active` / `payment` unchanged. Any mismatch → stop,
diagnose, roll back the failing layer per its step above.

## Step 5 — Smoke (rollback: steps 1–3 rollbacks above)

1. `node tests/browser/route_smoke.mjs` — 93 addresses, 0 failures,
   0 horizontal overflow.
2. `npm run test:browser` — must pass.
3. One sandbox test order end to end (no real payment).

Then record the deploy in `admin_audit_log` (reason, versions, health
result) per `BACKUP_RECOVERY.md` §4.

---

## Corrected ranges (do not use the old ones)

- Phase-2 report §4/§6–§7 and phase-4 report §6–§7 say "d1_53부터/∼".
  That range is wrong: d1_51 and d1_52 are also unapplied in prod
  (audit `AUDIT_2026-11-17_REMAINING.md` §4). The correct range is
  **d1_51 … d1_74** (17 wave/phase-4 files + d1_68 legal documents +
  d1_69 KST policy rebuild + d1_70 reminder bookkeeping + d1_71 sourcing +
  d1_72 multichannel rotation + d1_73 fulfillment + d1_74 SEO crawl), exactly what
  the rehearsal script applies. Those old report files are historical
  records and are left as-is; this runbook supersedes their ranges.
