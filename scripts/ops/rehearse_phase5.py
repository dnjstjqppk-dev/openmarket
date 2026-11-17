"""Phase-5 deploy rehearsal: apply d1_51..latest onto a d1_50 + dev-seed baseline, then prove rollback restores it.

    python scripts/ops/rehearse_phase5.py [--db PATH] [--out DIR] [--workdir DIR] [--keep-workdir]

Pipeline (all local; this script never touches the network, never runs
wrangler, and never mutates the file given via --db):

  1. Baseline: either build d1_01..d1_50 + migrations/dev/seed_local_dev.sql
     into a scratch DB, or copy --db (e.g. a pre-open production-backup copy)
     into scratch space. The pristine baseline copy is kept for rollback.
  2. Apply every migration after the baseline ledger MAX (d1_51..latest on a
     stock baseline), one transaction per file with FKs ON, exactly like D1.
     Each step logs per-table row counts and PRAGMA foreign_key_check.
  3. Post-apply gates: fk_check == 0, integrity_check ok, ledger MAX == newest
     migration file == REQUIRED_SCHEMA_VERSION in services/orders.js.
  4. Rollback: restore the pristine baseline copy over a scratch copy and
     prove schema + per-table counts equal the baseline snapshot.
  5. Write counts-and-schema-only logs (no row values, no PII) to --out
     (default reports/WORK_ORDER_PHASE5/): rehearsal-apply.log,
     rehearsal-rollback.log, rehearsal-summary.json.

Exit code 0 only if apply gates AND rollback verification both pass.
"""

import argparse
import hashlib
import json
import pathlib
import re
import shutil
import sqlite3
import sys
import tempfile
import time
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIG = ROOT / "migrations"
DEV_SEED = MIG / "dev" / "seed_local_dev.sql"
ORDERS_JS = ROOT / "apps" / "cloudflare-gateway" / "src" / "services" / "orders.js"
# Prod /health schemaVersion at the time of the 5-10 work order (audit §1).
# Note: no d1_00 file exists; the baseline is every d1_* file <= BASELINE_FILE.
BASELINE_FILE = "d1_50_wave_e_fds_purchase.sql"

APPLY_LOG = "rehearsal-apply.log"
ROLLBACK_LOG = "rehearsal-rollback.log"
SUMMARY_JSON = "rehearsal-summary.json"


def list_migrations():
    return sorted(f.name for f in MIG.glob("d1_*.sql") if re.match(r"^d1_\d+.*\.sql$", f.name))


def connect(path):
    db = sqlite3.connect(str(path))
    db.execute("PRAGMA foreign_keys = ON;")
    return db


def apply_file(db, path):
    """Apply one migration file as a single transaction (D1 semantics).

    BEGIN/COMMIT ride inside the script text because executescript() would
    implicitly commit a transaction opened beforehand. No migration file
    carries its own transaction statements (verified), so this cannot nest.
    """
    db.isolation_level = None
    try:
        db.executescript("BEGIN;\n" + path.read_text(encoding="utf-8") + "\nCOMMIT;")
    except Exception:
        try:
            db.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        raise


def user_tables(db):
    return [r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]


def table_counts(db):
    return {t: db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in user_tables(db)}


def schema_objects(db):
    """DDL identity of every schema object (names + SQL text only, never row values)."""
    return sorted(db.execute(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_master"
        " WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"))


def schema_sha(objects):
    h = hashlib.sha256()
    for obj in objects:
        h.update(("\x00".join(obj) + "\n").encode("utf-8"))
    return h.hexdigest()


def ledger_max(db):
    try:
        return db.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0]
    except sqlite3.Error:
        return None


def ledger_versions(db):
    try:
        return sorted(r[0] for r in db.execute("SELECT version FROM schema_migrations"))
    except sqlite3.Error:
        return []


def fk_violations(db):
    rows = db.execute("PRAGMA foreign_key_check").fetchall()
    tables = sorted({r[1] for r in rows}) if rows else []
    return len(rows), tables


def integrity_ok(db):
    return db.execute("PRAGMA integrity_check").fetchall() == [("ok",)]


