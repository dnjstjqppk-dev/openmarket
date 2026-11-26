// packages/ui/src/locale.config.ts
// Single source for the /{lang}/{currency} URL scheme (owner work order
// 2026-11-27, decisions 22-25). Imported by the storefront SPA, the apex edge
// worker and the API gateway (esbuild bundles this TS file into both workers),
// so every layer parses, builds and canonicalizes URLs the same way.
//
//   https://olmoa.com/{lang}/{currency}/{page-path}?{query}
//
// Pure functions only — no DOM, no fetch, no env.

export const LANGS = ['ko', 'en', 'ja', 'zh-tw'] as const
export type Lang = (typeof LANGS)[number]

export const CURRENCIES = ['krw', 'usd', 'jpy', 'twd'] as const
export type Currency = (typeof CURRENCIES)[number]

/** The language products are written in; the only language with content for every product. */
export const SOURCE_LANG: Lang = 'ko'

/** Each language's single index-eligible ("representative") currency. */
export const DEFAULT_CURRENCY: Record<Lang, Currency> = { ko: 'krw', en: 'usd', ja: 'jpy', 'zh-tw': 'twd' }

/** hreflang / BCP-47 / OG locale per language. */
export const HREFLANG: Record<Lang, string> = { ko: 'ko', en: 'en', ja: 'ja', 'zh-tw': 'zh-TW' }
export const BCP47: Record<Lang, string> = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', 'zh-tw': 'zh-TW' }
export const OG_LOCALE_OF: Record<Lang, string> = { ko: 'ko_KR', en: 'en_US', ja: 'ja_JP', 'zh-tw': 'zh_TW' }

/** ISO 3166-1 country -> entry locale. Anything else (incl. XX/T1) -> FALLBACK_LOCALE. */
export const COUNTRY_LOCALE: Record<string, { lang: Lang; currency: Currency }> = {
  KR: { lang: 'ko', currency: 'krw' },
  US: { lang: 'en', currency: 'usd' },
  JP: { lang: 'ja', currency: 'jpy' },
  TW: { lang: 'zh-tw', currency: 'twd' }
}
export const FALLBACK_LOCALE: { lang: Lang; currency: Currency } = { lang: 'en', currency: 'usd' }

/** Upper-case ISO codes and display decimals (USD has cents; KRW/JPY/TWD are shown whole). */
export const CURRENCY_CODE: Record<Currency, string> = { krw: 'KRW', usd: 'USD', jpy: 'JPY', twd: 'TWD' }
export const CURRENCY_DECIMALS: Record<Currency, number> = { krw: 0, usd: 2, jpy: 0, twd: 0 }

/** Preference cookies (spec 5.2). `pref_curr` is read too (the spec uses both spellings). */
export const PREF_LANG_COOKIE = 'pref_lang'
export const PREF_CURRENCY_COOKIE = 'pref_currency'
export const PREF_CURRENCY_COOKIE_ALT = 'pref_curr'
export const PREF_COOKIE_ATTRS = 'Path=/; Max-Age=31536000; SameSite=Lax; Secure'

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v)
export const isCurrency = (v: unknown): v is Currency => typeof v === 'string' && (CURRENCIES as readonly string[]).includes(v)

/** Paths that never get a locale prefix and are never Geo-redirected (spec 2.4). */
export function isUnprefixedPath(pathname: string): boolean {
  const p = String(pathname || '/')
  if (p === '/favicon.ico' || p === '/robots.txt' || p === '/sitemap.xml' || p === '/sitemap-index.xml') return true
  if (p === '/manifest.webmanifest' || p === '/sw.js' || p === '/theme-init.js') return true
  if (/^\/(api|assets|static|_nuxt|_next|cdn-cgi|images|icons|sitemaps|llms|fonts)(\/|$)/.test(p)) return true
  // /llms.txt, /ads.txt, IndexNow key files, any other root text/xml/image file.
  if (/^\/[^/]+\.(txt|xml|png|jpe?g|webp|svg|ico|json|js|css|map|woff2?)$/i.test(p)) return true
  return false
}

export interface LocalePath {
  lang: Lang
  currency: Currency
  /** The page path after the prefix, always starting with '/' ('/' for home). */
  bare: string
  /** true when the prefix was valid but not lower-case (-> 301 to the lower-case form). */
  needsLowercase: boolean
}

/** Parse '/{lang}/{currency}/rest'. null = no valid prefix. Case-insensitive; reports when lowering is needed. */
export function parseLocalePath(pathname: string): LocalePath | null {
  const p = String(pathname || '/')
  const m = p.match(/^\/([A-Za-z]{2}(?:-[A-Za-z]{2})?)\/([A-Za-z]{3})(\/.*)?$/)
  if (!m) return null
  const lang = m[1].toLowerCase()
  const currency = m[2].toLowerCase()
  if (!isLang(lang) || !isCurrency(currency)) return null
  let bare = m[3] || '/'
  if (bare.length > 1 && bare.endsWith('/')) bare = bare.replace(/\/+$/, '') || '/'
  return { lang, currency, bare, needsLowercase: m[1] !== lang || m[2] !== currency }
}

