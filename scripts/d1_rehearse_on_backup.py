"""Rehearse a production data migration on a copy of the production rows and build its rollback.

    python scripts/d1_rehearse_on_backup.py <profile> <backup_dir> <rollback.sql>

<profile> is a key of PROFILES below (d1_31, d1_32). <backup_dir> (keep it under the git-ignored .ops-backups/: the
rows include personal data) holds `wrangler d1 execute --json` exports named backup_<table>.json for every table the
profile lists. The script
  1. builds the schema from every d1_*.sql migration before the target in an in-memory SQLite and loads the exports,
  2. runs the migration and prints what it changes plus the profile's expected-result queries,
  3. writes a rollback (UPDATEs back to the exported values + DELETE of the rows the migration inserts; triggers of
     those tables are dropped for the restore and recreated from their exact schema text, because state-machine and
     immutability triggers forbid e.g. CANCELLED -> PAID or ledger deletes by design),
  4. runs the rollback and proves every exported row and the trigger set are back exactly,
  5. runs the migration twice on a fresh copy to prove the second run changes nothing.
Exit code 0 only if all checks hold and every profile assertion is met.
"""
import json
import pathlib
import sqlite3
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIG = ROOT / "migrations"

PROFILES = {
    "d1_31": {
        "migration": "d1_31_void_unpaid_orders_marked_paid.sql",
        "tables": ["products", "product_skus", "orders", "sub_orders", "order_items", "settlements", "inventory_ledger", "payment_transactions"],
        "changed": {"orders": "id", "sub_orders": "id", "settlements": "id", "product_skus": "id", "products": "id"},
        "inserted": {"inventory_ledger": "ldg_d1_31_%", "admin_audit_log": "aud_d1_31_%"},
        "expected": {
            "settlements_cancelled": "SELECT COUNT(*) FROM settlements WHERE status = 'CANCELLED'",
            "units_restocked": "SELECT COALESCE(SUM(quantity_delta), 0) FROM inventory_ledger WHERE id LIKE 'ldg_d1_31_%'",
            "sold_total_after": "SELECT SUM(total_sold_count) FROM products",
            "remaining_paid_without_payment": "SELECT COUNT(*) FROM orders WHERE payment_status = 'PAID' AND paid_at IS NULL",
        },
        "must_be_zero": ["remaining_paid_without_payment"],
    },
    "d1_32": {
        "migration": "d1_32_cancel_settlements_of_cancelled_orders.sql",
        "tables": ["orders", "sub_orders", "settlements"],
        "changed": {"settlements": "id"},
        "inserted": {"admin_audit_log": "aud_d1_32_%"},
        "expected": {
            "settlements_cancelled_now": "SELECT COUNT(*) FROM admin_audit_log WHERE id LIKE 'aud_d1_32_%'",
            "amount_no_longer_payable": "SELECT COALESCE(SUM(json_extract(before_json, '$.net_payout_amount')), 0) FROM admin_audit_log WHERE id LIKE 'aud_d1_32_%'",
            "r23_violations_after": """SELECT COUNT(*) FROM settlements st JOIN sub_orders s ON s.id = st.sub_order_id JOIN orders o ON o.id = s.parent_order_id
                                       WHERE st.payout_id IS NULL AND ((st.status IN ('HOLD','PENDING','ELIGIBLE_FOR_PAYOUT') AND s.status IN ('CANCELLED','EXPIRED'))
                                          OR (st.status IN ('PENDING','ELIGIBLE_FOR_PAYOUT') AND o.paid_at IS NULL))""",
        },
        "must_be_zero": ["r23_violations_after"],
    },
}


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def load(backup_dir, tables):
    data = {}
    for t in tables:
        j = json.loads((backup_dir / f"backup_{t}.json").read_text(encoding="utf-8"))
        if not j[0].get("success"):
            raise SystemExit(f"backup_{t}.json is not a successful export")
        data[t] = j[0]["results"]
    return data


