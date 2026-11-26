// apps/cloudflare-gateway/src/services/seo/page-render.js
// Edge rendering data for one storefront URL under the /{lang}/{currency}
// scheme (owner work order 2026-11-27). Returns the head, JSON-LD graphs and a
// plain summary built from live D1 rows; the apex worker injects them into
// index.html for EVERY visitor alike (no user-agent branching, decision 23), so
// crawlers and AI agents read the same facts people see without JavaScript.
//
// Results:
//   { status: 200|404|410, head, jsonld, summary_html }  page data
//   { status: 301, location }                            PDP slug repair (caller keeps the query)
//   { status: 'pass' }                                   nothing to add (shell served untouched)
// Unprefixed paths are the edge's job (Geo/cookie 302, legacy 301) and pass here.

import { isNoindex, isSearch, localeHead } from '../../lib/seo-head.js';
import { productMeta, categoryMeta, clean, clip } from '../../lib/seo-meta.js';
import { productGraph, qaPageGraph, breadcrumbGraph, itemListGraph, faqGraph } from '../../lib/seo-jsonld.js';
import { organizationGraph, SITE_NAME, SITE_TAGLINE } from '../../lib/site-entity.js';
import { sellableSql } from '../../lib/shipping-policy.js';
import { krwPerUnit } from '../../lib/fx.js';
import { loadTranslations, contentLangs, slugOf, titleOf } from '../../lib/translations.js';
import { buildPdpBrief, renderKeyFactsHtml } from './pdp-brief.js';
import {
  parseLocalePath, localizedPath, productBarePath, convertFromKrw, formatMoney,
  CURRENCY_CODE, SOURCE_LANG
} from '../../../../../packages/ui/src/locale.config.ts';

const LIVE = (a = 'p') => `${a}.status = 'ACTIVE' AND ${a}.review_status = 'APPROVED' AND ${sellableSql(a)}`;
/** Permanently ended products answer 410 Gone (temporarily hidden ones stay 404). */
export const GONE_STATUSES = ['DELETED', 'DISCONTINUED', 'ENDED'];
const LIST_CAP = 20;
const DESC_SUMMARY_CAP = 600;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Pages whose head is static text (no D1 row), keyed by bare path. Titles match each view's h1. */
export const STATIC_PAGES = {
  '/categories': { title: `전체 카테고리 | ${SITE_NAME}`, description: `${SITE_NAME}의 전체 상품 카테고리 목록입니다.` },
  '/channel/lightning-deals': { title: `번개특가 | ${SITE_NAME}`, description: `${SITE_NAME}에서 지금 진행 중인 번개특가 상품 목록입니다.` },
  '/channel/best-sellers': { title: `베스트 | ${SITE_NAME}`, description: `${SITE_NAME}의 판매량 기준 베스트 상품 목록입니다.` },
  '/legal/terms': { title: `이용약관 | ${SITE_NAME}`, description: `${SITE_NAME} 플랫폼 이용약관입니다.` },
  '/legal/privacy': { title: `개인정보처리방침 | ${SITE_NAME}`, description: `${SITE_NAME} 개인정보처리방침입니다.` },
  '/legal/refund': { title: `취소·반품·환불 안내 | ${SITE_NAME}`, description: `${SITE_NAME}의 주문 취소, 반품, 환불 절차 안내입니다.` },
  '/policy/shipping': { title: `배송 정책 | ${SITE_NAME}`, description: '배송비는 판매자(직영·입점)마다 다르며, 한 주문에 여러 판매자의 상품이 있으면 판매자별로 따로 계산됩니다.' }
};

const seg = (raw) => {
  try { return decodeURIComponent(raw); } catch { return null; }
};

function page(status, head, jsonld = [], summary = '') {
  return { status, head, jsonld: jsonld.filter(Boolean), summary_html: summary };
}

/**
 * KRW -> the URL's currency at the operator-published rate (the same rate and
 * rounding the storefront uses). Without a published rate the page shows KRW,
 * so the JSON-LD says KRW too — never a guessed conversion.
 */
