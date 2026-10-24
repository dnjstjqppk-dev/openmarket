// packages/shared/index.ts
// Shared Utilities, Currency Formatters, Shipping Calculators & HTML Sanitizer

export type SupportedCurrency = 'KRW' | 'USD' | 'JPY';

export const EXCHANGE_RATES: Record<SupportedCurrency, number> = {
  KRW: 1,
  USD: 1350, // 1 USD = 1,350 KRW
  JPY: 9     // 1 JPY = 9 KRW (100 JPY = 900 KRW)
};

export function formatCurrency(amountKrw: number, currency: SupportedCurrency = 'KRW'): string {
  const safeVal = Number(amountKrw) || 0;
  switch (currency) {
    case 'USD':
      return '$' + (safeVal / EXCHANGE_RATES.USD).toFixed(2);
    case 'JPY':
      return '¥' + Math.round(safeVal / EXCHANGE_RATES.JPY).toLocaleString();
    case 'KRW':
    default:
      return '₩' + Math.round(safeVal).toLocaleString();
  }
}

export function calculatePartnerShippingFee(
  subTotal: number,
  baseFee: number = 3000,
  freeThreshold: number = 30000
): number {
  if (subTotal <= 0) return 0;
  if (freeThreshold > 0 && subTotal >= freeThreshold) {
    return 0;
  }
  return baseFee;
}

export function sanitizeHtml(dirtyHtml: string): string {
  if (!dirtyHtml) return '';
  return dirtyHtml
    .replace(/<(script|iframe|object|embed|form|meta|link|style)\b[^>]*>([\s\S]*?)<\/\1>/gim, '')
    .replace(/<(script|iframe|object|embed|meta|link)\b[^>]*\/?>/gim, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gim, '')
    .replace(/javascript\s*:/gim, 'blocked:');
}
