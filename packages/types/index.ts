// packages/types/index.ts
// Shared TypeScript Type Definitions for OpenMarket Monorepo

export type UserRole = 'ROLE_CUSTOMER' | 'ROLE_PARTNER' | 'ROLE_ADMIN';

export type PartnerStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export type SubOrderStatus = 
  | 'PAYMENT_PENDING'
  | 'PAID'
  | 'PREPARING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'PURCHASE_CONFIRMED'
  | 'CANCELLED'
  | 'RETURN_REQUESTED'
  | 'REFUNDED';

export type LedgerAccountType = 
  | 'PG_RECEIVABLE'
  | 'PLATFORM_ESCROW'
  | 'PLATFORM_REVENUE'
  | 'PARTNER_PAYABLE'
  | 'PARTNER_PAID';

export interface Category {
  id: string;
  parentId?: string;
  name: string;
  slug: string;
  depth: number;
  sortOrder: number;
  isActive: boolean;
}

export interface ProductSKU {
  id: string;
  productId: string;
  skuCode: string;
  optionCombination: Record<string, string>;
  originalPrice: number; // BIGINT (KRW)
  salePrice: number;     // BIGINT (KRW)
  stockQuantity: number;
  status: 'ACTIVE' | 'OUT_OF_STOCK' | 'HIDDEN';
}

export interface CartItem {
  partnerId: string;
  productId: string;
  skuId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

export interface SplitOrderCheckoutRequest {
  buyerUserId: string;
  idempotencyKey: string;
  paymentMethod: string;
  items: CartItem[];
  recipientName: string;
  recipientPhone: string;
  shippingAddress: string;
}