export async function priceIn(env, currency, amountKrw) {
  const krw = Math.round(Number(amountKrw) || 0);
  if (currency === 'krw') return { amount: krw, currency: 'krw', code: 'KRW' };
  const r = await krwPerUnit(env, CURRENCY_CODE[currency]);
  const v = r.source === 'OPERATOR_TABLE' ? convertFromKrw(krw, currency, r.rate) : null;
  return v === null ? { amount: krw, currency: 'krw', code: 'KRW' } : { amount: v, currency, code: CURRENCY_CODE[currency] };
}

function ctxOf(base, loc, query) {
  const L = (bare) => localizedPath(loc.lang, loc.currency, bare);
  return { base, lang: loc.lang, currency: loc.currency, query, L };
}

function errorPage(c, bare, status, title) {
  // Body stays the SPA (its own error screen); crawlers get the status + noindex.
  const head = localeHead({ lang: c.lang, currency: c.currency, bare, base: c.base, title: `${title} | ${SITE_NAME}` });
  head.robots = 'noindex,nofollow';
  head.hreflangs = [];
  return page(status, head);
}
const notFound = (c, bare) => errorPage(c, bare, 404, '페이지를 찾을 수 없습니다');
const gone = (c, bare) => errorPage(c, bare, 410, '판매가 종료된 상품입니다');

/** Category chain root-first: [{ name, slug }]. Cycle-safe, depth-capped. */
async function categoryChain(env, categoryId) {
  const chain = [];
  const seen = new Set();
  let id = categoryId;
  while (id && !seen.has(id) && chain.length < 6) {
    seen.add(id);
    const cat = await env.DB.prepare('SELECT id, name, slug, parent_id FROM categories WHERE id = ?').bind(id).first();
    if (!cat) break;
    chain.unshift(cat);
    id = cat.parent_id;
  }
  return chain;
}

async function homePage(env, c) {
  const title = `${SITE_NAME} (올모아) - ${SITE_TAGLINE}`;
  const head = localeHead({ lang: c.lang, currency: c.currency, bare: '/', base: c.base, title, description: SITE_TAGLINE, query: c.query });
  const { results: cats } = await env.DB.prepare(
    'SELECT name, slug FROM categories WHERE is_active = 1 AND (parent_id IS NULL OR depth = 0) ORDER BY sort_order ASC, slug ASC LIMIT 30').all();
  const home = `${c.base}${c.L('/')}`;
  const website = {
    '@context': 'https://schema.org', '@type': 'WebSite', name: SITE_NAME, url: home,
    potentialAction: { '@type': 'SearchAction', target: `${c.base}${c.L('/search')}?q={query}`, 'query-input': 'required name=query' }
  };
  const links = (cats || []).map((x) => `<li><a href="${esc(c.L(`/c/${encodeURIComponent(x.slug)}`))}">${esc(x.name)}</a></li>`).join('');
  const summary = `<h1>${esc(SITE_NAME)}</h1><p>${esc(SITE_TAGLINE)}</p>${links ? `<nav aria-label="카테고리"><ul>${links}</ul></nav>` : ''}`;
  return page(200, head, [organizationGraph(c.base), website], summary);
}