def fresh_db(profile, data):
    db = sqlite3.connect(":memory:")
    for f in sorted(MIG.glob("d1_*.sql")):
        if f.name >= profile["migration"]:
            break
        db.executescript(f.read_text(encoding="utf-8"))
    for t in profile["tables"]:  # the copy must contain production rows only, no seed rows
        db.execute(f"DELETE FROM {t}")
    db.execute("DELETE FROM admin_audit_log")
    for t in profile["tables"]:
        for r in data[t]:
            cols = list(r)
            db.execute(f"INSERT INTO {t} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", [r[c] for c in cols])
    db.commit()
    return db


def snapshot(db, table, key="id"):
    db.row_factory = sqlite3.Row
    out = {r[key]: dict(r) for r in db.execute(f"SELECT * FROM {table}")}
    db.row_factory = None
    return out


def triggers_of(db, tables):
    return db.execute("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN (%s) ORDER BY name"
                      % ",".join(lit(t) for t in tables)).fetchall()


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in PROFILES:
        raise SystemExit(__doc__)
    profile = PROFILES[sys.argv[1]]
    backup_dir, out_sql = pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
    sql = (MIG / profile["migration"]).read_text(encoding="utf-8")
    changed, inserted = profile["changed"], profile["inserted"]
    data = load(backup_dir, profile["tables"])

    db = fresh_db(profile, data)
    before = {t: snapshot(db, t, k) for t, k in changed.items()}
    db.executescript(sql)
    after = {t: snapshot(db, t, k) for t, k in changed.items()}

    triggers = triggers_of(db, list(changed) + list(inserted))
    changes = {}
    rollback = [f"-- rollback for migrations/{profile['migration']}, generated by scripts/d1_rehearse_on_backup.py {sys.argv[1]}",
                "-- triggers on the restored tables are dropped for the restore and recreated unchanged at the end"]
    rollback += [f"DROP TRIGGER IF EXISTS {name};" for name, _ in triggers]
    for t, key in changed.items():
        ids = [k for k in before[t] if before[t][k] != after[t].get(k)]
        changes[t] = len(ids)
        for k in ids:
            cols = [c for c in before[t][k] if before[t][k][c] != after[t][k][c]]
            rollback.append(f"UPDATE {t} SET {', '.join(f'{c} = {lit(before[t][k][c])}' for c in cols)} WHERE {key} = {lit(k)};")
    for t, pattern in inserted.items():
        changes[f"{t}_inserted"] = db.execute(f"SELECT COUNT(*) FROM {t} WHERE id LIKE ?", (pattern,)).fetchone()[0]
        rollback.append(f"DELETE FROM {t} WHERE id LIKE {lit(pattern)};")
    rollback += [s.rstrip(";") + ";" for _, s in triggers]
    out_sql.write_text("\n".join(rollback) + "\n", encoding="utf-8")

    expected = {name: db.execute(q).fetchone()[0] for name, q in profile["expected"].items()}

    db.executescript("\n".join(rollback))
    restored = {t: snapshot(db, t, k) for t, k in changed.items()}
    rollback_ok = all(restored[t] == before[t] for t in changed) and triggers_of(db, list(changed) + list(inserted)) == triggers and all(
        db.execute(f"SELECT COUNT(*) FROM {t} WHERE id LIKE ?", (p,)).fetchone()[0] == 0 for t, p in inserted.items())

    watch = list(changed) + [t for t in inserted if t not in changed]
    db2 = fresh_db(profile, data)
    db2.executescript(sql)
    first = {t: snapshot(db2, t) for t in watch}
    db2.executescript(sql)
    idempotent = first == {t: snapshot(db2, t) for t in watch}

    assertions_ok = all(expected[n] == 0 for n in profile["must_be_zero"])
    print(json.dumps({"migration": profile["migration"], "changes": changes, "expected": expected,
                      "rollback_restores_exactly": rollback_ok, "second_run_is_noop": idempotent,
                      "assertions_ok": assertions_ok, "rollback_lines": len(rollback)}, ensure_ascii=False, indent=1))
    sys.exit(0 if rollback_ok and idempotent and assertions_ok else 1)


if __name__ == "__main__":
    main()
