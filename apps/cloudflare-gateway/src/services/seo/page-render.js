// apps/cloudflare-gateway/src/services/seo/page-render.js
// 6-2: edge rendering data. For one storefront path, returns the head, JSON-LD
// graphs and a plain summary block built from live D1 rows by the existing
// builders (seo-meta, seo-jsonld, pdp-brief). The apex worker injects the
// result into index.html for EVERY visitor alike (no user-agent branching), so
// search engines and AI crawlers read the same facts people see without JS.
//
// Status: missing or not-live entities answer 404 (the SPA body still loads and
// shows its own not-found screen). Unknown paths answer `pass` — the worker
// then serves index.html untouched.

import { routeHead, isNoindex, isSearch } from '../../lib/seo-head.js';
import { productMeta, categoryMeta, clean, clip } from '../../lib/seo-meta.js';
import { productGraph, qaPageGraph, breadcrumbGraph, itemListGraph, faqGraph } from '../../lib/seo-jsonld.js';
import { organizationGraph, SITE_NAME, SITE_TAGLINE } from '../../lib/site-entity.js';
import { sellableSql } from '../../lib/shipping-policy.js';
import { buildPdpBrief, renderKeyFactsHtml } from './pdp-brief.js';

const LIVE = (a = 'p') => `${a}.status = 'ACTIVE' AND ${a}.review_status = 'APPROVED' AND ${sellableSql(a)}`;
const LIST_CAP = 20;
const DESC_SUMMARY_CAP = 600;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const won = (n) => `${Math.trunc(Number(n) || 0).toLocaleString('ko-KR')}원`;

/** Pages whose head is static text (no D1 row). Titles match each view's h1. */
export const STATIC_PAGES = {
  '/categories': { title: `전체 카테고리 | ${SITE_NAME}`, description: `${SITE_NAME}의 전체 상품 카테고리 목록입니다.` },
  '/channel/lightning-deals': { title: `번개특가 | ${SITE_NAME}`, description: `${SITE_NAME}에서 지금 진행 중인 번개특가 상품 목록입니다.` },
  '/channel/best-sellers': { title: `베스트 | ${SITE_NAME}`, description: `${SITE_NAME}의 판매량 기준 베스트 상품 목록입니다.` },
  '/legal/terms': { title: `이용약관 | ${SITE_NAME}`, description: `${SITE_NAME} 플랫폼 이용약관입니다.` },
  '/legal/privacy': { title: `개인정보처리방침 | ${SITE_NAME}`, description: `${SITE_NAME} 개인정보처리방침입니다.` },
  '/legal/refund': { title: `취소·반품·환불 안내 | ${SITE_NAME}`, description: `${SITE_NAME}의 주문 취소, 반품, 환불 절차 안내입니다.` },
  '/policy/shipping': { title: `배송 정책 | ${SITE_NAME}`, description: '배송비는 판매자(직영·입점)마다 다르며, 한 주문에 여러 판매자의 상품이 있으면 판매자별로 따로 계산됩니다.' }
};