async function productPage(env, c, id, givenSlug) {
  const p = await env.DB.prepare(
    `SELECT p.*, pt.business_name AS seller_name,
            (SELECT ROUND(AVG(r.rating), 1) FROM product_reviews r WHERE r.product_id = p.id) AS avg_rating,
            COALESCE((SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id), 0) AS review_count,
            COALESCE((SELECT SUM(stock_quantity) FROM product_skus s WHERE s.product_id = p.id), 0) AS stock_sum,
            CASE WHEN ${LIVE('p')} THEN 1 ELSE 0 END AS is_live
     FROM products p LEFT JOIN partners pt ON p.partner_id = pt.id
     WHERE p.id = ?`).bind(id).first();
  const bareAsked = productBarePath(id, givenSlug);
  if (!p) return notFound(c, bareAsked);
  if (GONE_STATUSES.includes(String(p.status || '').toUpperCase())) return gone(c, bareAsked);
  if (!Number(p.is_live)) return notFound(c, bareAsked);

  const tr = await loadTranslations(env, id);
  const langs = contentLangs(tr);
  const koSlug = slugOf(p, tr, SOURCE_LANG);
  const slugFor = (l) => slugOf(p, tr, l) || koSlug;
  const slug = slugFor(c.lang);
  // Missing, stale or mistyped slug -> 301 to this language's current slug.
  if (slug && givenSlug !== slug) {
    return { status: 301, location: c.L(productBarePath(id, slug)) };
  }

  const brief = await buildPdpBrief(env, id);
  if (!brief) return notFound(c, bareAsked);
  const policy = await env.DB.prepare("SELECT * FROM shipping_policies WHERE id = ? AND status = 'ACTIVE'").bind(p.shipping_policy_id).first();
  const { results: gtins } = await env.DB.prepare(
    'SELECT DISTINCT gtin FROM product_skus WHERE product_id = ? AND gtin IS NOT NULL').bind(id).all();
  const gtin = gtins && gtins.length === 1 ? gtins[0].gtin : null;

  const translated = c.lang !== SOURCE_LANG && tr[c.lang];
  const name = titleOf(p, tr, c.lang);
  const meta = productMeta({ ...p, title: name });
  const description = translated && translated.summary ? translated.summary : brief.description_text;
  const price = await priceIn(env, c.currency, p.lowest_sale_price);
  const bare = productBarePath(id, slug);
  const pagePath = c.L(bare);

  const chain = await categoryChain(env, p.category_id);
  const crumbs = [{ label: '홈', to: c.L('/') }, ...chain.map((x) => ({ label: x.name, to: c.L(`/c/${encodeURIComponent(x.slug)}`) })), { label: meta.h1 }];
  const head = localeHead({
    route: 'product', lang: c.lang, currency: c.currency, bare, bareFor: (l) => productBarePath(id, slugFor(l)),
    base: c.base, title: translated ? clip(`${name} | ${SITE_NAME}`, 70) : meta.title,
    description: translated ? clip(clean(description || name), 160) : meta.description,
    image: p.thumbnail_url || '', query: c.query, contentLangs: langs
  });
  const windowDays = parseInt(env.RETURN_WINDOW_DAYS || '7', 10) || 7;
  const graphs = productGraph(c.base, { ...p, title: name }, {
    crumbs,
    rating: p.avg_rating,
    reviewCount: Number(p.review_count) || 0,
    availability: Number(p.stock_sum) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    shipping: policy,
    gtin,
    description,
    windowDays,
    url: pagePath,
    offerPrice: price.amount,
    offerCurrency: price.code
  });
  const qa = qaPageGraph(c.base, id, brief.qna, pagePath);

  // The rendered price is the JSON-LD price (same amount, same currency).
  const facts = (brief.key_facts || []).map((f) => (f.label === '판매가' ? { ...f, value: formatMoney(price.amount, price.currency) } : f));
  const crumbHtml = crumbs.slice(0, -1).map((x) => `<a href="${esc(x.to)}">${esc(x.label)}</a>`).join(' &gt; ');
  const desc = clip(description || '', DESC_SUMMARY_CAP);
  const summary = [
    crumbHtml ? `<nav aria-label="경로">${crumbHtml}</nav>` : '',
    `<h1>${esc(name)}</h1>`,
    `<p data-price="${esc(price.amount)}" data-currency="${esc(price.code)}">${esc(formatMoney(price.amount, price.currency))}</p>`,
    renderKeyFactsHtml(facts),
    desc ? `<p>${esc(desc)}</p>` : ''
  ].join('');
  return page(200, head, [...graphs, qa], summary);
}

