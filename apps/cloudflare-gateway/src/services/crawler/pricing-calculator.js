// apps/cloudflare-gateway/src/services/crawler/pricing-calculator.js
// Applies pricing rules, profit margins, currency FX, and rounding units.

const DEFAULT_FX_RATES = {
  KRW: 1.0,
  USD: 1380.0,
  CNY: 195.0,
  JPY: 9.2,
  EUR: 1490.0
};

export function convertToKrw(amount, currency = 'KRW', fxRates = DEFAULT_FX_RATES) {
  const c = String(currency || 'KRW').toUpperCase();
  const rate = fxRates[c] || 1.0;
  return Math.round(Number(amount || 0) * rate);
}

export function calculateRetailPrice({
  wholesaleCostKrw,
  marginBps = 2000,           // 20.00%
  fixedAddAmount = 0,         // Optional fixed add KRW
  minimumMarginAmount = 3000, // Minimum profit KRW
  roundingUnit = 100          // Nearest 100 KRW
}) {
  const cost = Math.max(0, Number(wholesaleCostKrw || 0));
  const rateMultiplier = 1 + (Number(marginBps || 0) / 10000);

  let rawPrice = (cost * rateMultiplier) + Number(fixedAddAmount || 0);

  // Guarantee minimum margin amount
  if (rawPrice - cost < Number(minimumMarginAmount || 0)) {
    rawPrice = cost + Number(minimumMarginAmount || 0);
  }

  // Round according to roundingUnit (e.g. 100 -> round up to next 100)
  const unit = Math.max(1, Number(roundingUnit || 100));
  const roundedPrice = Math.ceil(rawPrice / unit) * unit;
  const finalMargin = roundedPrice - cost;
  const actualMarginPct = roundedPrice > 0 ? Math.round((finalMargin / roundedPrice) * 1000) / 10 : 0;

  return {
    cost_price: cost,
    sale_price: roundedPrice,
    original_price: Math.ceil((roundedPrice * 1.35) / unit) * unit, // Suggested reference retail
    margin_amount: finalMargin,
    margin_percentage: actualMarginPct,
    rounding_unit: unit
  };
}
