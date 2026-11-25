"""Build a single D1 restore script for moving openmarket-db to another account.

`wrangler d1 export` refuses databases with FTS5 tables, so the export is taken per
table (CREATE TABLE + INSERT only: no indexes, no triggers). This script stitches:
  1. every CREATE TABLE, then the INSERTs grouped per table in foreign-key order
     (D1 enforces FKs and the export is alphabetical, so children can precede parents),
  2. product_search_fts (definition + backfill copied from migrations/d1_51),
  3. account-move fixups (stored file URLs -> new API host; TOTP reset because the
     TOTP key is regenerated),
  4. every index and trigger from production sqlite_master (DDL json),
and rehearses the result on a local SQLite copy with foreign keys ON.

usage: python -I build_d1_restore.py <export.sql> <ddl.json> <out.sql> <old_api_origin> <new_api_origin>
"""
import json
import re
import sqlite3
import sys
from pathlib import Path

export_path, ddl_path, out_path, old_api, new_api = sys.argv[1:6]
root = Path(__file__).resolve().parents[2]
export_sql = Path(export_path).read_text(encoding='utf-8')
ddl = json.loads(Path(ddl_path).read_text(encoding='utf-8'))[0]['results']

# --- 1. split the export into statements and order them -------------------------
stmts, buf = [], ''
for line in export_sql.splitlines(keepends=True):
    buf += line
    if sqlite3.complete_statement(buf):
        stmts.append(buf.strip())
        buf = ''
assert not buf.strip(), 'trailing partial statement in export'

pragmas = [x for x in stmts if re.match(r'PRAGMA', x, re.I)]
creates = [x for x in stmts if re.match(r'CREATE TABLE', x, re.I)]
inserts = {}
for x in stmts:
    m = re.match(r'INSERT INTO\s+"?([A-Za-z0-9_]+)"?', x, re.I)
    if m:
        inserts.setdefault(m.group(1), []).append(x)
other = [x for x in stmts if not re.match(r'(PRAGMA|CREATE TABLE|INSERT INTO)', x, re.I)]
assert not other, f'unexpected statements: {[o[:60] for o in other]}'

scratch = sqlite3.connect(':memory:')
for c in creates:
    scratch.execute(c)
names = [r[0] for r in scratch.execute("SELECT name FROM sqlite_master WHERE type='table'")]
deps = {t: {r[2] for r in scratch.execute(f'PRAGMA foreign_key_list("{t}")') if r[2] != t and r[2] in names}
        for t in names}
order, seen, cycles = [], set(), []


def visit(t, stack=()):
    if t in seen:
        return
    if t in stack:
        cycles.append(t)
        return
    for d in sorted(deps[t]):
        visit(d, stack + (t,))
    seen.add(t)
    order.append(t)


for t in sorted(names):
    visit(t)
missing = set(inserts) - set(names)
assert not missing, f'inserts for unknown tables: {missing}'

# D1's --file import does NOT honour PRAGMA defer_foreign_keys (observed 2026-11-25: the
# import rolled back with FOREIGN KEY constraint failed). So rows must be parent-first
# even inside self-referencing tables (categories.parent_id). Load the data FK-off into
# the scratch copy and regenerate every INSERT with quote(), ordered by tree depth.
for t in order:
    for i in inserts.get(t, []):
        scratch.execute(i)


def regenerate(t):
    cols = [r[1] for r in scratch.execute(f'PRAGMA table_info("{t}")')]
    column_list = ', '.join(f'"{c}"' for c in cols)
    values = " || ', ' || ".join(f'quote("{c}")' for c in cols)
    select = f"""SELECT 'INSERT INTO "{t}" ({column_list}) VALUES (' || {values} || ');' FROM "{t}" AS x"""
    self_fks = [(r[3], r[4]) for r in scratch.execute(f'PRAGMA foreign_key_list("{t}")') if r[2] == t]
    if self_fks:
        child, parent = self_fks[0]
        assert len(self_fks) == 1, f'{t}: multiple self FKs'
        sql = f"""WITH RECURSIVE tree(pk, lvl) AS (
              SELECT "{parent}", 0 FROM "{t}" WHERE "{child}" IS NULL OR "{child}" NOT IN (SELECT "{parent}" FROM "{t}")
              UNION ALL SELECT c."{parent}", tree.lvl + 1 FROM "{t}" c JOIN tree ON c."{child}" = tree.pk)
            {select} JOIN tree ON x."{parent}" = tree.pk ORDER BY tree.lvl, x.rowid"""
    else:
        sql = select + ' ORDER BY x.rowid'
    rows = [r[0] for r in scratch.execute(sql)]
    assert len(rows) == len(inserts.get(t, [])), f'{t}: regenerated {len(rows)} != exported {len(inserts.get(t, []))}'
    return rows


