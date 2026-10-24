export const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'https://olmoa-api.dnjstjqppk.workers.dev'

export const getAdminHeaders = (): Record<string, string> => {
  let token = 'olmoa_admin_2026'
  try {
    token = localStorage.getItem('olmoa_admin_token') || 'olmoa_admin_2026'
  } catch {}
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  }
}
