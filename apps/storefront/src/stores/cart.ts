// apps/storefront/src/stores/cart.ts
// OLMOA Cart Store: Real SKU Binding, Stock Ceilings, Partner-Grouped Split Shipping Calculation

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

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
  business_name: string;
  items: CartItem[];
  goods_amount: number;
  shipping_fee: number;
  free_shipping_threshold: number;
  free_shipping_remaining: number;
}

const STORAGE_KEY = 'olmoa_cart_items_v3';

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

  function addItem(product: any, sku: any, quantity: number = 1) {
    if (!sku || !sku.id) {
      if (product.skus && product.skus.length > 0) {
        sku = product.skus[0];
      } else {
        sku = {
          id: `sku_${product.id}`,
          sale_price: product.lowest_sale_price,
          original_price: product.lowest_original_price,
          stock_quantity: 100,
          option_combination_json: '{"옵션":"기본 표준형"}'
        };
      }
    }

    const skuId = sku.id;
    let summary = '기본';
    try {
      const opt = typeof sku.option_combination_json === 'string'
        ? JSON.parse(sku.option_combination_json)
        : (sku.options || {});
      summary = Object.entries(opt).map(([k, v]) => `${k}:${v}`).join(' / ') || '기본';
    } catch (_) {}

    const maxStock = sku.stock_quantity !== undefined ? sku.stock_quantity : 999;
    if (maxStock <= 0) return;

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
        stock_quantity: maxStock,
        partner_id: product.partner_id || 'pt_001',
        business_name: product.business_name || 'OLMOA Official Partner',
        base_shipping_fee: product.base_shipping_fee != null ? product.base_shipping_fee : 3000,
        free_shipping_threshold: product.free_shipping_threshold != null ? product.free_shipping_threshold : 30000
      });
    }
    save();
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
        const ceiling = item.stock_quantity !== undefined ? item.stock_quantity : 999;
        item.quantity = Math.min(quantity, ceiling);
        save();
      }
    }
  }

  function clearCart() {
    items.value = [];
    save();
  }

  // Group by partner_id to match Server Split-Order Shipping Calculation 100%
  const partnerGroups = computed<PartnerCartGroup[]>(() => {
    const map: Record<string, CartItem[]> = {};
    for (const it of items.value) {
      const pid = it.partner_id || 'pt_001';
      if (!map[pid]) map[pid] = [];
      map[pid].push(it);
    }
    return Object.entries(map).map(([pid, groupItems]) => {
      const goods = groupItems.reduce((sum, it) => sum + it.price * it.quantity, 0);
      const baseFee = groupItems[0].base_shipping_fee != null ? groupItems[0].base_shipping_fee : 3000;
      const threshold = groupItems[0].free_shipping_threshold != null ? groupItems[0].free_shipping_threshold : 30000;
      const fee = threshold > 0 && goods >= threshold ? 0 : baseFee;
      return {
        partner_id: pid,
        business_name: groupItems[0].business_name || (pid === 'pt_002' ? 'K-Tech & Lifestyle Official' : 'Global Direct Logistics Ltd.'),
        items: groupItems,
        goods_amount: goods,
        shipping_fee: fee,
        free_shipping_threshold: threshold,
        free_shipping_remaining: Math.max(0, threshold - goods)
      };
    });
  });

  const totalCount = computed(() => items.value.reduce((sum, item) => sum + item.quantity, 0));
  const totalGoodsAmount = computed(() => items.value.reduce((sum, item) => sum + (item.price * item.quantity), 0));
  const shippingFee = computed(() => partnerGroups.value.reduce((sum, g) => sum + g.shipping_fee, 0));
  const freeShippingRemaining = computed(() => {
    if (partnerGroups.value.length === 0) return 30000;
    return partnerGroups.value.reduce((sum, g) => sum + g.free_shipping_remaining, 0);
  });
  const totalPayAmount = computed(() => totalGoodsAmount.value + shippingFee.value);

  return {
    items,
    partnerGroups,
    addItem,
    updateSku,
    removeItem,
    updateQuantity,
    clearCart,
    totalCount,
    totalGoodsAmount,
    shippingFee,
    freeShippingRemaining,
    totalPayAmount
  };
});
