// apps/storefront/src/i18n.ts
// vue-i18n engine for the storefront. Messages live in ./locales/*.json (merged
// 2026-11-07 from the locale store DICT, which wins on conflicts, plus the keys
// only @olmoa/i18n carried). Fallback is always ko-KR.

import { createI18n } from 'vue-i18n';
import koKR from './locales/ko-KR.json';
import enUS from './locales/en-US.json';
import jaJP from './locales/ja-JP.json';
import zhTW from './locales/zh-TW.json';

export type StorefrontLocale = 'ko-KR' | 'en-US' | 'ja-JP' | 'zh-TW';

export const messages = {
  'ko-KR': koKR,
  'en-US': enUS,
  'ja-JP': jaJP,
  'zh-TW': zhTW
} as const;

// 2026-11-27: the URL prefix decides the language (main.ts applies it before
// the first render); the initial value is only the source language.
function initialLocale(): StorefrontLocale {
  const m = typeof location !== 'undefined' ? location.pathname.match(/^\/(ko|en|ja|zh-tw)\//i) : null;
  const lang = m ? m[1].toLowerCase() : 'ko';
  return lang === 'en' ? 'en-US' : lang === 'ja' ? 'ja-JP' : lang === 'zh-tw' ? 'zh-TW' : 'ko-KR';
}

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'ko-KR',
  // The pre-i18n store fell back silently; keep the console clean the same way.
  missingWarn: false,
  fallbackWarn: false,
  messages
});
