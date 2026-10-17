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
  partner_id?: string;
}

const STORAGE_KEY = 'olmoa_cart_items_v1';

export const useCartStore = defineStore('cart', () => {
  const items = ref<CartItem[]>([]);

  // Load from localStorage on initialization
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

  function addItem(product: any, sku?: any, quantity: number = 1) {
    const skuId = sku ? sku.id : ('sku_' + product.id);
    const existing = items.value.find(i => i.sku_id === skuId);
    if (existing) {
      existing.quantity += quantity;
    } else {
      items.value.push({
        sku_id: skuId,
        product_id: product.id,
        title: product.title,
        option_summary: sku && sku.option_combination_json ? JSON.parse(sku.option_combination_json)['옵션'] || '표준형' : '단일옵션',
        price: sku ? sku.sale_price : product.lowest_sale_price,
        original_price: sku ? sku.original_price : product.lowest_original_price,
        thumbnail_url: product.thumbnail_url,
        quantity: quantity,
        partner_id: product.partner_id || 'pt_001'
      });
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
        item.quantity = quantity;
        save();
      }
    }
  }

  function clearCart() {
    items.value = [];
    save();
  }

  const totalCount = computed(() => {
    return items.value.reduce((sum, item) => sum + item.quantity, 0);
  });

  const totalGoodsAmount = computed(() => {
    return items.value.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  });

  const shippingFee = computed(() => {
    if (items.value.length === 0) return 0;
    return totalGoodsAmount.value >= 30000 ? 0 : 3000;
  });

  const freeShippingRemaining = computed(() => {
    const remaining = 30000 - totalGoodsAmount.value;
    return remaining > 0 ? remaining : 0;
  });

  const totalPayAmount = computed(() => {
    return totalGoodsAmount.value + shippingFee.value;
  });

  return {
    items,
    addItem,
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
