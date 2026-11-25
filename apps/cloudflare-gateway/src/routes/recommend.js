// apps/cloudflare-gateway/src/routes/recommend.js
// Wave H-3: recommendations from real behavior — co-purchase (shared paid
// orders), co-view (same user, same day), and popularity fill. Only ACTIVE
// products are ever recommended; every response reports which signal each
// row came from. View logging is one row per user+product+day (bounded).

import { requireCustomer, authenticate } from '../lib/auth.js';
import { json, bad, notFound } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { sellableSql } from '../lib/shipping-policy.js';

const CARD = `
  SELECT p.id, p.id AS slug, p.title, p.thumbnail_url, p.lowest_sale_price, p.lowest_original_price,
         p.total_sold_count,
         (SELECT ROUND(AVG(r.rating), 1) FROM product_reviews r WHERE r.product_id = p.id) AS avg_rating,
         COALESCE((SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id), 0) AS review_count,
         COALESCE(pt.business_name, 'OLMOA DIRECT') AS brand,
         pt.base_shipping_fee, pt.free_shipping_threshold,
         c.slug AS category_slug
  FROM products p
  LEFT JOIN partners pt ON p.partner_id = pt.id
  LEFT JOIN categories c ON p.category_id = c.id`;

const PAID = `('PAID', 'PARTIAL_REFUNDED', 'REFUNDED')`;

function pageLimit(raw, fallback = 8) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n < 1) return fallback;
  return Math.min(20, n);
}

async function cardsByIds(env, ids) {
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `${CARD} WHERE p.status = 'ACTIVE' AND ${sellableSql('p')} AND p.id IN (${marks})`
  ).bind(...ids).all();
  const byId = new Map(results.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

async function coPurchase(env, productIds, exclude, limit) {
  const inMarks = productIds.map(() => '?').join(',');
  const exMarks = exclude.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT i2.product_id AS pid, COUNT(DISTINCT o.id) AS n
     FROM order_items i1
     JOIN sub_orders s1 ON s1.id = i1.sub_order_id
     JOIN orders o ON o.id = s1.parent_order_id
     JOIN sub_orders s2 ON s2.parent_order_id = o.id
     JOIN order_items i2 ON i2.sub_order_id = s2.id
     JOIN products p2 ON p2.id = i2.product_id AND p2.status = 'ACTIVE'
     WHERE i1.product_id IN (${inMarks}) AND i2.product_id NOT IN (${exMarks})
       AND o.payment_status IN ${PAID}
     GROUP BY i2.product_id ORDER BY n DESC, i2.product_id ASC LIMIT ?`
  ).bind(...productIds, ...exclude, limit).all();
  return results.map((r) => r.pid);
}

async function coView(env, productId, exclude, limit) {
  const exMarks = exclude.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT v2.product_id AS pid, COUNT(*) AS n
     FROM product_views v1
     JOIN product_views v2 ON v2.user_id = v1.user_id AND v2.day = v1.day AND v2.product_id != v1.product_id
     JOIN products p2 ON p2.id = v2.product_id AND p2.status = 'ACTIVE'
     WHERE v1.product_id = ? AND v2.product_id NOT IN (${exMarks})
     GROUP BY v2.product_id ORDER BY n DESC, v2.product_id ASC LIMIT ?`
  ).bind(productId, ...exclude, limit).all();
  return results.map((r) => r.pid);
}

async function popularFill(env, exclude, limit, categoryId = null) {
  const picked = [];
  const exMarks = () => exclude.concat(picked).map(() => '?').join(',');
  const params = () => exclude.concat(picked);
  if (categoryId) {
    const { results } = await env.DB.prepare(
      `SELECT id FROM products WHERE status = 'ACTIVE' AND ${sellableSql('products')} AND category_id = ? AND id NOT IN (${exMarks()})
       ORDER BY total_sold_count DESC, id ASC LIMIT ?`
    ).bind(categoryId, ...params(), limit).all();
    picked.push(...results.map((r) => r.id));
  }
  if (picked.length < limit) {
    const { results } = await env.DB.prepare(
      `SELECT id FROM products WHERE status = 'ACTIVE' AND ${sellableSql('products')} AND id NOT IN (${exMarks()})
       ORDER BY total_sold_count DESC, id ASC LIMIT ?`
    ).bind(...params(), limit - picked.length).all();
    picked.push(...results.map((r) => r.id));
  }
  return picked;
}

