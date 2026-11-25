// apps/cloudflare-gateway/src/services/seo/pdp-brief.js
// 6-1: one PDP brief builder for humans and machines. The storefront detail
// section and /api/crawl/product/:id render from the same result, so the
// crawl text and the display text cannot drift apart.
//
// Composition: Title -> Key Facts -> Description -> Specifications -> Q&A.
// Every number in the output traces to a source row or a named formula
// (see tests/seo_brief_6_1_test.mjs red-line mapping); nothing is invented.

import { shippingText } from '../../lib/shipping-policy.js';
import { sanitizeHtml } from '../crawler/html-sanitizer.js';

const QNA_LIMIT = 3;
const DESC_CAP = 2000;
const QA_CAP = 300;

function commas(n) {
  return String(Math.abs(Math.trunc(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Seller HTML to plain text (sanitized first, then tags stripped). */
export function htmlToText(html, cap = DESC_CAP) {
  const clean = sanitizeHtml(String(html || ''))
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= cap) return clean;
  return `${clean.slice(0, cap).trimEnd()}…`;
}

function discountPct(orig, sale) {
  if (!orig || orig <= sale) return null;
  return Math.round(((orig - sale) / orig) * 100);
}

/**
 * Structured brief for a sellable product, or null without a usable policy.
 * Callers decide exposure (detail serves it; the crawl endpoint 404s drafts).
 */
export async function buildPdpBrief(env, productId) {
  const p = await env.DB.prepare(
    `SELECT p.*, c.name AS category_name,
            pt.business_name AS seller_name,
            (SELECT ROUND(AVG(r.rating), 1) FROM product_reviews r WHERE r.product_id = p.id) AS avg_rating,
            COALESCE((SELECT COUNT(*) FROM product_reviews r WHERE r.product_id = p.id), 0) AS review_count,
            COALESCE((SELECT SUM(stock_quantity) FROM product_skus s WHERE s.product_id = p.id), 0) AS stock_sum
     FROM products p
     LEFT JOIN categories c ON p.category_id = c.id
     LEFT JOIN partners pt ON p.partner_id = pt.id
     WHERE p.id = ?`
  ).bind(productId).first();
  if (!p || !p.shipping_policy_id) return null;
  const policy = await env.DB.prepare("SELECT * FROM shipping_policies WHERE id = ? AND status = 'ACTIVE'")
    .bind(p.shipping_policy_id).first();
  if (!policy) return null;

  const facts = [];
  facts.push({ label: '판매가', value: `${commas(p.lowest_sale_price)}원` });
  const pct = discountPct(Number(p.lowest_original_price), Number(p.lowest_sale_price));
  if (pct !== null) facts.push({ label: '할인율', value: `${pct}%` });
  if (p.brand) facts.push({ label: '브랜드', value: String(p.brand) });
  if (p.manufacturer) facts.push({ label: '제조사', value: String(p.manufacturer) });
  if (p.model_name) facts.push({ label: '모델명', value: String(p.model_name) });
  if (Number(p.review_count) > 0 && p.avg_rating !== null) {
    facts.push({ label: '평점', value: `${p.avg_rating}점 (리뷰 ${commas(p.review_count)}개)` });
  } else {
    facts.push({ label: '리뷰', value: '아직 없음' });
  }
  facts.push({ label: '누적 판매', value: `${commas(p.total_sold_count)}개` });
  facts.push({ label: '배송', value: shippingText(policy) });
  if (p.seller_name) facts.push({ label: '판매자', value: String(p.seller_name) });
  facts.push({ label: '재고', value: Number(p.stock_sum) > 0 ? '구매 가능' : '일시 품절' });

  const description = htmlToText(p.description_html);

  const specs = [];
  let values = null;
  if (p.notice_info_json) {
    try { values = JSON.parse(p.notice_info_json); } catch { values = null; }
  }
  if (values && typeof values === 'object') {
    const tplId = p.notice_template_id || null;
    let order = null;
    if (tplId) {
      const tpl = await env.DB.prepare('SELECT items_json FROM notice_templates WHERE id = ?').bind(tplId).first();
      if (tpl && tpl.items_json) {
        try {
          order = JSON.parse(tpl.items_json).map((it) => ({ key: it.key, label: it.label || it.key }));
        } catch { order = null; }
      }
    }
    const rows = order && order.length
      ? order.filter((o) => values[o.key] !== undefined && values[o.key] !== null && String(values[o.key]).trim() !== '')
        .map((o) => ({ name: o.label, value: String(values[o.key]) }))
      : Object.entries(values)
        .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
        .map(([k, v]) => ({ name: k, value: String(v) }));
    specs.push(...rows);
  }

  const { results: qnaRows } = await env.DB.prepare(
    `SELECT question, answer FROM product_qna
     WHERE product_id = ? AND status = 'ANSWERED' AND is_secret = 0 AND answer IS NOT NULL AND TRIM(answer) != ''
     ORDER BY answered_at DESC, created_at DESC LIMIT ?`
  ).bind(productId, QNA_LIMIT).all();
  const qna = (qnaRows || []).map((r) => ({
    q: htmlToText(r.question, QA_CAP),
    a: htmlToText(r.answer, QA_CAP)
  })).filter((r) => r.q && r.a);

  return {
    product_id: p.id,
    title: String(p.title || ''),
    category_name: p.category_name || null,
    facts,
    description_text: description,
    specs,
    qna,
    // 6-4: answer-table rows from the same fetched rows (no second query round).
    key_facts: buildKeyFacts(env, { ...p, seller_name: p.seller_name }, policy, p.stock_sum)
  };
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 6-4 key-facts rows for the PDP answer table. Same sources as the brief and
 * the 6-3 graphs; rows without a value are omitted by the caller contract
 * (each row here always has one — see the empties handling below).
 */
export function buildKeyFacts(env, product, policy, stockSum) {
  const windowDays = parseInt(env.RETURN_WINDOW_DAYS || '7', 10) || 7;
  const rows = [];
  const sale = Number(product.lowest_sale_price) || 0;
  const orig = Number(product.lowest_original_price) || 0;
  rows.push({
    label: '판매가',
    value: orig > sale ? `${commas(sale)}원 (할인 전 ${commas(orig)}원)` : `${commas(sale)}원`
  });
  rows.push({ label: '재고 상태', value: Number(stockSum) > 0 ? '구매 가능' : '일시 품절' });
  if (policy) {
    let ship = shippingText(policy);
    const days = Number(policy.processing_days);
    if (Number.isSafeInteger(days) && days > 0) ship += ` · 주문 후 ${days}일 이내 출고`;
    rows.push({ label: '배송비·출고 기간', value: ship });
    const fee = Number(policy.return_fee ?? 0);
    rows.push({
      label: '반품 기간·반품 배송비',
      value: `수령 후 ${windowDays}일 이내 신청 가능 · 반품 배송비 ${fee > 0 ? `${commas(fee)}원` : '무료'}`
    });
  }
  if (product.country_origin && String(product.country_origin).trim()) {
    rows.push({ label: '원산지', value: String(product.country_origin).trim() });
  }
  if (product.brand && String(product.brand).trim()) {
    rows.push({ label: '브랜드', value: String(product.brand).trim() });
  }
  if (product.seller_name && String(product.seller_name).trim()) {
    rows.push({ label: '판매자', value: String(product.seller_name).trim() });
  }
  const updated = String(product.updated_at || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(updated)) {
    rows.push({ label: '정보 갱신일', value: updated });
  }
  return rows;
}

/**
 * 6-4 answer-table markup. The SPA injects the detail API's rendering of
 * this function verbatim, and the 6-10 Edge summary_html will reuse it —
 * one markup, every surface. Values are escaped; rows are never empty.
 */
export function renderKeyFactsHtml(rows) {
  const items = (rows || []).filter((r) => r && r.label && r.value !== undefined && r.value !== null && String(r.value).trim() !== '');
  if (!items.length) return '';
  const body = items.map((r) => `  <div><dt>${esc(r.label)}</dt><dd>${esc(r.value)}</dd></div>`).join('\n');
  return `<dl>\n${body}\n</dl>`;
}

/** Canonical plain-text rendering (crawl body and display source). */
export function renderPdpText(brief) {
  if (!brief) return '';
  const lines = [brief.title, '', '핵심 정보'];
  for (const f of brief.facts || []) lines.push(`- ${f.label}: ${f.value}`);
  if (brief.description_text) {
    lines.push('', '상품 설명', brief.description_text);
  }
  if ((brief.specs || []).length) {
    lines.push('', '스펙');
    for (const s of brief.specs) lines.push(`- ${s.name}: ${s.value}`);
  }
  if ((brief.qna || []).length) {
    lines.push('', 'Q&A');
    for (const item of brief.qna) {
      lines.push(`Q. ${item.q}`, `A. ${item.a}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
