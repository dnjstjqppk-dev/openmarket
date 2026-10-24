// apps/storefront/src/stores/locale.ts
// OLMOA Global Multi-Language (KO/EN/JA) & Multi-Currency (KRW/USD/JPY) Store

import { defineStore } from 'pinia';
import { ref } from 'vue';

export type SupportedLocale = 'ko-KR' | 'en-US' | 'ja-JP';
export type SupportedCurrency = 'KRW' | 'USD' | 'JPY';

const DICT: Record<SupportedLocale, Record<string, string>> = {
  'ko-KR': {
    slogan: '내가 찾는 모든 것, 여기. (Everything You Seek. All Here.)',
    promoTop: '⚡ 3만원 이상 무료배송 · 90일 무료반품 · 30일 최저가 차액보상',
    allCategories: '전체 42개 카테고리',
    lightningDeals: '⚡ 번개특가',
    bestSellers: '👑 베스트 100',
    coupons: '🎟️ 쿠폰·적립금',
    wishlist: '찜목록',
    orders: '주문·배송',
    cart: '장바구니',
    support: '고객센터',
    sellerCenter: '셀러 입점'
  },
  'en-US': {
    slogan: 'Everything You Seek. All Here. — OLMOA Global',
    promoTop: '⚡ Free Shipping $25+ · 90-Day Free Returns · 30-Day Price Match Guarantee',
    allCategories: 'All 42 Categories',
    lightningDeals: '⚡ Lightning Deals',
    bestSellers: '👑 Best Sellers',
    coupons: '🎟️ Coupons & Credits',
    wishlist: 'Wishlist',
    orders: 'Orders',
    cart: 'Cart',
    support: 'Help Center',
    sellerCenter: 'Sell on OLMOA'
  },
  'ja-JP': {
    slogan: '探していたすべてが、ここに。(Everything You Seek. All Here.)',
    promoTop: '⚡ 3万ウォン以上送料無料 · 90日間無料返品 · 30日間最低価格保証',
    allCategories: '全42カテゴリー',
    lightningDeals: '⚡ タイムセール',
    bestSellers: '👑 ベスト100',
    coupons: '🎟️ クーポン・残高',
    wishlist: 'お気に入り',
    orders: '注文・配送',
    cart: 'カート',
    support: 'サポート',
    sellerCenter: '出店センター'
  }
};

export const useLocaleStore = defineStore('locale', () => {
  const locale = ref<SupportedLocale>('ko-KR');
  const currency = ref<SupportedCurrency>('KRW');

  try {
    const savedLoc = localStorage.getItem('olmoa_locale') as SupportedLocale;
    const savedCur = localStorage.getItem('olmoa_currency') as SupportedCurrency;
    if (savedLoc && DICT[savedLoc]) locale.value = savedLoc;
    if (savedCur && ['KRW', 'USD', 'JPY'].includes(savedCur)) currency.value = savedCur;
  } catch (_) {}

  function setLocale(newLoc: SupportedLocale) {
    locale.value = newLoc;
    try { localStorage.setItem('olmoa_locale', newLoc); } catch (_) {}
  }

  function setCurrency(newCur: SupportedCurrency) {
    currency.value = newCur;
    try { localStorage.setItem('olmoa_currency', newCur); } catch (_) {}
  }

  function t(key: string, fallback: string = ''): string {
    return DICT[locale.value]?.[key] || DICT['ko-KR'][key] || fallback || key;
  }

  function formatPrice(amountKrw: number | undefined | null): string {
    const val = Number(amountKrw) || 0;
    if (currency.value === 'USD') {
      return '$' + (val / 1350).toFixed(2);
    }
    if (currency.value === 'JPY') {
      return '¥' + Math.round(val / 9).toLocaleString();
    }
    return '₩' + Math.round(val).toLocaleString();
  }

  return {
    locale,
    currency,
    setLocale,
    setCurrency,
    t,
    formatPrice
  };
});