def required_schema_version():
    m = re.search(r"REQUIRED_SCHEMA_VERSION\s*=\s*'([^']+)'", ORDERS_JS.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit("REQUIRED_SCHEMA_VERSION not found in services/orders.js")
    return m.group(1)


def main():
    ap = argparse.ArgumentParser(description="Phase-5 migration + rollback rehearsal (local only).")
    ap.add_argument("--db", help="rehearse on a COPY of this DB file (e.g. pre-open prod-backup copy); the file itself is never modified")
    ap.add_argument("--out", default=str(ROOT / "reports" / "WORK_ORDER_PHASE5"),
                    help="directory for counts-and-schema-only logs (default: reports/WORK_ORDER_PHASE5)")
    ap.add_argument("--workdir", help="scratch dir for DB copies (default: fresh temp dir; DB bytes never go to --out)")
    ap.add_argument("--keep-workdir", action="store_true", help="do not delete the scratch dir")
    args = ap.parse_args()

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    workdir = pathlib.Path(args.workdir) if args.workdir else pathlib.Path(tempfile.mkdtemp(prefix="rehearse_phase5_"))
    workdir.mkdir(parents=True, exist_ok=True)
    baseline_db = workdir / "baseline.db"
    rehearsed_db = workdir / "rehearsed.db"
    rolled_back_db = workdir / "rolled_back.db"

    apply_lines = [f"# phase-5 rehearsal apply log — {stamp} — local only, no remote calls",
                   f"# root={ROOT.name} workdir=<scratch> baseline_source={'--db copy' if args.db else 'built d1_<=d1_50 + dev seed'}"]
    files = list_migrations()
    if BASELINE_FILE not in files:
        raise SystemExit(f"{BASELINE_FILE} missing from migrations/")

    # ---- 1. baseline ----
    if args.db:
        src = pathlib.Path(args.db)
        if not src.is_file():
            raise SystemExit(f"--db not found: {src}")
        shutil.copyfile(src, baseline_db)
        db = connect(baseline_db)
        base_max = ledger_max(db)
        n_fk, fk_tables = fk_violations(db)
        apply_lines.append(f"baseline: copy of {src.name} ({src.stat().st_size} bytes), ledger MAX={base_max}, "
                           f"foreign_key_check={n_fk} {fk_tables}")
        if n_fk:
            raise SystemExit(f"baseline {src.name} already has {n_fk} FK violations; refusing to rehearse on it")
        pending = [f for f in files if base_max is None or f > base_max]
        db.close()
    else:
        db = connect(baseline_db)
        for f in files:
            if f > BASELINE_FILE:
                break
            apply_file(db, MIG / f)
        apply_file(db, DEV_SEED)
        base_max = ledger_max(db)
        db.close()
        if base_max != BASELINE_FILE:
            raise SystemExit(f"built baseline ledger MAX={base_max}, expected {BASELINE_FILE}")
        pending = [f for f in files if f > BASELINE_FILE]
        apply_lines.append(f"baseline: built {BASELINE_FILE} + dev seed, ledger MAX={base_max}")
    if not pending:
        raise SystemExit("no pending migrations after the baseline ledger MAX; nothing to rehearse")
    apply_lines.append(f"pending: {pending[0]}..{pending[-1]} ({len(pending)} files)")

    db = connect(baseline_db)
    base_counts = table_counts(db)
    base_schema = schema_objects(db)
    base_sha = schema_sha(base_schema)
    base_ledger = ledger_versions(db)
    db.close()
    apply_lines.append(f"baseline: {len(base_schema)} schema objects (sha256 {base_sha[:16]}…), "
                       f"{len(base_counts)} tables, {sum(base_counts.values())} rows total, "
                       f"ledger rows={len(base_ledger)}")

    # ---- 2. apply pending in order ----
    shutil.copyfile(baseline_db, rehearsed_db)
    db = connect(rehearsed_db)
    steps = []
    prev_counts, prev_schema = base_counts, base_schema
    ok = True
    for f in pending:
        t0 = time.monotonic()
        try:
            apply_file(db, MIG / f)
        except Exception as e:
            ok = False
            apply_lines.append(f"[FAIL] {f}: {type(e).__name__}: {e}")
            break
        secs = time.monotonic() - t0
        counts = table_counts(db)
        schema = schema_objects(db)
        n_fk, fk_tables = fk_violations(db)
        new_max = ledger_max(db)
        changed = {t: [prev_counts.get(t, 0), counts.get(t, 0)]
                   for t in sorted(set(prev_counts) | set(counts))
                   if prev_counts.get(t, 0) != counts.get(t, 0)}
        added = [n for _, n, _, _ in schema if n not in {x[1] for x in prev_schema}]
        removed = [n for _, n, _, _ in prev_schema if n not in {x[1] for x in schema}]
        if n_fk:
            ok = False
        apply_lines.append(
            f"[{'FAIL' if n_fk else 'ok'}] {f} ({secs:.2f}s) ledger={new_max} "
            f"rows={sum(counts.values())} (+{sum(counts.values()) - sum(prev_counts.values())}) "
            f"fk_check={n_fk}{(' ' + ','.join(fk_tables)) if fk_tables else ''}"
            + (f" changed={json.dumps(changed, ensure_ascii=False)}" if changed else " changed={}")
            + (f" added={added}" if added else "") + (f" removed={removed}" if removed else ""))
        steps.append({"file": f, "seconds": round(secs, 3), "ledger_max": new_max,
                      "rows_total": sum(counts.values()), "changed_tables": changed,
                      "fk_violations": n_fk, "fk_tables": fk_tables,
                      "schema_added": added, "schema_removed": removed, "tables": counts})
        prev_counts, prev_schema = counts, schema

    # ---- 3. post-apply gates ----
    final_counts, final_schema = prev_counts, prev_schema
    final_sha = schema_sha(final_schema)
    final_fk, final_fk_tables = fk_violations(db)
    final_max = ledger_max(db)
    final_ledger = ledger_versions(db)
    integ = integrity_ok(db)
    pin = required_schema_version()
    db.close()
    gates = {
        "all_steps_applied": ok and len(steps) == len(pending),
        "foreign_key_check_zero": final_fk == 0,
        "integrity_check_ok": integ,
        "ledger_max_is_newest_file": final_max == files[-1],
        "ledger_grew_by_step_count": len(final_ledger) == len(base_ledger) + len(pending),
        "code_pin_tracks_newest_file": pin == files[-1],
    }
    apply_ok = all(gates.values())
    apply_lines.append(f"post-apply: MAX={final_max} pin={pin} rows={sum(final_counts.values())} "
                       f"schema_sha={final_sha[:16]}… fk={final_fk} integrity={'ok' if integ else 'FAIL'}")
    apply_lines.append(f"apply {'PASS' if apply_ok else 'FAIL'}: {json.dumps(gates, ensure_ascii=False)}")
    (out / APPLY_LOG).write_text("\n".join(apply_lines) + "\n", encoding="utf-8")

    # ---- 4. rollback: restore the pristine baseline copy, prove equality ----
    rb_lines = [f"# phase-5 rehearsal rollback log — {stamp} — restore baseline copy, compare with baseline snapshot"]
    rb_ok = True
    if not apply_ok:
        rb_lines.append("rollback SKIPPED: apply did not pass, nothing meaningful to roll back")
        rb_ok = False
    else:
        shutil.copyfile(baseline_db, rolled_back_db)
        db = connect(rolled_back_db)
        rb_counts = table_counts(db)
        rb_schema = schema_objects(db)
        rb_sha = schema_sha(rb_schema)
        rb_max = ledger_max(db)
        rb_fk, _ = fk_violations(db)
        rb_integ = integrity_ok(db)
        db.close()
        count_diff = {t: [base_counts.get(t, 0), rb_counts.get(t, 0)]
                      for t in sorted(set(base_counts) | set(rb_counts))
                      if base_counts.get(t, 0) != rb_counts.get(t, 0)}
        schema_diff = [n for _, n, _, _ in rb_schema if (n not in {x[1] for x in base_schema})] + \
                      [n for _, n, _, _ in base_schema if (n not in {x[1] for x in rb_schema})]
        sql_diff = [n for (a, b) in zip(sorted(base_schema), sorted(rb_schema)) if a != b for n in [a[1]]]
        checks = {
            "row_counts_equal_baseline": rb_counts == base_counts,
            "schema_objects_equal_baseline": rb_schema == base_schema,
            "ledger_max_equal_baseline": rb_max == base_max,
            "foreign_key_check_zero": rb_fk == 0,
            "integrity_check_ok": rb_integ,
            "rollback_actually_reverted": rb_sha != final_sha,
        }
        rb_ok = all(checks.values())
        rb_lines.append(f"restored: {len(rb_schema)} schema objects (sha256 {rb_sha[:16]}…), "
                        f"{sum(rb_counts.values())} rows total, ledger MAX={rb_max}, fk={rb_fk}")
        rb_lines.append(f"baseline: sha256 {base_sha[:16]}… vs restored {rb_sha[:16]}… "
                        f"vs rehearsed {final_sha[:16]}…")
        if count_diff:
            rb_lines.append(f"count diffs: {json.dumps(count_diff, ensure_ascii=False)}")
        if schema_diff or sql_diff:
            rb_lines.append(f"schema diffs: objects={schema_diff} sql_changed={sql_diff}")
        rb_lines.append(f"rollback {'PASS' if rb_ok else 'FAIL'}: {json.dumps(checks, ensure_ascii=False)}")
    (out / ROLLBACK_LOG).write_text("\n".join(rb_lines) + "\n", encoding="utf-8")

    summary = {"stamp_utc": stamp, "baseline_max": base_max, "newest_file": files[-1],
               "pending_count": len(pending), "baseline_rows_total": sum(base_counts.values()),
               "baseline_tables": base_counts, "baseline_schema_sha256": base_sha,
               "final_rows_total": sum(final_counts.values()), "final_schema_sha256": final_sha,
               "apply_gates": gates, "apply_pass": apply_ok, "rollback_pass": rb_ok,
               "remote_calls": 0, "steps": steps}
    (out / SUMMARY_JSON).write_text(json.dumps(summary, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    print(json.dumps({"apply": "PASS" if apply_ok else "FAIL", "rollback": "PASS" if rb_ok else "FAIL",
                      "steps": f"{len(steps)}/{len(pending)}", "baseline": base_max, "newest": files[-1],
                      "logs": [APPLY_LOG, ROLLBACK_LOG, SUMMARY_JSON], "remote_calls": 0},
                     ensure_ascii=False))
    if not args.keep_workdir and not args.workdir:
        shutil.rmtree(workdir, ignore_errors=True)
    sys.exit(0 if (apply_ok and rb_ok) else 1)


if __name__ == "__main__":
    main()