export async function handleRecommendRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;

  const viewM = p.match(/^\/api\/v1\/products\/([^/]+)\/view$/);
  if (viewM && request.method === 'POST') {
    const me = await requireCustomer(request, env);
    const prod = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(viewM[1]).first();
    if (!prod) throw notFound('상품을 찾을 수 없습니다.');
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(
      'INSERT OR IGNORE INTO product_views (id, product_id, user_id, day) VALUES (?, ?, ?, ?)'
    ).bind(newId('pvw'), prod.id, me.userId, day).run();
    return json(corsHeaders, { success: true });
  }

  if (p === '/api/v1/recommendations/related' && request.method === 'GET') {
    const productId = (url.searchParams.get('product_id') || '').trim();
    if (!productId) throw bad('PRODUCT_REQUIRED', 'product_id를 지정해 주세요.');
    const prod = await env.DB.prepare('SELECT id, category_id FROM products WHERE id = ?').bind(productId).first();
    if (!prod) throw notFound('상품을 찾을 수 없습니다.');
    const limit = pageLimit(url.searchParams.get('limit'));
    const bought = await coPurchase(env, [productId], [productId], limit);
    const seen = await coView(env, productId, [productId, ...bought], limit - bought.length);
    const fill = bought.length + seen.length < limit
      ? await popularFill(env, [productId, ...bought, ...seen], limit - bought.length - seen.length, prod.category_id)
      : [];
    const ids = [...bought, ...seen, ...fill];
    const data = await cardsByIds(env, ids);
    const signals = { co_purchase: bought.length, co_view: seen.length, popular_fill: fill.length };
    return json(corsHeaders, { success: true, count: data.length, data, signals });
  }

  if (p === '/api/v1/recommendations/for-you' && request.method === 'GET') {
    const limit = pageLimit(url.searchParams.get('limit'));
    const viewer = await authenticate(request, env).catch(() => null);
    if (!viewer || viewer.role !== 'ROLE_CUSTOMER') {
      const ids = await popularFill(env, ['\0'], limit);
      const data = await cardsByIds(env, ids);
      return json(corsHeaders, { success: true, count: data.length, data, personalized: false });
    }
    const { results: affinities } = await env.DB.prepare(
      `SELECT p.category_id AS cid, COUNT(*) AS n FROM (
         SELECT i.product_id AS pid FROM order_items i
         JOIN sub_orders s ON s.id = i.sub_order_id JOIN orders o ON o.id = s.parent_order_id
         WHERE o.customer_id = ? AND o.payment_status IN ${PAID}
         UNION ALL SELECT product_id AS pid FROM wishlists WHERE user_id = ?
         UNION ALL SELECT product_id AS pid FROM product_views WHERE user_id = ?
       ) JOIN products p ON p.id = pid
       GROUP BY p.category_id ORDER BY n DESC, p.category_id ASC LIMIT 3`
    ).bind(viewer.userId, viewer.userId, viewer.userId).all();
    const picked = [];
    for (const a of affinities) {
      if (picked.length >= limit) break;
      const part = await popularFill(env, picked.concat(['\0']), limit - picked.length, a.cid);
      picked.push(...part);
    }
    if (picked.length < limit) picked.push(...await popularFill(env, picked.concat(['\0']), limit - picked.length));
    const data = await cardsByIds(env, picked);
    return json(corsHeaders, { success: true, count: data.length, data, personalized: affinities.length > 0 });
  }

  if (p === '/api/v1/recommendations/cart-bundle' && request.method === 'GET') {
    const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length) throw bad('IDS_REQUIRED', 'ids를 1개 이상 지정해 주세요.');
    const cart = [...new Set(ids)].slice(0, 20);
    const limit = pageLimit(url.searchParams.get('limit'));
    const bought = await coPurchase(env, cart, cart, limit);
    const fill = bought.length < limit ? await popularFill(env, [...cart, ...bought], limit - bought.length) : [];
    const data = await cardsByIds(env, [...bought, ...fill]);
    return json(corsHeaders, { success: true, count: data.length, data });
  }

  return null;
}
