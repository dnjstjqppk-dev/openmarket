// apps/cloudflare-gateway/src/lib/translations.js
// Seller-entered product translations (d1_78, decision 22) and the localized
// PDP URL built from them. ko is the source language (products.title); a
// language without a row is not indexed for that product.

import {
  LANGS, SOURCE_LANG, DEFAULT_CURRENCY, slugify, localizedPath, productBarePath
} from '../../../../packages/ui/src/locale.config.ts';

export const TRANSLATABLE_LANGS = LANGS.filter((l) => l !== SOURCE_LANG);

/** { en: row, ja: row, ... } for one product. A database without d1_78 yields {}. */
export async function loadTranslations(env, productId) {
  try {
    const { results } = await env.DB.prepare(
      'SELECT lang, title, summary, slug, updated_at FROM product_translations WHERE product_id = ?'
    ).bind(productId).all();
    const out = {};
    for (const r of results || []) out[r.lang] = r;
    return out;
  } catch {
    return {};
  }
}

/** Languages with real content for this product: ko always, others only when translated. */
export function contentLangs(translations) {
  return [SOURCE_LANG, ...TRANSLATABLE_LANGS.filter((l) => translations && translations[l])];
}

/** Canonical slug of a product in `lang` ('' when that language has no content). */
export function slugOf(product, translations, lang) {
  if (lang === SOURCE_LANG) return slugify(product && product.title) || '';
  const tr = translations && translations[lang];
  return tr ? tr.slug : '';
}

/** Title shown for `lang`: the translation, else the ko source title. */
export function titleOf(product, translations, lang) {
  const tr = lang !== SOURCE_LANG && translations ? translations[lang] : null;
  return tr ? tr.title : String((product && product.title) || '');
}

/** /{lang}/{currency}/p/{id}/{slug}; a language without content falls back to ko's slug. */
export function productPath(product, translations, lang, currency = DEFAULT_CURRENCY[lang]) {
  const slug = slugOf(product, translations, lang) || slugOf(product, translations, SOURCE_LANG);
  return localizedPath(lang, currency, productBarePath(product.id, slug));
}