inserts = {t: regenerate(t) for t in order if inserts.get(t)}
pragmas = []  # defer_foreign_keys is not honoured by the D1 import; ordering does the job

# --- 2. FTS, 3. fixups, 4. indexes/triggers --------------------------------------
d1_51 = (root / 'migrations/d1_51_wave_h_search_push_recommend.sql').read_text(encoding='utf-8')
fts_create = re.search(r'CREATE VIRTUAL TABLE IF NOT EXISTS product_search_fts.*?\);', d1_51, re.S).group(0)
fts_backfill = re.search(r'INSERT INTO product_search_fts \(product_id, title, brand, category_name\)\s*SELECT.*?;',
                         d1_51, re.S).group(0)


def lit(s):
    return "'" + s.replace("'", "''") + "'"


fixups = [
    f"UPDATE storage_objects SET public_url = REPLACE(public_url, {lit(old_api)}, {lit(new_api)}) "
    f"WHERE public_url LIKE {lit(old_api + '%')};",
    "UPDATE users SET totp_secret_enc = NULL, totp_pending_enc = NULL, totp_enabled_at = NULL, "
    "totp_last_step = NULL, mfa_recovery_hashes_json = NULL, token_version = token_version + 1 "
    "WHERE totp_secret_enc IS NOT NULL OR totp_pending_enc IS NOT NULL;",
]
objs = [d['sql'].rstrip().rstrip(';') + ';' for kind in ('index', 'view', 'trigger') for d in ddl if d['type'] == kind]

body = pragmas + creates + [i for t in order for i in inserts.get(t, [])] + \
    ['-- FTS (d1_51)', fts_create, fts_backfill, '-- account move fixups'] + fixups + \
    ['-- indexes, views, triggers from production sqlite_master'] + objs
out = '\n'.join(body) + '\n'
Path(out_path).write_text(out, encoding='utf-8')

# --- rehearsal (foreign keys ON, like D1) -----------------------------------------
db = sqlite3.connect(':memory:')
db.isolation_level = None  # autocommit
db.execute('PRAGMA foreign_keys = ON')
# Strict: FKs enforced statement by statement, no deferral (what the D1 import did).
db.executescript(out)
kinds = dict(db.execute("SELECT type, COUNT(*) FROM sqlite_master WHERE sql IS NOT NULL GROUP BY type").fetchall())
print('fk cycles', cycles)
print('objects (sql not null)', kinds)
print('fts rows', db.execute('SELECT COUNT(*) FROM product_search_fts').fetchone()[0],
      'products', db.execute('SELECT COUNT(*) FROM products').fetchone()[0])
print('old-host urls left', db.execute('SELECT COUNT(*) FROM storage_objects WHERE public_url LIKE ?',
                                       (old_api + '%',)).fetchone()[0])
print('totp enabled left', db.execute('SELECT COUNT(*) FROM users WHERE totp_secret_enc IS NOT NULL').fetchone()[0])
print('fk violations', len(db.execute('PRAGMA foreign_key_check').fetchall()))
tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' "
                                   "AND name NOT LIKE 'product_search_fts%' AND name NOT LIKE 'sqlite_%'")]
counts = {t: db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}
Path(out_path + '.counts.json').write_text(json.dumps(counts, indent=0, sort_keys=True), encoding='utf-8')
print('tables', len(tables), 'rows', sum(counts.values()))
