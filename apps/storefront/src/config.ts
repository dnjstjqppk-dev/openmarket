// apps/storefront/src/config.ts
// OLMOA Storefront Central Configuration

export const API_BASE_URL = 'https://olmoa-api.dnjstjqppk.workers.dev';
export const DEFAULT_CUSTOMER_ID = 'u_customer_001';

export function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const customerId = localStorage.getItem('olmoa_customer_id') || DEFAULT_CUSTOMER_ID;
  return {
    'Content-Type': 'application/json',
    'X-Customer-Id': customerId,
    ...extraHeaders
  };
}

