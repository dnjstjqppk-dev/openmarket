// apps/storefront/src/stores/cart.ts
// OLMOA Cart Store: Real SKU Binding, Stock Ceilings, Local Storage Persistence

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
  partner_id?: string;
}

const STORAGE_KEY = 'olmoa_cart_items_v2';

export const useCartStore = defineStore('cart', () => {
  const items = ref<CartItem[]>([]);

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
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
      console.warn('Real SKU required. Reverting to first available SKU if possible');
      if (product.skus && product.skus.length > 0) {
        sku = product.skus[0];
      } else {
        return;
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
        partner_id: product.partner_id || 'pt_001'
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

  const totalCount = computed(() => items.value.reduce((sum, item) => sum + item.quantity, 0));
  const totalGoodsAmount = computed(() => items.value.reduce((sum, item) => sum + (item.price * item.quantity), 0));
  const shippingFee = computed(() => (items.value.length === 0 || totalGoodsAmount.value >= 30000) ? 0 : 3000);
  const freeShippingRemaining = computed(() => Math.max(0, 30000 - totalGoodsAmount.value));
  const totalPayAmount = computed(() => totalGoodsAmount.value + shippingFee.value);

  return {
    items,
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
