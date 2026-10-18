// apps/storefront/src/stores/locale.ts
// OLMOA Global i18n & Multi-Currency Store

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { SupportedCurrency, SupportedLocale, formatPrice } from '../utils/currency';

const LOCALE_KEY = 'olmoa_locale';
const CURRENCY_KEY = 'olmoa_currency';

const TRANSLATIONS: Record<SupportedLocale, Record<string, string>> = {
  'ko-KR': {
    slogan: '내가 찾는 모든 것, 여기.',
    freeShipping: '전 상품 100% 무료배송 & 최저가 보장제',
    searchPlaceholder: '무엇이든 검색하세요! 패션, 디지털, 생활용품 등 1억개 상품...',
    orders: '주문·배송',
    cart: '장바구니',
    login: '로그인',
    logout: '로그아웃',
    allCategories: '전체 카테고리',
    flashDeals: '오늘의 번개특가',
    customerCenter: '고객행복센터'
  },
  'en-US': {
    slogan: 'Everything You Seek. All Here.',
    freeShipping: '100% Free Shipping on All Items & Lowest Price Guarantee',
    searchPlaceholder: 'Search anything! Fashion, Electronics, Home & more...',
    orders: 'Orders & Tracking',
    cart: 'Cart',
    login: 'Sign In',
    logout: 'Sign Out',
    allCategories: 'All Categories',
    flashDeals: 'Lightning Deals',
    customerCenter: 'Customer Support'
  },
  'ja-JP': {
    slogan: '欲しいものすべてが、ここに。',
    freeShipping: '全品100%送料無料＆最安値保証',
    searchPlaceholder: '何でも検索！ファッション、デジタル、日用品など…',
    orders: '注文・配送',
    cart: 'カート',
    login: 'ログイン',
    logout: 'ログアウト',
    allCategories: '全カテゴリー',
    flashDeals: 'タイムセール',
    customerCenter: 'カスタマーサポート'
  }
};

export const useLocaleStore = defineStore('locale', () => {
  const currentLocale = ref<SupportedLocale>((localStorage.getItem(LOCALE_KEY) as SupportedLocale) || 'ko-KR');
  const currentCurrency = ref<SupportedCurrency>((localStorage.getItem(CURRENCY_KEY) as SupportedCurrency) || 'KRW');

  function setLocale(loc: SupportedLocale) {
    currentLocale.value = loc;
    localStorage.setItem(LOCALE_KEY, loc);
  }

  function setCurrency(curr: SupportedCurrency) {
    currentCurrency.value = curr;
    localStorage.setItem(CURRENCY_KEY, curr);
  }

  function format(amountKRW: number): string {
    return formatPrice(amountKRW, currentCurrency.value);
  }

  function t(key: string): string {
    return TRANSLATIONS[currentLocale.value]?.[key] || TRANSLATIONS['ko-KR']?.[key] || key;
  }

  return {
    currentLocale,
    currentCurrency,
    setLocale,
    setCurrency,
    format,
    t
  };
});
