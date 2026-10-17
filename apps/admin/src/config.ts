// apps/admin/src/config.ts
// OLMOA Admin Console Configuration

export const API_BASE_URL = 'https://olmoa-api.dnjstjqppk.workers.dev';

export function getAdminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const secret = localStorage.getItem('admin_token') || 'olmoa_admin_sec_2026';
  return {
    'Content-Type': 'application/json',
    'X-Admin-Secret': secret,
    ...extra
  };
}
