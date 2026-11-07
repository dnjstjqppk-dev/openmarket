// apps/cloudflare-gateway/src/services/pricing/global-pricing-engine.js
// Comprehensive Global Pricing, Currency, Logistics, Duty, Channel Commission, and Margin Engine.

import { FALLBACK_KRW_PER_UNIT } from '../../lib/fx.js';

// Kept export: alias of the single-source reference map. Request handlers with
// DB access inject live operator-table rates via the fxRatesToKrw parameter.
export const FX_RATES_TO_KRW = FALLBACK_KRW_PER_UNIT;

export const CHANNEL_COMMISSIONS_BPS = {
  OLMOA_MAIN: 0,             // 0% (Direct)
  NAVER_SMARTSTORE: 550,     // 5.5%
  COUPANG_MARKETPLACE: 1080, // 10.8%
  ELEVEN_STREET_KR: 1200,    // 12.0%
  GMARKET_ESM: 1300,         // 13.0%
  AMAZON_US_FBA_MFN: 1500,   // 15.0%
  SHOPEE_SG_CROSSBORDER: 800 // 8.0%
};

export function calculateGlobalPrice({
  wholesaleCost,
  currency = 'KRW',
  targetMarginRateBps = 2000, // 20.0%
  channelCode = 'NAVER_SMARTSTORE',
  weightKg = 0.5,
  isCrossborder = false,
  originCountry = 'CN',
  minMarginKrw = 3000,
  roundingUnit = 100,
  fxRatesToKrw = FX_RATES_TO_KRW
}) {
  // 1. Currency Conversion to KRW
  const fx = fxRatesToKrw[currency.toUpperCase()] || 1.0;
  const fxBuffer = 1.02; // 2% currency fluctuation hedge buffer
  const supplyCostKrw = Math.round(Number(wholesaleCost || 0) * fx * fxBuffer);

  // 2. Shipping & Logistics Costs
  let internationalShippingKrw = 0;
  if (isCrossborder) {
    // Tiered air/sea freight: 5,000 KRW base + 2,500 KRW per 0.5kg
    const extraUnits = Math.max(0, Math.ceil((weightKg - 0.5) / 0.5));
    internationalShippingKrw = 5000 + extraUnits * 2500;
  }
  const domesticShippingKrw = 3000;
  const totalLogisticsKrw = internationalShippingKrw + domesticShippingKrw;

  // 3. Customs Duty & VAT (Crossborder de minimis check: $150 threshold, US $200)
  let customsDutyKrw = 0;
  let vatKrw = 0;
  const totalDutiableUsd = (supplyCostKrw + internationalShippingKrw) / ((fxRatesToKrw.USD || 1.0) * fxBuffer);
  const deMinimisLimitUsd = originCountry.toUpperCase() === 'US' ? 200 : 150;

  if (isCrossborder && totalDutiableUsd > deMinimisLimitUsd) {
    customsDutyKrw = Math.round((supplyCostKrw + internationalShippingKrw) * 0.08); // 8% general duty
    vatKrw = Math.round((supplyCostKrw + internationalShippingKrw + customsDutyKrw) * 0.10); // 10% VAT
  }
  const totalCustomsKrw = customsDutyKrw + vatKrw;

  // 4. Base Cost Before Platform & Margin
  const totalLandedCostKrw = supplyCostKrw + totalLogisticsKrw + totalCustomsKrw;

  // 5. Channel Commission & Operational Buffers
  const channelBps = CHANNEL_COMMISSIONS_BPS[channelCode] || 1000; // default 10%
  const pgFeeBps = 300;     // 3.0% PG capture & processing
  const returnReserveBps = 150; // 1.5% refund/claim risk buffer
  const totalDeductionBps = channelBps + pgFeeBps + returnReserveBps;

  // 6. Retail Price Calculation with Net Margin Guarantee
  // Formula: SalePrice * (1 - deductionRate) >= LandedCost + TargetMargin
  // SalePrice = (LandedCost + MinMargin) / (1 - (deductionRate + marginRate))
  const targetMarginFraction = targetMarginRateBps / 10000;
  const totalFeeFraction = totalDeductionBps / 10000;
  const divisor = Math.max(0.1, 1 - (totalFeeFraction + targetMarginFraction));

  let rawSalePriceKrw = totalLandedCostKrw / divisor;

  // Ensure minimum profit margin in KRW
  if ((rawSalePriceKrw - totalLandedCostKrw) < minMarginKrw) {
    rawSalePriceKrw = (totalLandedCostKrw + minMarginKrw) / (1 - totalFeeFraction);
  }

  // 7. Rounding to unit (e.g. 100 KRW ceiling)
  const finalSalePriceKrw = Math.ceil(rawSalePriceKrw / roundingUnit) * roundingUnit;
  const finalOriginalPriceKrw = Math.round(finalSalePriceKrw * 1.30); // 30% anchor MSRP

  // 8. Financial Breakdown
  const channelFeeKrw = Math.round(finalSalePriceKrw * (channelBps / 10000));
  const pgFeeKrw = Math.round(finalSalePriceKrw * (pgFeeBps / 10000));
  const returnBufferKrw = Math.round(finalSalePriceKrw * (returnReserveBps / 10000));
  const netProfitKrw = finalSalePriceKrw - totalLandedCostKrw - channelFeeKrw - pgFeeKrw - returnBufferKrw;
  const realizedMarginBps = Math.round((netProfitKrw / finalSalePriceKrw) * 10000);

  // 9. Negative Margin Guard
  const isLossRisk = netProfitKrw <= 0;

  return {
    input: {
      wholesale_cost: wholesaleCost,
      currency,
      channel_code: channelCode,
      weight_kg: weightKg,
      is_crossborder: isCrossborder
    },
    cost_breakdown: {
      supply_cost_krw: supplyCostKrw,
      international_shipping_krw: internationalShippingKrw,
      domestic_shipping_krw: domesticShippingKrw,
      customs_duty_krw: customsDutyKrw,
      vat_krw: vatKrw,
      total_landed_cost_krw: totalLandedCostKrw
    },
    fees_breakdown: {
      channel_commission_krw: channelFeeKrw,
      channel_commission_rate_bps: channelBps,
      pg_fee_krw: pgFeeKrw,
      return_reserve_krw: returnBufferKrw
    },
    pricing_result: {
      sale_price_krw: finalSalePriceKrw,
      original_price_krw: finalOriginalPriceKrw,
      net_profit_krw: netProfitKrw,
      realized_margin_rate_bps: realizedMarginBps,
      is_loss_risk: isLossRisk
    }
  };
}

