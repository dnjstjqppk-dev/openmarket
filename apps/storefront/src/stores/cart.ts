// apps/storefront/src/stores/cart.ts
// Buyer cart (browser-local). Lines are real SKUs; the server re-prices and re-checks stock at quote/checkout.
// P2R-05 resolved 2026-11-07: no server cart before launch (single storefront, no cross-device
// demand yet); revisit device sync post-launch. Do not build cart_items until then.
//  - selection: every line is selected by default; only selected lines go to checkout ("선택 상품 주문").
//    The unselected set is persisted so a reload keeps the buyer's choice.
//  - after payment only the lines that were in that order are removed (markPending / completeCheckout),
//    not the whole cart.
//  - applyServerPrices: when the server quote reports a different sale price than the one saved when the line
//    was added, the saved price is updated so the cart's estimate matches what checkout will charge.

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
const UNSELECTED_KEY = 'olmoa_cart_unselected_v1';
const PENDING_KEY = 'olmoa_cart_pending_checkout_v1';
const UNKNOWN_SELLER = '__unknown_seller__';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (_) {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

function optionSummary(sku: any): string {
  try {
    const opt = typeof sku.option_combination_json === 'string' ? JSON.parse(sku.option_combination_json) : (sku.options || {});
    return Object.entries(opt).map(([k, v]) => `${k}: ${v}`).join(' / ') || '기본';
  } catch (_) {
    return '기본';
  }
}

/** Groups lines by seller exactly like the server splits sub-orders (services/orders.js). */
function groupBySeller(list: CartItem[]): PartnerCartGroup[] {
  const map = new Map<string, CartItem[]>();
  for (const it of list) {
    const pid = it.partner_id || UNKNOWN_SELLER;
    if (!map.has(pid)) map.set(pid, []);
    map.get(pid)!.push(it);
  }
  return [...map.entries()].map(([pid, groupItems]) => {
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
}

export const useCartStore = defineStore('cart', () => {
  const items = ref<CartItem[]>(readJson<CartItem[]>(STORAGE_KEY, readJson<CartItem[]>('olmoa_cart_items_v2', [])));
  const unselected = ref<Set<string>>(new Set(readJson<string[]>(UNSELECTED_KEY, [])));

  function save() {
    writeJson(STORAGE_KEY, items.value);
    // Forget selection state of lines that no longer exist.
    const live = new Set(items.value.map((i) => i.sku_id));
    unselected.value = new Set([...unselected.value].filter((id) => live.has(id)));
    writeJson(UNSELECTED_KEY, [...unselected.value]);
  }

  /** Adds a real SKU (never an invented one). Returns false when nothing was added (no SKU / out of stock). */
  function addItem(product: any, sku?: any, quantity: number = 1): boolean {
    // No SKU, no cart line: the old fallback invented `sku_<product>` with stock 100, which checkout rejects.
    if (!sku || !sku.id) {
      if (product?.skus && product.skus.length === 1) sku = product.skus[0];
      else return false;
    }
    if (!product.partner_id) return false;

    // Unknown stock is not capped here; checkout re-checks stock on the server (STOCK_INSUFFICIENT).
    const maxStock = sku.stock_quantity != null ? Number(sku.stock_quantity) : Number.MAX_SAFE_INTEGER;
    if (maxStock <= 0) return false;

    const existing = items.value.find((i) => i.sku_id === sku.id);
    if (existing) {
      existing.quantity = Math.min(existing.quantity + quantity, maxStock);
      existing.price = Number(sku.sale_price ?? existing.price);
      existing.stock_quantity = sku.stock_quantity != null ? Number(sku.stock_quantity) : existing.stock_quantity;
    } else {
      items.value.push({
        sku_id: sku.id,
        product_id: product.id,
        title: product.title,
        option_summary: optionSummary(sku),
        price: Number(sku.sale_price ?? product.lowest_sale_price),
        original_price: Number(sku.original_price ?? product.lowest_original_price ?? 0),
        thumbnail_url: product.thumbnail_url,
        quantity: Math.min(quantity, maxStock),
        stock_quantity: sku.stock_quantity != null ? Number(sku.stock_quantity) : undefined,
        partner_id: product.partner_id,
        business_name: product.business_name || product.partner_name || '',
        base_shipping_fee: product.base_shipping_fee ?? undefined,
        free_shipping_threshold: product.free_shipping_threshold ?? undefined
      });
    }
    const s = new Set(unselected.value); s.delete(sku.id); unselected.value = s;
    save();
    return true;
  }

  function removeItem(skuId: string) {
    items.value = items.value.filter((i) => i.sku_id !== skuId);
    save();
  }

  function removeMany(skuIds: string[]) {
    const drop = new Set(skuIds);
    items.value = items.value.filter((i) => !drop.has(i.sku_id));
    save();
  }

  function updateQuantity(skuId: string, quantity: number) {
    const item = items.value.find((i) => i.sku_id === skuId);
    if (!item) return;
    if (quantity <= 0) { removeItem(skuId); return; }
    const ceiling = item.stock_quantity != null ? item.stock_quantity : Number.MAX_SAFE_INTEGER;
    item.quantity = Math.max(1, Math.min(Math.floor(quantity), ceiling));
    save();
  }

  function clearCart() {
    items.value = [];
    save();
  }

  // ---- selection --------------------------------------------------------------------------------------
  const isSelected = (skuId: string) => !unselected.value.has(skuId);
  function setSelected(skuId: string, on: boolean) {
    const s = new Set(unselected.value);
    if (on) s.delete(skuId); else s.add(skuId);
    unselected.value = s;
    save();
  }
  function selectAll(on: boolean) {
    unselected.value = on ? new Set() : new Set(items.value.map((i) => i.sku_id));
    save();
  }
  /** "바로 구매": only this line goes to checkout; the rest of the cart stays as it was, unselected. */
  function selectOnly(skuIds: string[]) {
    const keep = new Set(skuIds);
    unselected.value = new Set(items.value.map((i) => i.sku_id).filter((id) => !keep.has(id)));
    save();
  }
  const selectedItems = computed(() => items.value.filter((i) => !unselected.value.has(i.sku_id)));
  const allSelected = computed(() => items.value.length > 0 && selectedItems.value.length === items.value.length);

  // ---- checkout bookkeeping ---------------------------------------------------------------------------
  /** Remembers which lines an order was created from, so only those leave the cart once it is paid. */
  function markPending(orderNo: string, skuIds: string[]) {
    writeJson(PENDING_KEY, { order_no: orderNo, sku_ids: skuIds });
  }
  /** Called when an order is paid. Unknown order -> nothing is removed (never guess which lines were bought). */
  function completeCheckout(orderNo: string): number {
    const p = readJson<{ order_no: string; sku_ids: string[] } | null>(PENDING_KEY, null);
    if (!p || p.order_no !== orderNo) return 0;
    const before = items.value.length;
    removeMany(p.sku_ids);
    writeJson(PENDING_KEY, null);
    return before - items.value.length;
  }

  /** Updates saved sale prices from a server quote ({ sku_id: base unit price }). Returns the changed lines. */
  function applyServerPrices(prices: Record<string, number>): CartItem[] {
    const changed: CartItem[] = [];
    for (const it of items.value) {
      const p = prices[it.sku_id];
      if (p != null && Number.isFinite(Number(p)) && Number(p) !== it.price) {
        it.price = Number(p);
        changed.push(it);
      }
    }
    if (changed.length) save();
    return changed;
  }

  // ---- totals (selected lines only: this is what checkout will order) --------------------------------
  const partnerGroups = computed(() => groupBySeller(items.value));
  const selectedGroups = computed(() => groupBySeller(selectedItems.value));
  const totalCount = computed(() => items.value.reduce((sum, item) => sum + item.quantity, 0));
  const selectedCount = computed(() => selectedItems.value.reduce((sum, item) => sum + item.quantity, 0));
  /** Selected goods before quantity tiers. */
  const listGoodsAmount = computed(() => selectedItems.value.reduce((sum, it) => sum + it.price * it.quantity, 0));
  /** Selected goods after quantity tiers (what the server charges before coupons/credit). */
  const totalGoodsAmount = computed(() => selectedGroups.value.reduce((sum, g) => sum + g.goods_amount, 0));
  /** Saving from quantity tiers only. */
  const volumeSavings = computed(() => listGoodsAmount.value - totalGoodsAmount.value);
  const shippingFee = computed(() => selectedGroups.value.reduce((sum, g) => sum + g.shipping_fee, 0));
  const totalPayAmount = computed(() => totalGoodsAmount.value + shippingFee.value);

  return {
    items,
    selectedItems,
    allSelected,
    partnerGroups,
    selectedGroups,
    addItem,
    removeItem,
    removeMany,
    updateQuantity,
    clearCart,
    isSelected,
    setSelected,
    selectAll,
    selectOnly,
    markPending,
    completeCheckout,
    applyServerPrices,
    totalCount,
    selectedCount,
    listGoodsAmount,
    totalGoodsAmount,
    volumeSavings,
    shippingFee,
    totalPayAmount
  };
});
