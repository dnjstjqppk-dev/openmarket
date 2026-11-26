// apps/cloudflare-gateway/src/services/seo/crawl-text.js
// robots.txt + llms.txt + llms-full.txt builders. Every listed path comes from
// live D1 rows; an empty catalog yields a minimal valid file, never placeholders.

import { STATIC_URLS } from './sitemap.js';
import { sellableSql } from '../../lib/shipping-policy.js';
import { returnPolicyNode } from '../../lib/seo-jsonld.js';
import { SITE_NAME, SITE_TAGLINE } from '../../lib/site-entity.js';
import { buildPdpBrief } from './pdp-brief.js';
import { shippingText } from '../../lib/shipping-policy.js';
import { localizedPath, productBarePath, slugify } from '../../../../../packages/ui/src/locale.config.ts';

// Bare private paths (they only redirect since 2026-11-27). Prefixed private
// pages (/{lang}/{currency}/cart ...) are NOT disallowed: robots `*` matches
// across '/', so '/*/*/cart' would also block product slugs like 'cart-holder';
// those pages carry noindex,nofollow from the edge head instead.
export const PRIVATE_DISALLOWS = ['/api/', '/cart', '/checkout', '/my', '/orders', '/login',
  '/register', '/addresses', '/wishlist', '/coupons', '/payments', '/admin'];

/** 6-6 robots policy table (decision-18: every group allows public paths; only
 *  PRIVATE_DISALLOWS is blocked). One entry per crawler family so a future
 *  policy change touches a single place. */
