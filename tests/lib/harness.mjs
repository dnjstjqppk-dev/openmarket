// tests/lib/harness.mjs
// In-process D1 emulator (node:sqlite) + Worker invoker used by all gateway test suites.
// D1 semantics reproduced: prepare/bind/first/all/run, meta.changes, atomic batch() (BEGIN/COMMIT/ROLLBACK),
// and foreign_keys = ON (Cloudflare D1 enforces FKs by default).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
export const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

export function listMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^d1_\d+.*\.sql$/.test(f)).sort();
}

export function createDatabase({ seedFiles = [] } = {}) {
  const db = new DatabaseSync(':memory:');
  for (const mf of listMigrations()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, mf), 'utf-8'));
  }
  for (const sf of seedFiles) {
    db.exec(fs.readFileSync(path.resolve(ROOT, sf), 'utf-8'));
  }
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function execOne(db, sql, params = []) {
  const stmt = db.prepare(sql);
  const head = sql.trim().replace(/^\(+/, '').toUpperCase();
  if (head.startsWith('SELECT') || head.startsWith('PRAGMA') || head.startsWith('WITH') || /\bRETURNING\b/i.test(sql)) {
    const rows = stmt.all(...params);
    return { results: rows.map((r) => ({ ...r })), meta: { changes: 0 } };
  }
  const info = stmt.run(...params);
  return { results: [], meta: { changes: Number(info.changes ?? 0) } };
}

class D1PreparedStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    for (const p of params) {
      if (p === undefined) throw new Error(`D1_TYPE_ERROR: undefined bound in: ${this.sql.slice(0, 80)}`);
    }
    return new D1PreparedStatement(this.db, this.sql, params);
  }
  async all() {
    const r = execOne(this.db, this.sql, this.params);
    return { success: true, results: r.results, meta: r.meta };
  }
  async first(col) {
    const r = execOne(this.db, this.sql, this.params);
    const row = r.results[0] || null;
    return col && row ? row[col] : row;
  }
  async run() {
    const r = execOne(this.db, this.sql, this.params);
    return { success: true, results: r.results, meta: r.meta };
  }
}

export function createD1(db) {
  return {
    prepare(sql) {
      return new D1PreparedStatement(db, sql);
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => {
          const r = execOne(db, s.sql, s.params);
          return { success: true, results: r.results, meta: r.meta };
        });
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(sql) {
      db.exec(sql);
      return { count: 1 };
    }
  };
}

export async function createGateway({ env: envOverrides = {}, seedFiles = [] } = {}) {
  const db = createDatabase({ seedFiles });
  const { default: worker } = await import(path.join(ROOT, 'apps/cloudflare-gateway/src/index.js').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
  const env = { DB: createD1(db), ...envOverrides };
  const scheduled = [];
  const ctx = { waitUntil: (p) => scheduled.push(p), passThroughOnException() {} };

  async function call(pathname, { method = 'GET', headers = {}, body, token } = {}) {
    const h = { ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
    const req = new Request(`https://api.test.local${pathname}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
    });
    const res = await worker.fetch(req, env, ctx);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, headers: res.headers, json, text };
  }

  return { db, env, worker, call, ctx, scheduled };
}

// Minimal test runner with honest PASS/FAIL accounting (no early exit on first failure).
export function createRunner(suiteName) {
  const results = [];
  return {
    async test(name, fn) {
      try {
        await fn();
        results.push({ name, ok: true });
        console.log(`[PASS] ${name}`);
      } catch (e) {
        results.push({ name, ok: false, error: e });
        const where = e && e.stack ? (e.stack.split('\n').find((l) => /tests[\\/][^\\/]+\.mjs/.test(l)) || '').trim() : '';
        const msg = e && e.message ? e.message.replace(/\s*\n\s*/g, ' ').slice(0, 400) : String(e);
        console.log(`[FAIL] ${name}\n       -> ${msg}${where ? `\n       @ ${where}` : ''}`);
      }
    },
    finish() {
      const failed = results.filter((r) => !r.ok);
      console.log(`\n=== ${suiteName}: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
      if (failed.length) process.exitCode = 1;
      return { total: results.length, failed: failed.length };
    }
  };
}
