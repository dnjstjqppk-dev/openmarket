// apps/storefront/src/stores/locale.ts
// OLMOA languages (KO/EN/JA/ZH-TW) and display currencies (KRW/USD/JPY/TWD).
// Since 2026-11-27 both come from the URL (/{lang}/{currency}); this store only
// mirrors them for display. Changing either is a navigation (useLocaleSwitch).

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { API_BASE_URL } from '../config';
import { i18n, messages } from '../i18n';
import { convertFromKrw, formatMoney, setUiLocale, type Currency } from '@olmoa/ui';

export type SupportedLocale = 'ko-KR' | 'en-US' | 'ja-JP' | 'zh-TW';
export type SupportedCurrency = 'KRW' | 'USD' | 'JPY' | 'TWD';
export const URL_CURRENCIES: SupportedCurrency[] = ['KRW', 'USD', 'JPY', 'TWD'];

// Translation source of truth moved to locales/*.json behind vue-i18n (2026-11-07).
// This alias keeps the store's locale-membership checks compiling unchanged.
const DICT: Record<SupportedLocale, Record<string, string>> = messages as unknown as Record<SupportedLocale, Record<string, string>>;

export const useLocaleStore = defineStore('locale', () => {
  const locale = ref<SupportedLocale>('ko-KR');
  const currency = ref<SupportedCurrency>('KRW');
  // KRW per 1 unit of the currency, only as published by /fx/rates (operator table). No built-in numbers:
  // a currency without a published rate is shown in KRW instead of a made-up conversion.
  const fxRates = ref<Record<string, number>>({});
  const fxUpdatedAt = ref<string | null>(null);
  const fxNote = ref<string>('');
  const availableCurrencies = computed<SupportedCurrency[]>(() =>
    URL_CURRENCIES.filter((c) => c === 'KRW' || fxRates.value[c] > 0)
  );


  // Fetch live FX rates from backend API
  async function fetchFxRates() {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/fx/rates`);
      if (res.ok) {
        const json = await res.json();
        if (json.inverse_rates) {
          const next: Record<string, number> = {};
          for (const [k, v] of Object.entries(json.inverse_rates)) if (Number(v) > 0) next[k] = Number(v);
          fxRates.value = next;
          fxUpdatedAt.value = json.last_updated || null;
          fxNote.value = json.source_note || '';
        }
      }
    } catch (_) {}
  }

  fetchFxRates();

  function setLocale(newLoc: SupportedLocale) {
    locale.value = newLoc;
    i18n.global.locale.value = newLoc;
    setUiLocale(newLoc);
  }

  /** 6-2: display-only locale from the URL prefix (never persisted — no silent-setting). */
  function applyUrlLocale(newLoc: SupportedLocale) {
    if (locale.value === newLoc && i18n.global.locale.value === newLoc) {
      setUiLocale(newLoc);
      return;
    }
    locale.value = newLoc;
    i18n.global.locale.value = newLoc;
    setUiLocale(newLoc);
  }

  const NUDGE_KEY = 'olmoa_locale_nudge';
  function nudgeDismissed(): boolean {
    try { return sessionStorage.getItem(NUDGE_KEY) === '1'; } catch { return true; }
  }
  function dismissNudge() {
    try { sessionStorage.setItem(NUDGE_KEY, '1'); } catch { /* once per session best-effort */ }
  }

  /** Display-only currency from the URL (the URL is the source of truth). */
  function applyUrlCurrency(newCur: SupportedCurrency) {
    if (URL_CURRENCIES.includes(newCur)) currency.value = newCur;
  }

  function t(key: string, fallback: string = ''): string {
    // vue-i18n resolves the active locale with ko-KR fallback; a returned key
    // means the key itself is missing (keys are camelCase identifiers, never
    // rendered sentences), so fall through to the explicit fallback chain.
    const v = i18n.global.t(key);
    if (v !== key) return v;
    return DICT['ko-KR'][key] || fallback || key;
  }

  /** Converted with the shared convertFromKrw (same rate source and rounding as the
   *  edge JSON-LD). No published rate (or not loaded yet): the real KRW price. */
  function formatPrice(amountKrw: number | undefined | null, targetCurrency?: SupportedCurrency): string {
    const val = Number(amountKrw) || 0;
    const cur = (targetCurrency || currency.value).toLowerCase() as Currency;
    const converted = cur === 'krw' ? null : convertFromKrw(val, cur, fxRates.value[cur.toUpperCase()]);
    return converted === null ? formatMoney(Math.round(val), 'krw') : formatMoney(converted, cur);
  }

  return {
    locale,
    currency,
    fxRates,
    fxUpdatedAt,
    fxNote,
    availableCurrencies,
    setLocale,
    applyUrlLocale,
    nudgeDismissed,
    dismissNudge,
    applyUrlCurrency,
    fetchFxRates,
    t,
    formatPrice
  };
});