async function categoryPage(env, c, slug) {
  const bare = `/c/${encodeURIComponent(slug)}`;
  const cat = await env.DB.prepare('SELECT * FROM categories WHERE slug = ? AND is_active = 1').bind(slug).first();
  if (!cat) return notFound(c, bare);
  const chain = await categoryChain(env, cat.id);
  const parent = chain.length > 1 ? chain[chain.length - 2] : null;
  const { results: subs } = await env.DB.prepare(
    'SELECT name, slug FROM categories WHERE parent_id = ? AND is_active = 1 ORDER BY sort_order ASC, slug ASC').bind(cat.id).all();
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM products p
     WHERE (p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ?)) AND ${LIVE('p')}`)
    .bind(cat.id, cat.id).first('n');
  const { results: items } = await env.DB.prepare(
    `SELECT p.id, p.title, p.lowest_sale_price FROM products p
     WHERE (p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ?)) AND ${LIVE('p')}
     ORDER BY p.total_sold_count DESC, p.updated_at DESC LIMIT ${LIST_CAP}`).bind(cat.id, cat.id).all();

  const meta = categoryMeta(cat, Number(count) || 0, parent ? parent.name : '', (subs || []).map((s) => s.name), (subs || []).length);
  const head = localeHead({ route: 'category', lang: c.lang, currency: c.currency, bare, base: c.base, title: meta.title, description: meta.description, query: c.query });
  const crumbs = [{ label: '홈', to: c.L('/') }, ...chain.map((x) => ({ label: x.name, to: c.L(`/c/${encodeURIComponent(x.slug)}`) }))];
  const productHref = (it) => c.L(`/p/${encodeURIComponent(it.id)}`);
  const graphs = [breadcrumbGraph(c.base, crumbs)];
  if (items && items.length) graphs.push(itemListGraph(c.base, meta.h1, items, productHref));
  const prices = await Promise.all((items || []).map((it) => priceIn(env, c.currency, it.lowest_sale_price)));

  const subHtml = (subs || []).map((s) => `<li><a href="${esc(c.L(`/c/${encodeURIComponent(s.slug)}`))}">${esc(s.name)}</a></li>`).join('');
  const itemHtml = (items || []).map((it, i) => `<li><a href="${esc(productHref(it))}">${esc(clean(it.title))}</a> ${esc(formatMoney(prices[i].amount, prices[i].currency))}</li>`).join('');
  const summary = [
    `<h1>${esc(meta.h1)}</h1>`,
    `<p>${esc(meta.description)}</p>`,
    subHtml ? `<nav aria-label="하위 카테고리"><ul>${subHtml}</ul></nav>` : '',
    itemHtml ? `<ul>${itemHtml}</ul>` : ''
  ].join('');
  return page(200, head, graphs, summary);
}

async function storePage(env, c, partnerId) {
  const bare = `/store/${encodeURIComponent(partnerId)}`;
  const s = await env.DB.prepare("SELECT id, business_name FROM partners WHERE id = ? AND status = 'APPROVED'").bind(partnerId).first();
  if (!s) return notFound(c, bare);
  const name = clean(s.business_name) || '스토어';
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM products p WHERE p.partner_id = ? AND ${LIVE('p')}`).bind(partnerId).first('n');
  const { results: items } = await env.DB.prepare(
    `SELECT p.id, p.title, p.lowest_sale_price FROM products p WHERE p.partner_id = ? AND ${LIVE('p')}
     ORDER BY p.total_sold_count DESC, p.updated_at DESC LIMIT ${LIST_CAP}`).bind(partnerId).all();
  const n = Number(count) || 0;
  const description = n > 0 ? `${name} 판매자 스토어, 판매 중인 상품 ${n.toLocaleString('ko-KR')}개` : `${name} 판매자 스토어`;
  const head = localeHead({ route: 'store', lang: c.lang, currency: c.currency, bare, base: c.base, title: clip(`${name} | ${SITE_NAME}`, 60), description, query: c.query });
  const productHref = (it) => c.L(`/p/${encodeURIComponent(it.id)}`);
  const graphs = [breadcrumbGraph(c.base, [{ label: '홈', to: c.L('/') }, { label: name }])];
  if (items && items.length) graphs.push(itemListGraph(c.base, name, items, productHref));
  const prices = await Promise.all((items || []).map((it) => priceIn(env, c.currency, it.lowest_sale_price)));
  const itemHtml = (items || []).map((it, i) => `<li><a href="${esc(productHref(it))}">${esc(clean(it.title))}</a> ${esc(formatMoney(prices[i].amount, prices[i].currency))}</li>`).join('');
  return page(200, head, graphs, `<h1>${esc(name)}</h1><p>${esc(description)}</p>${itemHtml ? `<ul>${itemHtml}</ul>` : ''}`);
}

