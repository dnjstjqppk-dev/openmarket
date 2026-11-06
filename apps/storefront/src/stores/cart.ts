// apps/storefront/src/stores/cart.ts
// OLMOA Cart Store: Real SKU Binding, Stock Ceilings, Partner-Grouped Split Shipping Calculation

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { lineTotal, shippingFee as shippingFeeFor, DEFAULT_FREE_THRESHOLD } from '../lib/pricing';

export interface CartItem {
  sku_id: string;
  product_id: string;
  title: string;
  option_summary: string;
  price: number;
  original_price: number;
  thumbnail_url: string;
  quantity: number;
  stock_quantity?: number;
  partner_id: string;
  business_name?: string;
  base_shipping_fee?: number;
  free_shipping_threshold?: number;
}

export interface PartnerCartGroup {
  partner_id: string;
  partner_name: string;
  business_name: string;
  items: CartItem[];
  goods_amount: number;
  shipping_fee: number;
  free_shipping_threshold: number;
  free_shipping_remaining: number;
  remaining_for_free: number;
}

const STORAGE_KEY = 'olmoa_cart_items_v3';
const UNKNOWN_SELLER = '__unknown_seller__';

export const useCartStore = defineStore('cart', () => {
  const items = ref<CartItem[]>([]);

  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('olmoa_cart_items_v2');
    if (saved) {
      items.value = JSON.parse(saved);
    }
  } catch (_) {}

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items.value));
    } catch (_) {}
  }

  /** Adds a real SKU (never an invented one). Returns false when nothing was added (no SKU / out of stock). */
  function addItem(product: any, sku?: any, quantity: number = 1): boolean {
  // Support flat-object call style used by newer views
  if (sku === undefined && product && product.sku_id && product.price != null) {
    const o = product;
    const prod = {
      id: o.product_id,
      title: o.title,
      thumbnail_url: o.thumbnail_url,
      partner_id: o.partner_id,
      business_name: o.partner_name || o.business_name,
      lowest_sale_price: o.price,
      lowest_original_price: o.original_price,
      base_shipping_fee: o.base_shipping_fee,
      free_shipping_threshold: o.free_shipping_threshold
    };
    const skuObj = {
      id: o.sku_id,
      sale_price: o.price,
      original_price: o.original_price,
      stock_quantity: o.stock_quantity,
      option_combination_json: JSON.stringify({ Option: o.option_Label || o.option_summary || 'Standard' })
    };
    return addItem(prod, skuObj, o.quantity || 1);
  }

  // No SKU, no cart line: the old fallback invented `sku_<product>` with stock 100, which checkout rejects.
  if (!sku || !sku.id) {
      if (product.skus && product.skus.length === 1) sku = product.skus[0];
      else return false;
    }
    if (!product.partner_id) return false;

    const skuId = sku.id;
    let summary = '기본';
    try {
      const opt = typeof sku.option_combination_json === 'string'
        ? JSON.parse(sku.option_combination_json)
        : (sku.options || {});
      summary = Object.entries(opt).map(([k, v]) => `${k}:${v}`).join(' / ') || '기본';
    } catch (_) {}

    // Unknown stock is not capped here; checkout re-checks stock on the server (STOCK_INSUFFICIENT).
    const maxStock = sku.stock_quantity != null ? Number(sku.stock_quantity) : Number.MAX_SAFE_INTEGER;
    if (maxStock <= 0) return false;

    const existing = items.value.find(i => i.sku_id === skuId);
    if (existing) {
      existing.quantity = Math.min(existing.quantity + quantity, maxStock);
    } else {
      items.value.push({
        sku_id: skuId,
        product_id: product.id,
        title: product.title,
        option_summary: summary,
        price: sku.sale_price || product.lowest_sale_price,
        original_price: sku.original_price || product.lowest_original_price,
        thumbnail_url: product.thumbnail_url,
        quantity: Math.min(quantity, maxStock),
        stock_quantity: sku.stock_quantity != null ? Number(sku.stock_quantity) : undefined,
        partner_id: product.partner_id,
        business_name: product.business_name || product.partner_name || '',
        base_shipping_fee: product.base_shipping_fee != null ? product.base_shipping_fee : 3000,
        free_shipping_threshold: product.free_shipping_threshold != null ? product.free_shipping_threshold : 30000
      });
    }
    save();
    return true;
  }

  function updateSku(oldSkuId: string, newSku: any) {
    const item = items.value.find(i => i.sku_id === oldSkuId);
    if (!item || !newSku) return;

    item.sku_id = newSku.id;
    item.price = newSku.sale_price;
    item.original_price = newSku.original_price;
    item.stock_quantity = newSku.stock_quantity;

    let summary = '기본';
    try {
      const opt = typeof newSku.option_combination_json === 'string'
        ? JSON.parse(newSku.option_combination_json)
        : (newSku.options || {});
      summary = Object.entries(opt).map(([k, v]) => `${k}:${v}`).join(' / ') || '기본';
    } catch (_) {}
    item.option_summary = summary;

    if (item.quantity > newSku.stock_quantity) {
      item.quantity = Math.max(1, newSku.stock_quantity);
    }
    save();
  }

  function removeItem(skuId: string) {
    items.value = items.value.filter(i => i.sku_id !== skuId);
    save();
  }

  function updateQuantity(skuId: string, quantity: number) {
    const item = items.value.find(i => i.sku_id === skuId);
    if (item) {
      if (quantity <= 0) {
        removeItem(skuId);
      } else {
        const ceiling = item.stock_quantity != null ? item.stock_quantity : Number.MAX_SAFE_INTEGER;
        item.quantity = Math.min(quantity, ceiling);
        save();
      }
    }
  }

  function clearCart() {
    items.value = [];
    save();
  }

  // Group by seller exactly like the server splits sub-orders (services/orders.js): goods = sum of volume-tier
  // line totals, shipping = 0 when threshold > 0 && goods >= threshold, else the seller's base fee.
  // Lines saved by an older build without partner_id are grouped as "판매자 확인 필요" instead of being
  // assigned to a real seller id; checkout resolves the seller from the SKU anyway.
  const partnerGroups = computed<PartnerCartGroup[]>(() => {
    const map: Record<string, CartItem[]> = {};
    for (const it of items.value) {
      const pid = it.partner_id || UNKNOWN_SELLER;
      if (!map[pid]) map[pid] = [];
      map[pid].push(it);
    }
    return Object.entries(map).map(([pid, groupItems]) => {
      const goods = groupItems.reduce((sum, it) => sum + lineTotal(it.price, it.quantity), 0);
      const threshold = groupItems[0].free_shipping_threshold ?? DEFAULT_FREE_THRESHOLD;
      const fee = shippingFeeFor(goods, groupItems[0].base_shipping_fee, groupItems[0].free_shipping_threshold);
      const name = groupItems[0].business_name || (pid === UNKNOWN_SELLER ? '판매자 확인 필요' : '판매자');
      const remaining = threshold > 0 && fee > 0 ? Math.max(0, threshold - goods) : 0;
      return {
        partner_id: pid,
        partner_name: name,
        business_name: name,
        items: groupItems,
        goods_amount: goods,
        shipping_fee: fee,
        free_shipping_threshold: threshold,
        free_shipping_remaining: remaining,
        remaining_for_free: remaining
      };
    });
  });

  const totalCount = computed(() => items.value.reduce((sum, item) => sum + item.quantity, 0));
  /** Goods after quantity tiers (what the server charges before coupons/credit). */
  const totalGoodsAmount = computed(() => partnerGroups.value.reduce((sum, g) => sum + g.goods_amount, 0));
  /** Saving from quantity tiers only. */
  const volumeSavings = computed(() => items.value.reduce((sum, it) => sum + (it.price * it.quantity - lineTotal(it.price, it.quantity)), 0));
  const shippingFee = computed(() => partnerGroups.value.reduce((sum, g) => sum + g.shipping_fee, 0));
  const freeShippingRemaining = computed(() => partnerGroups.value.reduce((sum, g) => sum + g.free_shipping_remaining, 0));
  const totalPayAmount = computed(() => totalGoodsAmount.value + shippingFee.value);
  /** List-price saving + quantity-tier saving. */
  const totalSavings = computed(() => items.value.reduce((sum, item) => {
    const orig = item.original_price || item.price;
    return sum + Math.max(0, (orig - item.price) * item.quantity);
  }, 0) + volumeSavings.value);
  const partnerShippingBreakdown = partnerGroups;
  const subtotalAmount = totalGoodsAmount;
  const finalTotal = totalPayAmount;

  return {
    items,
    partnerGroups,
    volumeSavings,
    partnerShippingBreakdown,
    addItem,
    updateSku,
    removeItem,
    updateQuantity,
    clearCart,
    totalCount,
    totalGoodsAmount,
    subtotalAmount,
    shippingFee,
    freeShippingRemaining,
    totalPayAmount,
    finalTotal,
    totalSavings
  };
});