/** Strip the untranslated /en and /ja mirror prefix (they canonicalize to ko). */
export function barePath(path) {
  let p = String(path || '/').split('?')[0].split('#')[0] || '/';
  if (!p.startsWith('/')) p = `/${p}`;
  const m = p.match(/^\/(en|ja)(\/|$)/);
  if (m) p = p.slice(m[0].length - (m[2] ? 1 : 0)) || '/';
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

const seg = (raw) => {
  try { return decodeURIComponent(raw); } catch { return null; }
};

function page(status, head, jsonld = [], summary = '') {
  return { status, head, jsonld: jsonld.filter(Boolean), summary_html: summary };
}

function notFound(base, path) {
  // Body stays the SPA (its own 404 screen); crawlers get the status + noindex.
  const head = routeHead({ path, base, title: `페이지를 찾을 수 없습니다 | ${SITE_NAME}` });
  head.robots = 'noindex,nofollow';
  return page(404, head);
}

/** Category chain root-first: [{ name, slug }]. Cycle-safe, depth-capped. */
async function categoryChain(env, categoryId) {
  const chain = [];
  const seen = new Set();
  let id = categoryId;
  while (id && !seen.has(id) && chain.length < 6) {
    seen.add(id);
    const c = await env.DB.prepare('SELECT id, name, slug, parent_id FROM categories WHERE id = ?').bind(id).first();
    if (!c) break;
    chain.unshift(c);
    id = c.parent_id;
  }
  return chain;
}

async function homePage(env, base) {
  const title = `${SITE_NAME} (올모아) - ${SITE_TAGLINE}`;
  const head = routeHead({ path: '/', base, title, description: SITE_TAGLINE });
  const { results: cats } = await env.DB.prepare(
    'SELECT name, slug FROM categories WHERE is_active = 1 AND (parent_id IS NULL OR depth = 0) ORDER BY sort_order ASC, slug ASC LIMIT 30').all();
  const website = {
    '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: `${base}/`,
    potentialAction: { '@type': 'SearchAction', target: `${base}/search?q={query}`, 'query-input': 'required name=query' }
  };
  const links = (cats || []).map((c) => `<li><a href="/category/${encodeURIComponent(c.slug)}">${esc(c.name)}</a></li>`).join('');
  const summary = `<h1>${esc(SITE_NAME)}</h1><p>${esc(SITE_TAGLINE)}</p>${links ? `<nav aria-label="카테고리"><ul>${links}</ul></nav>` : ''}`;
  return page(200, head, [organizationGraph(base), website], summary);
}

async function productPage(env, base, path, id) {
  const p = await env.DB.prepare(
    `SELECT p.*, pt.business_name AS seller_name,
            (SELECT ROUND(AVG(r.rating), 1) FROM product_reviews r WHERE r.product_id = p.id) AS avg_rating,
            COALESCE((SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id), 0) AS review_count,
            COALESCE((SELECT SUM(stock_quantity) FROM product_skus s WHERE s.product_id = p.id), 0) AS stock_sum
     FROM products p LEFT JOIN partners pt ON p.partner_id = pt.id
     WHERE p.id = ? AND ${LIVE('p')}`).bind(id).first();
  if (!p) return notFound(base, path);
  const brief = await buildPdpBrief(env, id);
  if (!brief) return notFound(base, path);
  const policy = await env.DB.prepare("SELECT * FROM shipping_policies WHERE id = ? AND status = 'ACTIVE'").bind(p.shipping_policy_id).first();
  const { results: gtins } = await env.DB.prepare(
    'SELECT DISTINCT gtin FROM product_skus WHERE product_id = ? AND gtin IS NOT NULL').bind(id).all();
  const gtin = gtins && gtins.length === 1 ? gtins[0].gtin : null;

  const meta = productMeta(p);
  const chain = await categoryChain(env, p.category_id);
  const crumbs = [{ label: '홈', to: '/' }, ...chain.map((c) => ({ label: c.name, to: `/category/${encodeURIComponent(c.slug)}` })), { label: meta.h1 }];
  const head = routeHead({ route: 'product', path: `/product/${id}`, base, title: meta.title, description: meta.description, image: p.thumbnail_url || '' });
  const windowDays = parseInt(env.RETURN_WINDOW_DAYS || '7', 10) || 7;
  const graphs = productGraph(base, p, {
    crumbs,
    rating: p.avg_rating,
    reviewCount: Number(p.review_count) || 0,
    availability: Number(p.stock_sum) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    shipping: policy,
    gtin,
    description: brief.description_text,
    windowDays
  });
  const qa = qaPageGraph(base, id, brief.qna);

  const crumbHtml = crumbs.slice(0, -1).map((c) => `<a href="${esc(c.to)}">${esc(c.label)}</a>`).join(' &gt; ');
  const desc = clip(brief.description_text || '', DESC_SUMMARY_CAP);
  const summary = [
    crumbHtml ? `<nav aria-label="경로">${crumbHtml}</nav>` : '',
    `<h1>${esc(meta.h1)}</h1>`,
    renderKeyFactsHtml(brief.key_facts),
    desc ? `<p>${esc(desc)}</p>` : ''
  ].join('');
  return page(200, head, [...graphs, qa], summary);
}

async function categoryPage(env, base, path, slug) {
  const cat = await env.DB.prepare('SELECT * FROM categories WHERE slug = ? AND is_active = 1').bind(slug).first();
  if (!cat) return notFound(base, path);
  const chain = await categoryChain(env, cat.id);
  const parent = chain.length > 1 ? chain[chain.length - 2] : null;
  const { results: subs } = await env.DB.prepare(
    'SELECT name, slug FROM categories WHERE parent_id = ? AND is_active = 1 ORDER BY sort_order ASC, slug ASC').bind(cat.id).all();
  // Live count over the category and its direct children (the PLP lists both).
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM products p
     WHERE (p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ?)) AND ${LIVE('p')}`)
    .bind(cat.id, cat.id).first('n');
  const { results: items } = await env.DB.prepare(
    `SELECT p.id, p.title, p.lowest_sale_price FROM products p
     WHERE (p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ?)) AND ${LIVE('p')}
     ORDER BY p.total_sold_count DESC, p.updated_at DESC LIMIT ${LIST_CAP}`).bind(cat.id, cat.id).all();

  const meta = categoryMeta(cat, Number(count) || 0, parent ? parent.name : '', (subs || []).map((s) => s.name), (subs || []).length);
  const head = routeHead({ route: 'category', path: `/category/${slug}`, base, title: meta.title, description: meta.description });
  const crumbs = [{ label: '홈', to: '/' }, ...chain.map((c) => ({ label: c.name, to: `/category/${encodeURIComponent(c.slug)}` }))];
  const graphs = [breadcrumbGraph(base, crumbs)];
  if (items && items.length) graphs.push(itemListGraph(base, meta.h1, items));

  const subHtml = (subs || []).map((s) => `<li><a href="/category/${encodeURIComponent(s.slug)}">${esc(s.name)}</a></li>`).join('');
  const itemHtml = (items || []).map((it) => `<li><a href="/product/${encodeURIComponent(it.id)}">${esc(clean(it.title))}</a> ${esc(won(it.lowest_sale_price))}</li>`).join('');
  const summary = [
    `<h1>${esc(meta.h1)}</h1>`,
    `<p>${esc(meta.description)}</p>`,
    subHtml ? `<nav aria-label="하위 카테고리"><ul>${subHtml}</ul></nav>` : '',
    itemHtml ? `<ul>${itemHtml}</ul>` : ''
  ].join('');
  return page(200, head, graphs, summary);
}

async function storePage(env, base, path, partnerId) {
  const s = await env.DB.prepare("SELECT id, business_name FROM partners WHERE id = ? AND status = 'APPROVED'").bind(partnerId).first();
  if (!s) return notFound(base, path);
  const name = clean(s.business_name) || '스토어';
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM products p WHERE p.partner_id = ? AND ${LIVE('p')}`).bind(partnerId).first('n');
  const { results: items } = await env.DB.prepare(
    `SELECT p.id, p.title, p.lowest_sale_price FROM products p WHERE p.partner_id = ? AND ${LIVE('p')}
     ORDER BY p.total_sold_count DESC, p.updated_at DESC LIMIT ${LIST_CAP}`).bind(partnerId).all();
  const n = Number(count) || 0;
  // Same title the store view sets (`${name} | OLMOA`); description is facts only.
  const description = n > 0 ? `${name} 판매자 스토어, 판매 중인 상품 ${n.toLocaleString('ko-KR')}개` : `${name} 판매자 스토어`;
  const head = routeHead({ route: 'store', path: `/store/${partnerId}`, base, title: clip(`${name} | ${SITE_NAME}`, 60), description });
  const graphs = [breadcrumbGraph(base, [{ label: '홈', to: '/' }, { label: name }])];
  if (items && items.length) graphs.push(itemListGraph(base, name, items));
  const itemHtml = (items || []).map((it) => `<li><a href="/product/${encodeURIComponent(it.id)}">${esc(clean(it.title))}</a> ${esc(won(it.lowest_sale_price))}</li>`).join('');
  return page(200, head, graphs, `<h1>${esc(name)}</h1><p>${esc(description)}</p>${itemHtml ? `<ul>${itemHtml}</ul>` : ''}`);
}

