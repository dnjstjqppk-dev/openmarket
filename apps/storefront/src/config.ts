// apps/storefront/src/config.ts
// Central configuration and session helpers. Identity is the server-issued JWT only.

// P2-A06: endpoints are required env. Production builds refuse to boot on an
// implicit host; `vite dev` falls back to the local gateway / consoles.
function requiredEnv(name: string, devFallback: string): string {
  const env = (import.meta as any).env || {}
  if (env[name]) return env[name]
  if (env.DEV === true) return devFallback
  throw new Error(`[config] ${name} is not set — refusing to boot with an implicit endpoint`)
}
export const API_BASE_URL = requiredEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8787');
export const PARTNER_PORTAL_URL = requiredEnv('VITE_PARTNER_URL', 'http://localhost:5175');
export const PARTNER_CONSOLE_URL = PARTNER_PORTAL_URL;
export const ADMIN_CONSOLE_URL = requiredEnv('VITE_ADMIN_URL', 'http://localhost:5174');

const TOKEN_KEY = 'olmoa_token';

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function authHeader(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  return { 'Content-Type': 'application/json', ...authHeader(), ...extraHeaders };
}

export function newIdempotencyKey(prefix = 'chk'): string {
  const rnd = (globalThis.crypto && 'randomUUID' in globalThis.crypto) ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rnd}`;
}

export function sanitizeHtml(dirtyHtml: string): string {
  if (!dirtyHtml) return '';
  return dirtyHtml
    .replace(/<(script|iframe|object|embed|form|meta|link|style)\b[^>]*>([\s\S]*?)<\/\1>/gim, '')
    .replace(/<(script|iframe|object|embed|meta|link)\b[^>]*\/?>/gim, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gim, '')
    .replace(/javascript\s*:/gim, 'blocked:');
}
