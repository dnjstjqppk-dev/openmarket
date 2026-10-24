import os
import sys
import json
import glob
import sqlite3

sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

conn = sqlite3.connect(":memory:")
conn.row_factory = sqlite3.Row

migrations_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "migrations"))
for mf in sorted(glob.glob(os.path.join(migrations_dir, "d1_*.sql"))):
    with open(mf, "r", encoding="utf-8") as f:
        conn.executescript(f.read())

def exec_one(sql, params):
    cur = conn.cursor()
    cur.execute(sql, params)
    if cur.description:
        rows = [dict(r) for r in cur.fetchall()]
        return {"results": rows, "changes": cur.rowcount}
    else:
        return {"results": [], "changes": cur.rowcount}

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = json.loads(line)
    try:
        if req["type"] == "query":
            res = exec_one(req["sql"], req.get("params", []))
            conn.commit()
            print(json.dumps({"ok": True, "data": res}), flush=True)
        elif req["type"] == "batch":
            out = []
            for st in req["statements"]:
                out.append(exec_one(st["sql"], st.get("params", [])))
            conn.commit()
            print(json.dumps({"ok": True, "data": out}), flush=True)
    except Exception as e:
        conn.rollback()
        print(json.dumps({"ok": False, "error": str(e)}), flush=True)
