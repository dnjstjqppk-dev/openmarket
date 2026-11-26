// apps/cloudflare-gateway/src/services/seo/indexnow.js
// IndexNow queue skeleton (D1-backed; no Redis on prod path). Enqueue
// validates same-site https URLs; drain POSTs one batch and records per-URL
// SENT/FAILED rows. Without INDEXNOW_KEY it fails closed, rows stay PENDING.

import { loadTranslations, contentLangs, productPath } from '../../lib/translations.js';

const DEFAULT_ENDPOINT = 'https://api.indexnow.org/indexnow';
const BATCH = 100;
const fail = (code) => Object.assign(new Error(code), { code });

function baseHost(env) {
  try { return new URL(env.PUBLIC_STOREFRONT_URL || 'https://olmoa.com').host; }
  catch { return 'olmoa.com'; }
}

function assertIndexable(env, raw) {
  const s = String(raw || '').trim();
  let u;
  try { u = new URL(s); } catch { throw fail('INVALID_URL'); }
  if (u.protocol !== 'https:' || u.host !== baseHost(env) || s.length > 2000) throw fail('URL_NOT_INDEXABLE');
  return s;
}

export async function enqueueUrls(env, urls) {
  const list = [...new Set((urls || []).map((u) => assertIndexable(env, u)))].slice(0, 1000);
  if (!list.length) throw fail('URLS_REQUIRED');
  for (const url of list) {
    await env.DB.prepare(`INSERT OR IGNORE INTO indexnow_queue (id, url, status) VALUES (?, ?, 'PENDING')`)
      .bind(crypto.randomUUID(), url).run();
  }
  return { queued: list.length };
}

const indexableOf = (row) => Boolean(row) && row.status === 'ACTIVE' && row.review_status === 'APPROVED';

/** 6-7: notify IndexNow after a product write. Best-effort — the product write
 *  is primary, so a queue failure only logs. A URL is queued when the product
 *  is indexable after the write, or when it just left the indexed set (a removal
 *  signal: IndexNow covers added, updated AND deleted URLs). `before` is the
 *  pre-write { status, review_status } row, or null when it was not read. */
export async function notifyProductChanged(env, productId, before = null) {
  try {
    const after = await env.DB.prepare('SELECT id, title, status, review_status FROM products WHERE id = ?').bind(productId).first();
    if (!indexableOf(after) && !indexableOf(before)) return { queued: 0, skipped: 'NOT_INDEXABLE' };
    const base = String(env.PUBLIC_STOREFRONT_URL || 'https://olmoa.com').replace(/\/$/, '');
    // 2026-11-27 URL scheme: each content language's representative-currency
    // PDP URL (the only indexable ones). A removed product still has its id.
    const product = after || { id: productId, title: '' };
    const tr = await loadTranslations(env, productId);
    return await enqueueUrls(env, contentLangs(tr).map((lang) => `${base}${productPath(product, tr, lang)}`));
  } catch (e) {
    console.warn('indexnow notify failed', productId, String((e && e.message) || e));
    return { queued: 0, skipped: 'NOTIFY_FAILED' };
  }
}

export async function listQueue(env, { status = '', limit = 100 } = {}) {
  const lim = Math.min(500, Math.max(1, Number(limit) || 100));
  const q = status
    ? env.DB.prepare(`SELECT id, url, status, attempts, last_error, created_at, sent_at FROM indexnow_queue
        WHERE status = ? ORDER BY created_at DESC LIMIT ?`).bind(status, lim)
    : env.DB.prepare(`SELECT id, url, status, attempts, last_error, created_at, sent_at FROM indexnow_queue
        ORDER BY created_at DESC LIMIT ?`).bind(lim);
  return (await q.all()).results || [];
}

export async function drainQueue(env, { limit = BATCH } = {}) {
  const key = String(env.INDEXNOW_KEY || '');
  const pending = Number(await env.DB.prepare(`SELECT COUNT(*) AS c FROM indexnow_queue WHERE status = 'PENDING'`).first('c')) || 0;
  if (!key) return { sent: 0, failed: 0, pending, degraded: 'INDEXNOW_NOT_CONFIGURED' };
  const { results } = await env.DB.prepare(`SELECT id, url FROM indexnow_queue WHERE status = 'PENDING'
    ORDER BY created_at ASC LIMIT ?`).bind(Math.min(BATCH, Math.max(1, limit))).all();
  const batch = results || [];
  if (!batch.length) return { sent: 0, failed: 0, pending: 0, degraded: null };
  const host = baseHost(env);
  let ok = false;
  let errMsg = '';
  try {
    const res = await fetch(String(env.INDEXNOW_ENDPOINT || DEFAULT_ENDPOINT), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList: batch.map((r) => r.url) })
    });
    ok = res.ok || res.status === 202;
    if (!ok) errMsg = `INDEXNOW_${res.status}`;
  } catch (e) { errMsg = String((e && e.message) || e).slice(0, 200); }
  for (const r of batch) {
    const stmt = ok
      ? [`UPDATE indexnow_queue SET status = 'SENT', attempts = attempts + 1, sent_at = CURRENT_TIMESTAMP WHERE id = ?`, [r.id]]
      : [`UPDATE indexnow_queue SET status = 'FAILED', attempts = attempts + 1, last_error = ? WHERE id = ?`, [errMsg, r.id]];
    await env.DB.prepare(stmt[0]).bind(...stmt[1]).run();
  }
  return { sent: ok ? batch.length : 0, failed: ok ? 0 : batch.length, pending: 0, degraded: null };
}
