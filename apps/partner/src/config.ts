export const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'https://olmoa-api.dnjstjqppk.workers.dev'
export const API_BASE = API_BASE_URL

export const getPartnerId = (): string => {
  try {
    return localStorage.getItem('olmoa_partner_id') || localStorage.getItem('partner_id') || 'pt_001'
  } catch {
    return 'pt_001'
  }
}

export const getPartnerHeaders = (): Record<string, string> => {
  const pid = getPartnerId()
  const token = localStorage.getItem('partner_token') || localStorage.getItem('olmoa_partner_token') || pid
  return {
    'Content-Type': 'application/json',
    'X-Partner-Id': pid,
    'Authorization': `Bearer ${token}`
  }
}
