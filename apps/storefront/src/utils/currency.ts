// apps/storefront/src/utils/currency.ts
// OLMOA Currency Formatting & Fixed-Point Conversion Engine

export type SupportedCurrency = 'KRW' | 'USD' | 'JPY';
export type SupportedLocale = 'ko-KR' | 'en-US' | 'ja-JP';

export const RATES: Record<SupportedCurrency, number> = {
  KRW: 1.0,
  USD: 0.00072, // KRW 1,000 = USD 0.72 -> 49,900 KRW = $35.93
  JPY: 0.11    // KRW 1,000 = JPY 110
};

export function convertPrice(amountKRW: number, targetCurrency: SupportedCurrency = 'KRW'): number {
  if (!amountKRW || amountKRW <= 0) return 0;
  const rate = RATES[targetCurrency] || 1.0;
  return amountKRW * rate;
}

export function formatPrice(amountKRW: number, currency: SupportedCurrency = 'KRW'): string {
  if (amountKRW === undefined || amountKRW === null) return '₩0';
  const converted = convertPrice(amountKRW, currency);

  switch (currency) {
    case 'USD':
      return '$' + converted.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'JPY':
      return '¥' + Math.round(converted).toLocaleString('ja-JP');
    case 'KRW':
    default:
      return '₩' + Math.round(converted).toLocaleString('ko-KR');
  }
}