/** 6-13 FAQ: the published rows the support page lists, as FAQPage + plain Q&A. */
async function supportPage(env, base) {
  const { results } = await env.DB.prepare(
    'SELECT category, question, answer FROM faqs WHERE is_published = 1 ORDER BY category ASC, sort_order ASC, id ASC LIMIT 50').all();
  const items = (results || []).map((r) => ({ q: clean(r.question), a: clean(r.answer) })).filter((r) => r.q && r.a);
  const head = routeHead({ path: '/support', base, title: `고객센터 | ${SITE_NAME}`, description: `${SITE_NAME} 고객센터 자주 묻는 질문과 1:1 문의 안내입니다.` });
  const qa = items.map((r) => `<dt>${esc(r.q)}</dt><dd>${esc(clip(r.a, 400))}</dd>`).join('');
  const summary = `<h1>고객센터</h1><h2>자주 묻는 질문</h2>${qa ? `<dl>${qa}</dl>` : ''}`;
  return page(200, head, [faqGraph(items)], summary);
}

/**
 * Edge page data for a storefront path, or `{ status: 'pass' }` when the path
 * has nothing to add (the worker then serves index.html as-is).
 */
export async function renderSeoPage(env, base, rawPath) {
  const b = String(base || 'https://olmoa.com').replace(/\/$/, '');
  const path = barePath(rawPath);
  if (path === '/') return homePage(env, b);

  const prod = path.match(/^\/product\/([^/]+)$/);
  if (prod) {
    const id = seg(prod[1]);
    return id ? productPage(env, b, path, id) : notFound(b, path);
  }
  const cat = path.match(/^\/category\/([^/]+)$/);
  if (cat) {
    const slug = seg(cat[1]);
    return slug ? categoryPage(env, b, path, slug) : notFound(b, path);
  }
  const store = path.match(/^\/store\/([^/]+)$/);
  if (store) {
    const id = seg(store[1]);
    return id ? storePage(env, b, path, id) : notFound(b, path);
  }
  if (path === '/support') return supportPage(env, b);
  const fixed = STATIC_PAGES[path];
  if (fixed) return page(200, routeHead({ path, base: b, title: fixed.title, description: fixed.description }));
  // Private and search paths: robots only, so a crawler never indexes them pre-JS.
  if (isNoindex(path) || isSearch(path)) {
    return page(200, routeHead({ path, base: b, title: SITE_NAME }));
  }
  return { status: 'pass' };
}
