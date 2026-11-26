// Language / currency switching under the /{lang}/{currency} URL scheme
// (owner work order 2026-11-27, spec 5.2). Every change is a navigation — the
// address bar always shows the state — and the choice is remembered in the
// pref_lang / pref_currency cookies the edge reads for prefix-less visits.
//   language only:  /ko/krw/p/1/무선-이어폰?sku=BLK -> /en/krw/p/1?sku=BLK (the PDP restores the en slug)
//   currency only:  /ko/krw/p/1/무선-이어폰?sku=BLK -> /ko/usd/p/1/무선-이어폰?sku=BLK
//   market preset:  /ko/krw/c/electronics?page=2  -> /ja/jpy/c/electronics?page=2
import { useRoute, useRouter } from 'vue-router'
import {
  isLang, isCurrency, DEFAULT_CURRENCY, PREF_LANG_COOKIE, PREF_CURRENCY_COOKIE, PREF_COOKIE_ATTRS,
  type Lang, type Currency
} from '@olmoa/ui'
import { switchLocalePath } from '../router'

export function writePrefCookie(name: string, value: string): void {
  try {
    // Secure is ignored on http://localhost by browsers that allow it there; harmless elsewhere.
    document.cookie = `${name}=${encodeURIComponent(value)}; ${PREF_COOKIE_ATTRS}`
  } catch { /* cookies disabled: the URL still carries the choice */ }
}

export function useLocaleSwitch() {
  const route = useRoute()
  const router = useRouter()

  const current = (): { lang: Lang; currency: Currency } => ({
    lang: isLang(route.params.lang) ? route.params.lang : 'ko',
    currency: isCurrency(route.params.currency) ? route.params.currency : 'krw'
  })

  async function go(lang: Lang, currency: Currency) {
    const target = switchLocalePath(route.path, lang, currency)
    if (target === route.path) return
    await router.push({ path: target, query: route.query, hash: route.hash }).catch(() => {})
  }

  /** Language only: currency and query (e.g. ?sku) stay. */
  async function switchLang(lang: Lang) {
    writePrefCookie(PREF_LANG_COOKIE, lang)
    await go(lang, current().currency)
  }

  /** Currency only: language, slug and query stay. */
  async function switchCurrency(currency: Currency) {
    writePrefCookie(PREF_CURRENCY_COOKIE, currency)
    await go(current().lang, currency)
  }

  /** Market preset: language + its representative currency together. */
  async function switchMarket(lang: Lang) {
    writePrefCookie(PREF_LANG_COOKIE, lang)
    writePrefCookie(PREF_CURRENCY_COOKIE, DEFAULT_CURRENCY[lang])
    await go(lang, DEFAULT_CURRENCY[lang])
  }

  return { current, switchLang, switchCurrency, switchMarket }
}
