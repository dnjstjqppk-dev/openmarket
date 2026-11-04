export const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'https://olmoa-api.dnjstjqppk.workers.dev'

const TOKEN_KEY = 'olmoa_admin_token'

export const getAdminToken = (): string | null => {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

/** Operator identity = server-issued JWT for a ROLE_ADMIN account. There is no default/fallback credential. */
export const getAdminHeaders = (): Record<string, string> => {
  const token = getAdminToken()
  return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

export const setAdminToken = (t: string) => localStorage.setItem(TOKEN_KEY, t)
export const clearAdminToken = () => { try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem('admin_token') } catch { /* ignore */ } }

export async function adminApi<T = any>(path: string, init: RequestInit & { json?: any } = {}): Promise<{ ok: boolean; status: number; data: T | any }> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...getAdminHeaders(), ...(init.headers || {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok && data.success !== false, status: res.status, data }
}

export const won = (n: number | null | undefined) => `${Number(n || 0).toLocaleString('ko-KR')}원`
