// P2-A06: endpoints are required env. Production builds refuse to boot on an
// implicit host; `vite dev` falls back to the local gateway / storefront.
import { requiredEnv } from '@olmoa/ui'
export const API_BASE_URL = requiredEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8787')
// P1-T08: storefront preview base (product deep links), never hardcoded.
export const STOREFRONT_URL = requiredEnv('VITE_STOREFRONT_URL', 'http://localhost:5173')
export const API_BASE = API_BASE_URL

// P0-2: the seller session lives in httpOnly cookies (olmoa_at/olmoa_rt),
// which JS cannot read — so NO credential is kept here or in localStorage.
// Identity is memory-only and restored from GET /api/v1/auth/session. The stored
// id/name/status hints are display-only (the API enforces approval per call).
// Legacy token keys from older builds are purged once on load.
const KEYS = { id: 'partner_id', name: 'partner_name', model: 'partner_sales_model', status: 'partner_status' }
const LEGACY_TOKEN_KEYS = ['partner_token', 'partner_refresh_token', 'olmoa_partner_token']
try { for (const k of LEGACY_TOKEN_KEYS) localStorage.removeItem(k) } catch { /* private mode */ }

function read(k: string): string | null {
  try { return localStorage.getItem(k) } catch { return null }
}

export interface PartnerSessionUser { id: string; email: string; name: string }
let sessionUser: PartnerSessionUser | null = null
let restoreInflight: Promise<boolean> | null = null

export const getPartnerSessionUser = (): PartnerSessionUser | null => sessionUser

/** Rebuild the memory session from the cookie. False when logged out. */
export async function restorePartnerSession(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/session`)
    const json = await res.json().catch(() => null)
    const u = json?.data?.user
    if (res.ok && json?.success && u && u.id && u.role === 'ROLE_PARTNER') {
      sessionUser = { id: u.id, email: u.email || '', name: u.full_name || u.name || '판매자' }
      return true
    }
  } catch { /* logged out: fall through */ }
  sessionUser = null
  return false
}

export function ensurePartnerSession(): Promise<boolean> {
  if (sessionUser) return Promise.resolve(true)
  if (!restoreInflight) restoreInflight = restorePartnerSession()
  return restoreInflight
}

/** End the session: best-effort server logout (revokes rotation, clears cookies) + local clear. */
export function clearPartnerSession() {
  sessionUser = null
  restoreInflight = null
  for (const k of [...Object.values(KEYS), 'olmoa_partner_id', 'olmoa_partner_name', ...LEGACY_TOKEN_KEYS]) {
    try { localStorage.removeItem(k) } catch { /* ignore */ }
  }
  try {
    void fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).catch(() => {})
  } catch { /* local state is already cleared */ }
}

/** Auth-only headers for FormData uploads (the browser sets the multipart boundary). */
export const getPartnerAuthHeaders = (): Record<string, string> => {
  return {}
}

/** Seller identity is the session; the partner id is display-only and never sent as a credential. */
export const getPartnerId = (): string => read(KEYS.id) || ''
export const getPartnerName = (): string => read(KEYS.name) || ''
/** UI routing hint only (the API enforces approval on every call). */
export const getPartnerStatus = (): string => read(KEYS.status) || ''
export const setPartnerStatus = (s: string) => { try { localStorage.setItem(KEYS.status, s) } catch { /* ignore */ } }

export const getPartnerHeaders = (): Record<string, string> => {
  return { 'Content-Type': 'application/json' }
}

export function savePartnerSession(user: { id: string; email?: string; full_name?: string; name?: string } | null, partner: { id: string; business_name: string; sales_model?: string; status?: string }) {
  // Login passes the user profile; the application submit has none, so the
  // next ensurePartnerSession() restores it from /me instead.
  if (user) {
    sessionUser = { id: user.id, email: user.email || '', name: user.full_name || user.name || '판매자' }
    restoreInflight = Promise.resolve(true)
  } else {
    sessionUser = null
    restoreInflight = null
  }
  localStorage.setItem(KEYS.id, partner.id)
  localStorage.setItem(KEYS.name, partner.business_name)
  if (partner.sales_model) localStorage.setItem(KEYS.model, partner.sales_model)
  if (partner.status) localStorage.setItem(KEYS.status, partner.status)
}

