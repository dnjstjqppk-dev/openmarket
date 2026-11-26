// apps/cloudflare-gateway/src/routes/translations.js
// Product translations (owner work order 2026-11-27, decision 22).
//   GET    /api/v1/partner/products/:id/translations          seller: own product's rows
//   PUT    /api/v1/partner/products/:id/translations/:lang    seller: upsert { title, summary? }
//   DELETE /api/v1/partner/products/:id/translations/:lang    seller: remove a language
//   GET    /api/v1/products/:id/localized?lang=xx             public: title + canonical slug/path for a language
// The slug is always derived from the title here (never client-supplied), so a
// title edit moves the canonical URL and the old slug 301s at the edge.

import { json, readJson, bad, notFound, forbidden, str } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';
import { notifyProductChanged } from '../services/seo/indexnow.js';
import { slugify, isLang, DEFAULT_CURRENCY } from '../../../../packages/ui/src/locale.config.ts';
import { TRANSLATABLE_LANGS, loadTranslations, contentLangs, slugOf, titleOf, productPath } from '../lib/translations.js';

const OWN = /^\/api\/v1\/partner\/products\/([^/]+)\/translations(?:\/([a-z-]+))?$/;
const PUB = /^\/api\/v1\/products\/([^/]+)\/localized$/;

async function ownProduct(request, env, productId) {
  const me = await requireAuth(request, env, ['ROLE_PARTNER']);
  if (!me.partner) throw forbidden('판매자 계정에 연결된 입점사 정보가 없습니다.');
  const p = await env.DB.prepare('SELECT id, title, partner_id, status, review_status FROM products WHERE id = ?').bind(productId).first();
  if (!p || p.partner_id !== me.partner.id) throw notFound('상품을 찾을 수 없습니다.');
  return p;
}

export async function handleTranslationRoutes(request, url, env, corsHeaders) {
  const own = url.pathname.match(OWN);
  if (own) {
    const productId = decodeURIComponent(own[1]);
    const lang = own[2] || null;
    if (!lang && request.method === 'GET') {
      const p = await ownProduct(request, env, productId);
      const tr = await loadTranslations(env, productId);
      return json(corsHeaders, {
        success: true,
        data: {
          product_id: p.id,
          source: { lang: 'ko', title: p.title, slug: slugOf(p, tr, 'ko') },
          languages: TRANSLATABLE_LANGS,
          translations: TRANSLATABLE_LANGS.filter((l) => tr[l]).map((l) => ({ lang: l, ...tr[l] }))
        }
      });
    }
    if (lang && (request.method === 'PUT' || request.method === 'DELETE')) {
      if (!TRANSLATABLE_LANGS.includes(lang)) throw bad('INVALID_LANG', `번역 언어는 ${TRANSLATABLE_LANGS.join('·')} 중 하나여야 합니다.`);
      const p = await ownProduct(request, env, productId);
      if (request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM product_translations WHERE product_id = ? AND lang = ?').bind(productId, lang).run();
        await notifyProductChanged(env, productId, p);
        return json(corsHeaders, { success: true, message: '번역을 삭제했습니다.' });
      }
      const b = await readJson(request);
      const title = str(b.title, { field: '번역 상품명', max: 200, required: true }).trim();
      if ([...title].length < 2) throw bad('TITLE_TOO_SHORT', '번역 상품명은 2자 이상이어야 합니다.');
      const summary = str(b.summary, { field: '번역 요약', max: 2000 }) || null;
      const slug = slugify(title);
      if (!slug) throw bad('TITLE_NOT_SLUGGABLE', '상품명에 글자나 숫자가 하나 이상 있어야 합니다.');
      await env.DB.prepare(
        `INSERT INTO product_translations (product_id, lang, title, summary, slug) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(product_id, lang) DO UPDATE SET title = excluded.title, summary = excluded.summary,
           slug = excluded.slug, updated_at = CURRENT_TIMESTAMP`
      ).bind(productId, lang, title, summary, slug).run();
      await notifyProductChanged(env, productId, p);
      return json(corsHeaders, { success: true, message: '번역을 저장했습니다.', data: { product_id: productId, lang, title, summary, slug } });
    }
    return null;
  }

  const pub = url.pathname.match(PUB);
  if (pub && request.method === 'GET') {
    const productId = decodeURIComponent(pub[1]);
    const lang = String(url.searchParams.get('lang') || 'ko').toLowerCase();
    if (!isLang(lang)) throw bad('INVALID_LANG', '지원하지 않는 언어입니다.');
    const p = await env.DB.prepare('SELECT id, title FROM products WHERE id = ?').bind(productId).first();
    if (!p) throw notFound('상품을 찾을 수 없습니다.');
    const tr = await loadTranslations(env, productId);
    const langs = contentLangs(tr);
    const translated = langs.includes(lang);
    return json(corsHeaders, {
      success: true,
      data: {
        product_id: p.id,
        lang,
        translated,
        title: titleOf(p, tr, lang),
        summary: (lang !== 'ko' && tr[lang] && tr[lang].summary) || null,
        slug: slugOf(p, tr, lang) || slugOf(p, tr, 'ko'),
        path: productPath(p, tr, lang, DEFAULT_CURRENCY[lang]),
        content_langs: langs
      }
    });
  }
  return null;
}