export const ROBOT_GROUPS = [
  { id: 'SEARCH', agents: ['Googlebot', 'Bingbot', 'Yeti', 'Daum'] },
  { id: 'AI_ANSWER', agents: ['ChatGPT-User', 'Claude-User', 'PerplexityBot'] },
  { id: 'AI_TRAIN', agents: ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot'] },
  { id: 'FALLBACK', agents: ['*'] }
];

export const CONTENT_SIGNAL = 'Content-Signal: search=yes, ai-input=yes, ai-train=yes';

export function robotsTxt(base) {
  const b = String(base).replace(/\/$/, '');
  const lines = [`# ${SITE_NAME} robots.txt — policy: SEARCH / AI_ANSWER / AI_TRAIN / FALLBACK (decision-18: all allow)`];
  for (const g of ROBOT_GROUPS) {
    lines.push(`# ${g.id}`);
    for (const a of g.agents) lines.push(`User-agent: ${a}`);
    for (const p of PRIVATE_DISALLOWS) lines.push(`Disallow: ${p}`);
    lines.push('Allow: /', '');
  }
  // /sitemap.xml is the sitemap index since 2026-11-27 (/sitemap-index.xml is an alias, not listed twice).
  lines.push(CONTENT_SIGNAL, `Sitemap: ${b}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}

async function liveCategories(env) {
  const { results } = await env.DB.prepare(
    'SELECT name, slug FROM categories WHERE is_active = 1 AND depth = 0 ORDER BY sort_order ASC').all();
  return results || [];
}

/** 6-5 size caps (bytes, UTF-8). Lists shrink to fit; items never truncate mid-row. */
export const LLMS_TXT_CAP = 16 * 1024;
export const LLMS_FULL_CAP = 256 * 1024;
export const LLMS_DOC_CAP = 64 * 1024;

async function activeOperator(env) {
  return env.DB.prepare("SELECT * FROM business_entities WHERE role = 'PLATFORM_OPERATOR' AND status = 'ACTIVE' LIMIT 1").first() || null;
}

function byteLen(s) {
  return new TextEncoder().encode(s).length;
}

/** 6-5 llms.txt: identity, operator, hubs, policies, product docs, contact, citation. */
export async function llmsTxt(env, base) {
  const b = String(base).replace(/\/$/, '');
  const cats = await liveCategories(env);
  const operator = await activeOperator(env);
  const { results: allPicks } = await env.DB.prepare(
    `SELECT id, title FROM products WHERE status = 'ACTIVE' AND review_status = 'APPROVED' AND ${sellableSql('products')}
     ORDER BY total_sold_count DESC, updated_at DESC LIMIT 20`).all();
  const picks = allPicks || [];
  const today = new Date().toISOString().slice(0, 10);
  const build = (n) => {
    const lines = [`# ${SITE_NAME}`, `> ${SITE_TAGLINE}`, ''];
    if (operator) {
      lines.push(`운영주체: ${operator.legal_name} (사업자등록번호 ${operator.business_reg_number}, 통신판매업신고 ${operator.mail_order_reg_number})`, '');
    }
    lines.push('## 카테고리', ...cats.map((c) => `- [${c.name}](${b}/ko/krw/c/${encodeURIComponent(c.slug)})`), '');
    lines.push('## 판매 정책',
      `- [배송 정책](${b}/ko/krw/policy/shipping)`,
      `- [반품·환불 규정](${b}/ko/krw/legal/refund)`,
      `- [스토어별 반품·교환 배송비](${b}/llms/return-policies)`,
      `- [개인정보처리방침](${b}/ko/krw/legal/privacy)`, '');
    const shown = picks.slice(0, n);
    lines.push(`## 상품 문서 (베스트 ${shown.length}종)`,
      ...shown.map((p) => `- [${p.title}](${b}/llms/product/${p.id}.md)`), '');
    if (operator && (operator.cs_phone || operator.cs_email)) {
      lines.push('## 연락처', `- 고객센터: ${[operator.cs_phone, operator.cs_email].filter(Boolean).join(' / ')}`, '');
    }
    lines.push('## 인용 안내',
      `- 정식 주소는 ${b} 도메인의 canonical URL을 따른다.`,
      `- 금액은 원(KRW), 기준일 ${today} 현재가이며 변동될 수 있다.`);
    return `${lines.join('\n')}\n`;
  };
  let out = build(picks.length);
  let n = picks.length;
  while (byteLen(out) > LLMS_TXT_CAP && n > 5) {
    n -= 5;
    out = build(n);
  }
  return out;
}

/** Live catalog counters for the full brief (zero rows stay zero). */
export async function catalogStats(env) {
  const cats = Number(await env.DB.prepare('SELECT COUNT(*) AS c FROM categories WHERE is_active = 1').first('c')) || 0;
  const prods = Number(await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM products WHERE status = 'ACTIVE' AND review_status = 'APPROVED' AND ${sellableSql('products')}`).first('c')) || 0;
  const stores = Number(await env.DB.prepare("SELECT COUNT(*) AS c FROM partners WHERE status = 'APPROVED'").first('c')) || 0;
  return { categories: cats, products: prods, stores };
}

/** 6-5 llms-full: policy full text + per-category summaries (top 5, cap stated). */
export async function llmsFullTxt(env, base) {
  const b = String(base).replace(/\/$/, '');
  const cats = await liveCategories(env);
  const stats = await catalogStats(env);
  const perCat = 5;
  const lines = [`# ${SITE_NAME} (전체 문서)`, `> ${SITE_TAGLINE}`,
    '', '## 현황', `- 카테고리: ${stats.categories}`, `- 상품: ${stats.products}`, `- 스토어: ${stats.stores}`, ''];
  lines.push('## 정책 전문');
  for (const kind of ['TERMS', 'PRIVACY', 'REFUND']) {
    const doc = await env.DB.prepare(
      `SELECT version, effective_date, body FROM legal_documents WHERE kind = ?
       ORDER BY effective_date DESC, created_at DESC LIMIT 1`).bind(kind).first();
    if (!doc) continue;
    const label = { TERMS: '이용약관', PRIVACY: '개인정보처리방침', REFUND: '반품·환불 규정' }[kind];
    lines.push('', `### ${label} (v${doc.version}, 시행 ${doc.effective_date})`, String(doc.body || '').trim());
  }
  lines.push('', `## 분류별 상품 요약 (분류당 상위 ${perCat}종, 누적 판매순)`);
  const head = `${lines.join('\n')}\n`;
  const sections = [];
  for (const c of cats) {
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.title, p.lowest_sale_price, p.total_sold_count FROM products p
       JOIN categories c ON c.id = p.category_id
       WHERE p.status = 'ACTIVE' AND p.review_status = 'APPROVED' AND ${sellableSql('p')}
         AND (c.id = (SELECT id FROM categories WHERE slug = ?) OR c.parent_id = (SELECT id FROM categories WHERE slug = ?))
       ORDER BY p.total_sold_count DESC, p.updated_at DESC LIMIT ?`).bind(c.slug, c.slug, perCat).all();
    sections.push(['', `### [${c.name}](${b}/ko/krw/c/${encodeURIComponent(c.slug)})`, ...(results || []).map((p) =>
      `- [${p.title}](${b}/llms/product/${p.id}.md) — ${Number(p.lowest_sale_price).toLocaleString('ko-KR')}원, 누적 ${Number(p.total_sold_count).toLocaleString('ko-KR')}개`)].join('\n'));
  }
  let out = head;
  for (const s of sections) {
    if (byteLen(out) + byteLen(s) + 1 > LLMS_FULL_CAP) break;
    out += `${s}\n`;
  }
  return out;
}

