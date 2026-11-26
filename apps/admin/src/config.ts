// P2-A06: endpoints are required env. Production builds refuse to boot on an
// implicit host; `vite dev` falls back to the local gateway (npm run dev:api).
import { userErrorMessage, requiredEnv } from '@olmoa/ui'
export const API_BASE_URL = requiredEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8787')

// P0-2: the operator session lives in httpOnly cookies (olmoa_at/olmoa_rt),
// which JS cannot read — so NO credential is kept here or in localStorage.
// Identity is memory-only and restored from GET /api/v1/auth/me. Legacy token
// keys from older builds are purged once on load.
const LEGACY_TOKEN_KEYS = ['olmoa_admin_token', 'olmoa_admin_refresh_token', 'admin_token']
try { for (const k of LEGACY_TOKEN_KEYS) localStorage.removeItem(k) } catch { /* private mode */ }

export interface AdminSessionUser { id: string; email: string; name: string }
let sessionUser: AdminSessionUser | null = null
let restoreInflight: Promise<boolean> | null = null

export const getAdminSessionUser = (): AdminSessionUser | null => sessionUser

export function setAdminSession(user: { id: string; email?: string; full_name?: string; name?: string }, role: string) {
  sessionUser = { id: user.id, email: user.email || '', name: user.full_name || user.name || '운영자' }
  setAdminRole(role)
  restoreInflight = Promise.resolve(true)
}

/** Rebuild the memory session from the cookie. False when logged out. */
export async function restoreAdminSession(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/me`)
    const json = await res.json().catch(() => null)
    const u = json?.data?.user
    if (res.ok && json?.success && u && u.id && u.role === 'ROLE_ADMIN') {
      sessionUser = { id: u.id, email: u.email || '', name: u.full_name || u.name || '운영자' }
      setAdminRole(json?.data?.admin?.role || '')
      return true
    }
  } catch { /* logged out: fall through */ }
  sessionUser = null
  return false
}

export function ensureAdminSession(): Promise<boolean> {
  if (sessionUser) return Promise.resolve(true)
  if (!restoreInflight) restoreInflight = restoreAdminSession()
  return restoreInflight
}

/** End the session: best-effort server logout (revokes rotation, clears cookies) + local clear. */
export function clearAdminToken(): void {
  sessionUser = null
  restoreInflight = null
  try { localStorage.removeItem(ROLE_KEY) } catch { /* ignore */ }
  try {
    void fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).catch(() => {})
  } catch { /* local state is already cleared */ }
}

/** Operator identity = server-issued session for a ROLE_ADMIN account. There is no default/fallback credential. */
export const getAdminHeaders = (): Record<string, string> => {
  return { 'Content-Type': 'application/json' }
}

// Display-only: the server enforces the operator role on every request (lib/admin-policy.js).
const ROLE_KEY = 'olmoa_admin_role'
export const getAdminRole = (): string => { try { return localStorage.getItem(ROLE_KEY) || '' } catch { return '' } }
export const setAdminRole = (r: string) => { try { localStorage.setItem(ROLE_KEY, r || '') } catch { /* ignore */ } }
export const ADMIN_ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: '최고관리자', FINANCE: '재무', OPERATIONS: '운영·MD', CS: '고객지원', PRIVACY_OFFICER: '개인정보 보호책임' }

export async function adminApi<T = any>(path: string, init: RequestInit & { json?: any } = {}): Promise<{ ok: boolean; status: number; data: T | any }> {
  // P1-A14: never throws — transport/parse failures return {ok:false} so callers
  // degrade to error states instead of stuck loaders or blank screens.
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { ...getAdminHeaders(), ...(init.headers || {}) },
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok && data.success !== false, status: res.status, data }
  } catch (err: any) {
    return { ok: false, status: 0, data: { success: false, error: userErrorMessage(err, '서버에 연결할 수 없습니다.') } }
  }
}

export const won = (n: number | null | undefined) => `${Number(n || 0).toLocaleString('ko-KR')}원`