/** '/ko/krw' + '/p/1/slug' -> '/ko/krw/p/1/slug'; home is '/ko/krw' (no trailing slash). */
export function localizedPath(lang: Lang, currency: Currency, bare = '/'): string {
  const b = !bare || bare === '/' ? '' : (bare.startsWith('/') ? bare : `/${bare}`)
  return `/${lang}/${currency}${b}`
}

/** spec 5.1 buildLocalizedPath(path, query) for the current lang/currency. */
export function buildLocalizedPath(lang: Lang, currency: Currency, path: string, query?: Record<string, unknown> | string): string {
  const [rawPath, rawQuery] = String(path || '/').split('?')
  const existing = parseLocalePath(rawPath)
  const bare = existing ? existing.bare : legacyToBare(rawPath)
  const out = localizedPath(existing ? existing.lang : lang, existing ? existing.currency : currency, bare)
  let qs = rawQuery || ''
  if (query && typeof query === 'object') {
    const sp = new URLSearchParams(qs)
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue
      if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)))
      else sp.set(k, String(v))
    }
    qs = sp.toString()
  } else if (typeof query === 'string' && query) {
    qs = query.replace(/^\?/, '')
  }
  return qs ? `${out}?${qs}` : out
}

/**
 * Map a pre-2026-11-27 path to the new bare shape: /product/:id -> /p/:id,
 * /category/:slug -> /c/:slug; the untranslated /en and /ja mirrors lose
 * their prefix (the caller keeps their language). Everything else is unchanged.
 */
export function legacyToBare(pathname: string): string {
  let p = String(pathname || '/').split('?')[0] || '/'
  if (!p.startsWith('/')) p = `/${p}`
  p = p.replace(/^\/(en|ja)(?=\/|$)/, '') || '/'
  const prod = p.match(/^\/product\/([^/]+)\/?$/)
  if (prod) return `/p/${prod[1]}`
  const cat = p.match(/^\/category\/([^/]+)\/?$/)
  if (cat) return `/c/${cat[1]}`
  if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '') || '/'
  return p
}

/** Language a legacy mirror path carried ('/en/...' -> 'en'), else null. */
export function legacyMirrorLang(pathname: string): Lang | null {
  const m = String(pathname || '').match(/^\/(en|ja)(\/|$)/)
  return m ? (m[1] as Lang) : null
}

/** Pre-move public paths that were indexed (they move with 301, decision 24). */
export function isLegacyIndexedPath(pathname: string): boolean {
  const p = String(pathname || '/')
  if (/^\/(en|ja)(\/|$)/.test(p)) return true
  return /^\/(product|category|store|channel|legal|policy)\//.test(p) || p === '/categories' || p === '/support'
}

/**
 * URL slug from a product title: NFC, lower-case, letters/digits of any script
 * kept, everything else collapsed to '-', capped at 80 chars. '' when nothing is left.
 */
