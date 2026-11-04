// apps/storefront/src/stores/locale.ts
// OLMOA Global Multi-Language (KO/EN/JA) & Multi-Currency (KRW/USD/JPY/EUR) Store

import { defineStore } from 'pinia';
import { ref, onMounted } from 'vue';
import { API_BASE_URL } from '../config';

export type SupportedLocale = 'ko-KR' | 'en-US' | 'ja-JP';
export type SupportedCurrency = 'KRW' | 'USD' | 'JPY' | 'EUR';

const DICT: Record<SupportedLocale, Record<string, string>> = {
  'ko-KR': {
    addToCart: '장바구니 담기',
    buyNow: '바로 구매',
    slogan: '내가 찾는 모든 것, 여기. (Everything You Seek. All Here.)',
    promoTop: '판매자별 무료배송 기준 적용 · 수령 후 7일 내 반품 신청 · 결제 후 30일 내 판매가 인하 시 차액 적립',
    allCategories: '전체 42개 카테고리',
    lightningDeals: '⚡ 번개특가',
    bestSellers: '👑 베스트 100',
    coupons: '🎟️ 쿠폰·적립금',
    wishlist: '찜목록',
    orders: '주문·배송',
    cart: '장바구니',
    support: '고객센터',
    sellerCenter: '셀러 입점',
    pcccTitle: '개인통관고유부호 (PCCC)',
    pcccPlaceholder: "P로 시작하는 13자리 입력 (예: P123456789012)",
    customsExempt: '소액물품 면세 대상 ($150 이하)',
    ddpOption: 'DDP (관부가세 포함 선납)',
    dduOption: 'DDU (수입 통관 시 후납)'
  },
  'en-US': {
    addToCart: 'Add to Cart',
    buyNow: 'Buy Now',
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
    sellerCenter: 'Sell on OLMOA',
    pcccTitle: 'Personal Customs Clearance Code (PCCC)',
    pcccPlaceholder: "13-character PCCC starting with 'P'",
    customsExempt: 'Duty-Free De Minimis ($150 and under)',
    ddpOption: 'DDP (Delivered Duty Paid)',
    dduOption: 'DDU (Delivered Duty Unpaid)'
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
    sellerCenter: '出店センター',
    pcccTitle: '個人通関固有符号 (PCCC)',
    pcccPlaceholder: 'Pで始まる13桁を入力',
    customsExempt: '少額免税対象 ($150以下)',
    ddpOption: 'DDP (関税・消費税前払い)',
    dduOption: 'DDU (受取時関税支払い)'
  }
};

export const useLocaleStore = defineStore('locale', () => {
  const locale = ref<SupportedLocale>('ko-KR');
  const currency = ref<SupportedCurrency>('KRW');
  const fxRates = ref<Record<string, number>>({
    USD: 1380,
    JPY: 9.0,
    EUR: 1490,
    CNY: 192
  });

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
          fxRates.value = {
            USD: Number(json.inverse_rates.USD) || 1380,
            JPY: Number(json.inverse_rates.JPY) || 9.0,
            EUR: Number(json.inverse_rates.EUR) || 1490,
            CNY: Number(json.inverse_rates.CNY) || 192
          };
        }
      }
    } catch (_) {}
  }

  fetchFxRates();

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

  function formatPrice(amountKrw: number | undefined | null, targetCurrency?: SupportedCurrency): string {
    const val = Number(amountKrw) || 0;
    const cur = targetCurrency || currency.value;

    if (cur === 'USD') {
      const rate = fxRates.value.USD || 1380;
      return '$' + (val / rate).toFixed(2);
    }
    if (cur === 'JPY') {
      const rate = fxRates.value.JPY || 9.0;
      return '¥' + Math.round(val / rate).toLocaleString();
    }
    if (cur === 'EUR') {
      const rate = fxRates.value.EUR || 1490;
      return '€' + (val / rate).toFixed(2);
    }
    return '₩' + Math.round(val).toLocaleString();
  }

  return {
    locale,
    currency,
    fxRates,
    setLocale,
    setCurrency,
    fetchFxRates,
    t,
    formatPrice
  };
});