/** 6-13 FAQ: the published rows the support page lists, as FAQPage + plain Q&A. */
async function supportPage(env, c) {
  const { results } = await env.DB.prepare(
    'SELECT category, question, answer FROM faqs WHERE is_published = 1 ORDER BY category ASC, sort_order ASC, id ASC LIMIT 50').all();
  const items = (results || []).map((r) => ({ q: clean(r.question), a: clean(r.answer) })).filter((r) => r.q && r.a);
  const head = localeHead({ lang: c.lang, currency: c.currency, bare: '/support', base: c.base, title: `고객센터 | ${SITE_NAME}`, description: `${SITE_NAME} 고객센터 자주 묻는 질문과 1:1 문의 안내입니다.`, query: c.query });
  const qa = items.map((r) => `<dt>${esc(r.q)}</dt><dd>${esc(clip(r.a, 400))}</dd>`).join('');
  const summary = `<h1>고객센터</h1><h2>자주 묻는 질문</h2>${qa ? `<dl>${qa}</dl>` : ''}`;
  return page(200, head, [faqGraph(items)], summary);
}

/**
 * Edge page data for a storefront URL path (+ optional query string), or
 * `{ status: 'pass' }` when the path has nothing to add.
 */
export async function renderSeoPage(env, base, rawPath, rawQuery = '') {
  const b = String(base || 'https://olmoa.com').replace(/\/$/, '');
  const pathOnly = String(rawPath || '/').split('?')[0].split('#')[0] || '/';
  const loc = parseLocalePath(pathOnly);
  if (!loc) return { status: 'pass' };
  const query = Object.fromEntries(new URLSearchParams(String(rawQuery || String(rawPath || '').split('?')[1] || '')));
  const c = ctxOf(b, loc, query);
  const bare = loc.bare;
  if (bare === '/') return homePage(env, c);

  const prod = bare.match(/^\/p\/([^/]+)(?:\/([^/]+))?$/);
  if (prod) {
    const id = seg(prod[1]);
    const slug = prod[2] === undefined ? '' : seg(prod[2]);
    return id && slug !== null ? productPage(env, c, id, slug) : notFound(c, bare);
  }
  const cat = bare.match(/^\/c\/([^/]+)$/);
  if (cat) {
    const slug = seg(cat[1]);
    return slug ? categoryPage(env, c, slug) : notFound(c, bare);
  }
  const store = bare.match(/^\/store\/([^/]+)$/);
  if (store) {
    const id = seg(store[1]);
    return id ? storePage(env, c, id) : notFound(c, bare);
  }
  if (bare === '/support') return supportPage(env, c);
  const fixed = STATIC_PAGES[bare];
  if (fixed) return page(200, localeHead({ lang: c.lang, currency: c.currency, bare, base: b, title: fixed.title, description: fixed.description, query }));
  // Private and search paths: robots only, so a crawler never indexes them pre-JS.
  if (isNoindex(bare) || isSearch(bare)) {
    return page(200, localeHead({ lang: c.lang, currency: c.currency, bare, base: b, title: SITE_NAME, query }));
  }
  return { status: 'pass' };
}

