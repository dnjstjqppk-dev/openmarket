# 5-10 pre-fix failure log (rule 13)

Date: 2026-11-17. Recorded before writing `scripts/ops/rehearse_phase5.py`
or `reports/WORK_ORDER_PHASE5/DEPLOY_RUNBOOK.md`.

## 1. Rehearsal entry point missing

Command: `python scripts/ops/rehearse_phase5.py --help`

```
can't open file '.../scripts/ops/rehearse_phase5.py': [Errno 2] No such file or directory
exit=False
```

There is no phase-5 rehearsal: `scripts/` holds only the d1_30~d1_32
one-shot drills (`d1_rehearse_on_backup.py`, `d1_rollback_from_backup.py`),
which cover single destructive migrations, not the d1_51..latest chain,
and `scripts/ops/` does not exist.

## 2. Deploy runbook missing

`Test-Path reports/WORK_ORDER_PHASE5/DEPLOY_RUNBOOK.md` → `False`.

`docs/database/BACKUP_RECOVERY.md` covers backup/restore only; no
backup → migrate → gateway → 3 apps → /health → smoke order with
per-step rollback exists.

## 3. Unrehearsed gap (local evidence, no remote touched)

- Prod `/health` is at `schemaVersion = d1_50`
  (`reports/AUDIT_2026-11-17_REMAINING.md` §1, probed 2026-11-17 13:43 KST;
  not re-queried here — rule 12 forbids remote calls).
- Local chain past prod: 20 files (`d1_51` … `d1_70`) have no apply+rollback
  rehearsal log. The phase-2/phase-4 reports' "d1_53부터" drill range is
  wrong (audit §4: d1_51·d1_52 also unapplied).
- Chain note: the work order says "d1_00~d1_50" but no `d1_00` file exists;
  the baseline is every `d1_*` file up to and including
  `d1_50_wave_e_fds_purchase.sql` plus `migrations/dev/seed_local_dev.sql`.

No prod touched: local file checks only, zero `wrangler` invocations.