/**
 * 6-3 coupon feed: live claimable offers (same live() rule as the wallet,
 * anonymous view, AUTO excluded, cap 100). Public-safe fields only.
 */
export async function couponFeed(env) {
  const { results } = await env.DB.prepare(
    `SELECT c.code, c.title, c.discount_type, c.discount_value, c.min_order_amount,
            c.max_discount_amount, c.expires_at, c.scope, pt.business_name AS seller_name
     FROM coupons c LEFT JOIN partners pt ON pt.id = c.seller_id
     WHERE c.is_active = 1 AND c.expires_at > CURRENT_TIMESTAMP
       AND (c.starts_at IS NULL OR c.starts_at <= CURRENT_TIMESTAMP)
       AND c.issue_method != 'AUTO'
       AND (c.total_quantity IS NULL OR c.issued_count < c.total_quantity)
     ORDER BY c.expires_at ASC LIMIT 100`).all();
  return { updated_at: new Date().toISOString(), coupons: results || [] };
}

/**
 * 6-5 product document: title, canonical, fact table, description, freshness.
 * Null unless the product is live (ACTIVE + APPROVED + sellable).
 */
export async function productMarkdown(env, base, productId) {
  const b = String(base).replace(/\/$/, '');
  const brief = await buildPdpBrief(env, productId);
  if (!brief) return null;
  const p = await env.DB.prepare(
    `SELECT p.status, p.review_status, p.updated_at, p.lowest_sale_price, p.total_sold_count,
            p.brand, p.country_origin,
            COALESCE((SELECT SUM(stock_quantity) FROM product_skus s WHERE s.product_id = p.id), 0) AS stock_sum,
            pt.business_name AS seller_name
     FROM products p LEFT JOIN partners pt ON p.partner_id = pt.id WHERE p.id = ?`).bind(productId).first();
  if (!p || p.status !== 'ACTIVE' || p.review_status !== 'APPROVED') return null;
  const pol = await env.DB.prepare('SELECT * FROM shipping_policies WHERE id = (SELECT shipping_policy_id FROM products WHERE id = ?)').bind(productId).first();
  const windowDays = parseInt(env.RETURN_WINDOW_DAYS || '7', 10) || 7;
  const fee = Number(pol?.return_fee ?? 0);
  const lines = [
    `# ${brief.title}`,
    `> ${SITE_TAGLINE}`,
    '',
    `- 정식 주소: ${b}${localizedPath('ko', 'krw', productBarePath(brief.product_id, slugify(brief.title)))}`,
    `- 판매가: ${Number(p.lowest_sale_price).toLocaleString('ko-KR')}원`,
    `- 재고: ${Number(p.stock_sum) > 0 ? '구매 가능' : '일시 품절'}`,
    `- 배송: ${pol ? shippingText(pol) : '판매자 문의'}`,
    `- 반품: 수령 후 ${windowDays}일 이내 신청 가능 · 반품 배송비 ${fee > 0 ? `${fee.toLocaleString('ko-KR')}원` : '무료'}`,
    `- 원산지: ${String(p.country_origin || '').trim() || '미표기'}`,
    `- 브랜드: ${String(p.brand || '').trim() || '미표기'}`,
    `- 판매자: ${p.seller_name || SITE_NAME}`,
    '',
    '## 상품 설명',
    brief.description_text || '(등록된 설명이 없습니다)',
    '',
    `- 갱신: ${String(p.updated_at || '').slice(0, 10)}`
  ];
  if (brief.specs && brief.specs.length) {
    lines.push('', '## 스펙', ...brief.specs.map((s) => `- ${s.name}: ${s.value}`));
  }
  let out = `${lines.join('\n')}\n`;
  if (byteLen(out) > LLMS_DOC_CAP) {
    out = `${lines.slice(0, lines.indexOf('## 상품 설명') + 2).join('\n')}\n`;
  }
  return out;
}

