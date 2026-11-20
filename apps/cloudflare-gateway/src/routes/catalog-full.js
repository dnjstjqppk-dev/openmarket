// apps/cloudflare-gateway/src/routes/catalog-full.js
// Own-mall full-catalog search API: the whole ACTIVE catalog behind a
// keyset cursor (updated_at, id) on idx_products_full_catalog — deep pages
// stay O(per_page), never O(page * per_page). Public, no PII in rows.
//
// GET /api/v1/catalog/full?q=&status=ACTIVE&cursor=<updated_at>,<id>&per_page=50
// -> { success, data, pagination: { per_page, next_cursor, has_more, total } }

import { json, bad } from '../lib/http.js';
import { escapeLike } from './catalog.js';

const STATUSES = ['ACTIVE', 'HIDDEN', 'DRAFT'];

function parseCursor(raw) {
  if (!raw) return null;
  const [ts, id] = String(raw).split(',');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts || '') || !id) {
    throw bad('INVALID_CURSOR', '커서 형식이 올바르지 않습니다.');
  }
  return { ts, id };
}

export async function handleCatalogFullRoutes(request, url, env, corsHeaders) {
  if (url.pathname !== '/api/v1/catalog/full' || request.method !== 'GET') return null;

  const status = String(url.searchParams.get('status') || 'ACTIVE').toUpperCase();
  if (!STATUSES.includes(status)) throw bad('INVALID_STATUS', '유효하지 않은 상품 상태입니다.');
  const perPageRaw = Number.parseInt(url.searchParams.get('per_page') || '50', 10);
  const perPage = Math.min(200, Math.max(1, Number.isSafeInteger(perPageRaw) ? perPageRaw : 50));
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 100);
  const cursor = parseCursor(url.searchParams.get('cursor'));

  const binds = [status];
  let where = 'p.status = ?';
  if (q) {
    where += ' AND p.title LIKE ? ESCAPE \'\\\'';
    binds.push(`%${escapeLike(q)}%`);
  }
  const countWhere = where;
  const countBinds = [...binds];
  if (cursor) {
    where += ' AND (p.updated_at, p.id) > (?, ?)';
    binds.push(cursor.ts, cursor.id);
  }
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.title, p.thumbnail_url, p.lowest_original_price, p.lowest_sale_price,
            p.total_sold_count, p.updated_at
     FROM products p WHERE ${where} ORDER BY p.updated_at ASC, p.id ASC LIMIT ?`
  ).bind(...binds, perPage + 1).all();
  const rows = results || [];
  const page = rows.slice(0, perPage);
  const last = page[page.length - 1];
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM products p WHERE ${countWhere}`
  ).bind(...countBinds).first('c');
  return json(corsHeaders, {
    success: true,
    data: page,
    pagination: {
      per_page: perPage, total: Number(total) || 0,
      next_cursor: rows.length > perPage && last ? `${last.updated_at},${last.id}` : null,
      has_more: rows.length > perPage
    }
  });
}
