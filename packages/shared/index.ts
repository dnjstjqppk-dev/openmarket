// packages/shared/index.ts
// Shared Utilities and Currency Formatters

export function formatCurrency(amount: number, currency: 'KRW' | 'USD' | 'JPY' = 'KRW'): string {
  switch (currency) {
    case 'USD':
      return '$' + (amount / 100).toFixed(2);
    case 'JPY':
      return '¥' + amount.toLocaleString();
    case 'KRW':
    default:
      return '₩ ' + amount.toLocaleString();
  }
}

export function calculatePartnerShippingFee(
  subTotal: number,
  baseFee: number,
  freeThreshold: number
): number {
  if (freeThreshold > 0 && subTotal >= freeThreshold) {
    return 0;
  }
  return baseFee;
}
