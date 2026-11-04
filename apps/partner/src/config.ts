export const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'https://olmoa-api.dnjstjqppk.workers.dev'
export const API_BASE = API_BASE_URL

const KEYS = { token: 'partner_token', id: 'partner_id', name: 'partner_name', model: 'partner_sales_model' }

function read(k: string): string | null {
  try { return localStorage.getItem(k) } catch { return null }
}

/** Seller identity is the JWT; the partner id is display-only and never sent as a credential. */
export const getPartnerId = (): string => read(KEYS.id) || ''
export const getPartnerName = (): string => read(KEYS.name) || ''
export const getPartnerToken = (): string | null => read(KEYS.token)

export const getPartnerHeaders = (): Record<string, string> => {
  const token = getPartnerToken()
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

export function savePartnerSession(token: string, partner: { id: string; business_name: string; sales_model?: string }) {
  localStorage.setItem(KEYS.token, token)
  localStorage.setItem(KEYS.id, partner.id)
  localStorage.setItem(KEYS.name, partner.business_name)
  if (partner.sales_model) localStorage.setItem(KEYS.model, partner.sales_model)
}

export function clearPartnerSession() {
  for (const k of [...Object.values(KEYS), 'olmoa_partner_token', 'olmoa_partner_id', 'olmoa_partner_name']) {
    try { localStorage.removeItem(k) } catch { /* ignore */ }
  }
}
