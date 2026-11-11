// P2-A06: endpoints are required env. Production builds refuse to boot on an
// implicit host; `vite dev` falls back to the local gateway (npm run dev:api).
function requiredEnv(name: string, devFallback: string): string {
  const env = (import.meta as any).env || {}
  if (env[name]) return env[name]
  if (env.DEV === true) return devFallback
  throw new Error(`[config] ${name} is not set — refusing to boot with an implicit endpoint`)
}
export const API_BASE_URL = requiredEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8787')

const TOKEN_KEY = 'olmoa_admin_token'
// P2-SEC-07: single-use refresh token, sent ONLY to POST /api/v1/auth/refresh.
const REFRESH_KEY = 'olmoa_admin_refresh_token'

export const getAdminToken = (): string | null => {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

export const getAdminRefreshToken = (): string | null => {
  try { return localStorage.getItem(REFRESH_KEY) } catch { return null }
}

/** Operator identity = server-issued JWT for a ROLE_ADMIN account. There is no default/fallback credential. */
export const getAdminHeaders = (): Record<string, string> => {
  const token = getAdminToken()
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

export const setAdminToken = (t: string) => localStorage.setItem(TOKEN_KEY, t)
export const setAdminRefreshToken = (t: string) => { try { localStorage.setItem(REFRESH_KEY, t) } catch { /* ignore */ } }
export const clearAdminToken = () => { try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REFRESH_KEY); localStorage.removeItem('admin_token'); localStorage.removeItem(ROLE_KEY) } catch { /* ignore */ } }

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
    return { ok: false, status: 0, data: { success: false, error: err?.message || '서버에 연결할 수 없습니다.' } }
  }
}

export const won = (n: number | null | undefined) => `${Number(n || 0).toLocaleString('ko-KR')}원`