export function slugify(text: string): string {
  const s = String(text || '').normalize('NFC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return [...s].slice(0, 80).join('').replace(/-+$/, '')
}

/** /p/{id}/{slug} bare path (slug percent-encoded per segment rules). */
export function productBarePath(id: string, slug?: string | null): string {
  const s = slug ? `/${encodeURIComponent(slug)}` : ''
  return `/p/${encodeURIComponent(id)}${s}`
}

/**
 * KRW amount -> amount in `currency` at `krwPerUnit` (KRW per 1 unit), rounded
 * to the currency's display decimals. null when no usable rate (caller shows KRW).
 * The storefront and the JSON-LD both use this, so the two always agree.
 */
export function convertFromKrw(amountKrw: number, currency: Currency, krwPerUnit: number | null | undefined): number | null {
  const v = Number(amountKrw)
  if (!Number.isFinite(v)) return null
  if (currency === 'krw') return Math.round(v)
  const r = Number(krwPerUnit)
  if (!(r > 0)) return null
  const d = CURRENCY_DECIMALS[currency]
  const f = 10 ** d
  return Math.round((v / r) * f) / f
}

/** Display string for an amount already in `currency` (e.g. '$12.34', '¥1,234', 'NT$1,234', '₩89,000'). */
export function formatMoney(amount: number, currency: Currency): string {
  const d = CURRENCY_DECIMALS[currency]
  const n = Number(amount)
  const body = n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
  const sym: Record<Currency, string> = { krw: '₩', usd: '$', jpy: '¥', twd: 'NT$' }
  return `${sym[currency]}${body}`
}

/** Entry locale for a visitor without a URL prefix: cookies, then country, then fallback (spec 3.1; no UA branching, decision 23). */
export function resolveEntryLocale({ cookieLang, cookieCurrency, country }: { cookieLang?: string | null; cookieCurrency?: string | null; country?: string | null }): { lang: Lang; currency: Currency; source: 'cookie' | 'geo' | 'fallback' } {
  const cl = String(cookieLang || '').toLowerCase()
  const cc = String(cookieCurrency || '').toLowerCase()
  if (isLang(cl)) return { lang: cl, currency: isCurrency(cc) ? cc : DEFAULT_CURRENCY[cl], source: 'cookie' }
  if (isCurrency(cc)) {
    const geo = COUNTRY_LOCALE[String(country || '').toUpperCase()]
    return { lang: geo ? geo.lang : FALLBACK_LOCALE.lang, currency: cc, source: 'cookie' }
  }
  const geo = COUNTRY_LOCALE[String(country || '').toUpperCase()]
  if (geo) return { ...geo, source: 'geo' }
  return { ...FALLBACK_LOCALE, source: 'fallback' }
}

// ---------------------------------------------------------------------------
// Head policy shared by the edge (gateway seo-head.localeHead) and the SPA
// (useSeoHead.applyRouteHead), so both always emit the same tags.

/** Private/transactional page paths (bare, after the prefix): noindex,nofollow. */
export const PRIVATE_BARE_PREFIXES = ['/cart', '/checkout', '/my', '/orders', '/login', '/register',
  '/forgot-password', '/verify-email', '/addresses', '/wishlist', '/coupons', '/payments']

export function isPrivateBare(bare: string): boolean {
  const p = String(bare || '/')
  return PRIVATE_BARE_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`))
}

/** Search results: noindex,follow (infinite combinations never indexed). */
export function isSearchBare(bare: string): boolean {
  const p = String(bare || '/')
  return p === '/search' || p.startsWith('/search/')
}

/** ?page=N (N>=2) survives canonicalization; page 1 is the bare URL. */
export function pageNumberOf(query: unknown): number {
  const q = (query || {}) as Record<string, unknown>
  const raw = Array.isArray(q.page) ? q.page[0] : q.page
  const n = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN
  return Number.isInteger(n) && n >= 2 ? n : 1
}

export interface LocaleUrlPolicyInput {
  lang: Lang
  currency: Currency
  bare: string
  /** Per-language bare path (PDP slugs differ by language); defaults to `bare`. */
  bareFor?: ((lang: Lang) => string) | null
  base: string
  query?: unknown
  /** Languages with real content for this page; ko is always included. */
  contentLangs?: Lang[]
}

/**
 *   representative URL (content language + its default currency): index,follow, self-canonical
 *   same language, other currency: noindex,follow, canonical -> that language's default currency
 *   language without content: noindex,follow, canonical -> the ko default-currency URL
 *   option/tracking query: dropped from canonical (only ?page=N>=2 kept)
 * hreflang: each content language's representative URL + x-default (en if it has content, else ko);
 * none on private and search pages.
 */
export function localeUrlPolicy(input: LocaleUrlPolicyInput): { canonical: string; robots: string; hreflangs: Array<{ hreflang: string; href: string }> } {
  const b = String(input.base || 'https://olmoa.com').replace(/\/$/, '')
  const given = input.contentLangs && input.contentLangs.length ? input.contentLangs : [SOURCE_LANG]
  const langs: Lang[] = given.includes(SOURCE_LANG) ? given : [SOURCE_LANG, ...given]
  const bareOf = (l: Lang) => (input.bareFor ? input.bareFor(l) : input.bare)
  const n = pageNumberOf(input.query)
  const suffix = n > 1 ? `?page=${n}` : ''
  const urlOf = (l: Lang) => `${b}${localizedPath(l, DEFAULT_CURRENCY[l], bareOf(l))}${suffix}`
  const hasContent = langs.includes(input.lang)
  const priv = isPrivateBare(input.bare)
  const search = isSearchBare(input.bare)
  const representative = hasContent && input.currency === DEFAULT_CURRENCY[input.lang]
  return {
    canonical: urlOf(hasContent ? input.lang : SOURCE_LANG),
    robots: search ? 'noindex,follow' : (priv ? 'noindex,nofollow' : (representative ? 'index,follow' : 'noindex,follow')),
    hreflangs: priv || search ? [] : [
      ...langs.map((l) => ({ hreflang: HREFLANG[l], href: urlOf(l) })),
      { hreflang: 'x-default', href: urlOf(langs.includes('en') ? 'en' : SOURCE_LANG) }
    ]
  }
}
