// apps/storefront/src/i18n.ts
// vue-i18n engine for the storefront. Messages live in ./locales/*.json (merged
// 2026-11-07 from the locale store DICT, which wins on conflicts, plus the keys
// only @olmoa/i18n carried). Fallback is always ko-KR.

import { createI18n } from 'vue-i18n';
import koKR from './locales/ko-KR.json';
import enUS from './locales/en-US.json';
import jaJP from './locales/ja-JP.json';

export type StorefrontLocale = 'ko-KR' | 'en-US' | 'ja-JP';

export const messages = {
  'ko-KR': koKR,
  'en-US': enUS,
  'ja-JP': jaJP
} as const;

function storedLocale(): StorefrontLocale {
  try {
    const saved = localStorage.getItem('olmoa_locale');
    if (saved === 'ko-KR' || saved === 'en-US' || saved === 'ja-JP') return saved;
  } catch (_) {}
  return 'ko-KR';
}

export const i18n = createI18n({
  legacy: false,
  locale: storedLocale(),
  fallbackLocale: 'ko-KR',
  // The pre-i18n store fell back silently; keep the console clean the same way.
  missingWarn: false,
  fallbackWarn: false,
  messages
});