/**
 * 6-5 category document: hubs, counts, top picks. Null for missing/inactive.
 */
export async function categoryMarkdown(env, base, slug) {
  const b = String(base).replace(/\/$/, '');
  const cat = await env.DB.prepare('SELECT * FROM categories WHERE slug = ? AND is_active = 1').bind(slug).first();
  if (!cat) return null;
  const { results: subs } = await env.DB.prepare(
    `SELECT c.name, c.slug,
            (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status = 'ACTIVE' AND p.review_status = 'APPROVED' AND ${sellableSql('p')}) AS n
     FROM categories c WHERE c.parent_id = ? AND c.is_active = 1 ORDER BY c.sort_order ASC`).bind(cat.id).all();
  const { results: picks } = await env.DB.prepare(
    `SELECT p.id, p.title, p.lowest_sale_price, p.updated_at FROM products p
     WHERE p.category_id = ? AND p.status = 'ACTIVE' AND p.review_status = 'APPROVED' AND ${sellableSql('p')}
     ORDER BY p.total_sold_count DESC, p.updated_at DESC LIMIT 8`).bind(cat.id).all();
  const fresh = (picks || []).map((p) => String(p.updated_at || '').slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop();
  const lines = [
    `# ${cat.name}`,
    `> ${SITE_TAGLINE}`,
    '',
    `- 정식 주소: ${b}/ko/krw/c/${encodeURIComponent(cat.slug)}`,
    ...(subs && subs.length ? ['', '## 하위 분류', ...subs.map((s) => `- [${s.name}](${b}/ko/krw/c/${encodeURIComponent(s.slug)}) (${Number(s.n).toLocaleString('ko-KR')}개)`)] : []),
    '',
    `## 인기 상품 (상위 ${(picks || []).length}종)`,
    ...((picks || []).map((p) => `- [${p.title}](${b}/llms/product/${p.id}.md) — ${Number(p.lowest_sale_price).toLocaleString('ko-KR')}원`)),
    ...(fresh ? ['', `- 갱신: ${fresh}`] : [])
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * 6-3 return-policy feed: one MerchantReturnPolicy per approved store with a
 * default policy, from 6-11 rows (return/exchange fees) + the effective window.
 */
export async function returnPolicyFeed(env, base) {
  const b = String(base).replace(/\/$/, '');
  const windowDays = parseInt(env.RETURN_WINDOW_DAYS || '7', 10) || 7;
  const { results } = await env.DB.prepare(
    `SELECT pt.id AS partner_id, pt.business_name AS seller_name,
            sp.id AS policy_id, sp.return_fee, sp.exchange_fee, sp.updated_at
     FROM partners pt
     JOIN shipping_policies sp ON sp.partner_id = pt.id AND sp.is_default = 1 AND sp.status = 'ACTIVE'
     WHERE pt.status = 'APPROVED'
     ORDER BY pt.id ASC LIMIT 500`).all();
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'OLMOA store return policies',
    itemListElement: (results || []).map((r, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: r.seller_name,
      url: `${b}/ko/krw/store/${encodeURIComponent(r.partner_id)}`,
      item: returnPolicyNode({ return_fee: r.return_fee, exchange_fee: r.exchange_fee }, windowDays)
    }))
  };
}
