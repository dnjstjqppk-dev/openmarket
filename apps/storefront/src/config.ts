// apps/storefront/src/config.ts
// Central configuration and session helpers. Identity is the server-issued JWT only.

import { requiredEnv } from '@olmoa/ui'
export const API_BASE_URL = requiredEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8787');
export const PARTNER_PORTAL_URL = requiredEnv('VITE_PARTNER_URL', 'http://localhost:5175');
export const PARTNER_CONSOLE_URL = PARTNER_PORTAL_URL;
export const ADMIN_CONSOLE_URL = requiredEnv('VITE_ADMIN_URL', 'http://localhost:5174');

// P0-2: web sessions authenticate via httpOnly cookies (attached by the fetch
// wrapper in main.ts). Tokens are never exposed to JS, so these helpers carry
// no Authorization header; they stay so existing call sites keep working.
export function getToken(): string | null {
  return null;
}

export function authHeader(): Record<string, string> {
  return {};
}

export function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', ...extraHeaders };
}

export function newIdempotencyKey(prefix = 'chk'): string {
  const rnd = (globalThis.crypto && 'randomUUID' in globalThis.crypto) ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rnd}`;
}


