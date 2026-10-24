// apps/storefront/src/config.ts
// OLMOA Storefront Central Configuration, Auth Headers & Security Utilities

export const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'https://olmoa-api.dnjstjqppk.workers.dev';
export const PARTNER_PORTAL_URL = (import.meta as any).env?.VITE_PARTNER_URL || 'https://olmoa-partner.dnjstjqppk.workers.dev';
export const PARTNER_CONSOLE_URL = PARTNER_PORTAL_URL;
export const ADMIN_CONSOLE_URL = (import.meta as any).env?.VITE_ADMIN_URL || 'https://olmoa-admin.dnjstjqppk.workers.dev';
export const DEFAULT_CUSTOMER_ID = 'u_customer_001';

export function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  let customerId = DEFAULT_CUSTOMER_ID;
  try {
    customerId = localStorage.getItem('olmoa_customer_id') || DEFAULT_CUSTOMER_ID;
  } catch (_) {}
  return {
    'Content-Type': 'application/json',
    'X-Customer-Id': customerId,
    ...extraHeaders
  };
}

export function sanitizeHtml(dirtyHtml: string): string {
  if (!dirtyHtml) return '';
  return dirtyHtml
    .replace(/<(script|iframe|object|embed|form|meta|link|style)\b[^>]*>([\s\S]*?)<\/\1>/gim, '')
    .replace(/<(script|iframe|object|embed|meta|link)\b[^>]*\/?>/gim, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gim, '')
    .replace(/javascript\s*:/gim, 'blocked:');
}
