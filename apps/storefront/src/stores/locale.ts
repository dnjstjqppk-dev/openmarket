// apps/storefront/src/stores/locale.ts
// OLMOA Global Multi-Language (KO/EN/JA) & Multi-Currency (KRW/USD/JPY/EUR) Store

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { API_BASE_URL } from '../config';
import { i18n, messages } from '../i18n';

export type SupportedLocale = 'ko-KR' | 'en-US' | 'ja-JP';
export type SupportedCurrency = 'KRW' | 'USD' | 'JPY' | 'EUR';

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
    (['KRW', 'USD', 'JPY', 'EUR'] as SupportedCurrency[]).filter((c) => c === 'KRW' || fxRates.value[c] > 0)
  );

  try {
    const savedLoc = localStorage.getItem('olmoa_locale') as SupportedLocale;
    const savedCur = localStorage.getItem('olmoa_currency') as SupportedCurrency;
    if (savedLoc && DICT[savedLoc]) locale.value = savedLoc;
    if (savedCur && ['KRW', 'USD', 'JPY', 'EUR'].includes(savedCur)) currency.value = savedCur;
  } catch (_) {}

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
    try { localStorage.setItem('olmoa_locale', newLoc); } catch (_) {}
  }

  function setCurrency(newCur: SupportedCurrency) {
    currency.value = newCur;
    try { localStorage.setItem('olmoa_currency', newCur); } catch (_) {}
  }

  function t(key: string, fallback: string = ''): string {
    // vue-i18n resolves the active locale with ko-KR fallback; a returned key
    // means the key itself is missing (keys are camelCase identifiers, never
    // rendered sentences), so fall through to the explicit fallback chain.
    const v = i18n.global.t(key);
    if (v !== key) return v;
    return DICT['ko-KR'][key] || fallback || key;
  }

  function formatPrice(amountKrw: number | undefined | null, targetCurrency?: SupportedCurrency): string {
    const val = Number(amountKrw) || 0;
    const cur = targetCurrency || currency.value;
    const rate = fxRates.value[cur];
    // no published rate (or rates not loaded yet): show the real KRW price rather than a guessed conversion
    if (cur === 'KRW' || !(rate > 0)) return '₩' + Math.round(val).toLocaleString();
    if (cur === 'USD') return '$' + (val / rate).toFixed(2);
    if (cur === 'JPY') return '¥' + Math.round(val / rate).toLocaleString();
    if (cur === 'EUR') return '€' + (val / rate).toFixed(2);
    return '₩' + Math.round(val).toLocaleString();
  }

  return {
    locale,
    currency,
    fxRates,
    fxUpdatedAt,
    fxNote,
    availableCurrencies,
    setLocale,
    setCurrency,
    fetchFxRates,
    t,
    formatPrice
  };
});
