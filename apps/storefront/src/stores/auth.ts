import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface User {
  id: string
  name: string
  email?: string
  locale?: string
}

// P0-2: the session lives in httpOnly cookies (olmoa_at/olmoa_rt), which JS
// cannot read — so NO credential is kept here or in localStorage. The user
// profile is memory-only and restored from GET /api/v1/auth/me. Legacy token
// keys from older builds are purged once on load.
const LEGACY_KEYS = ['olmoa_token', 'olmoa_refresh_token', 'olmoa_customer_id', 'olmoa_customer_name', 'olmoa_customer_email']
try { for (const k of LEGACY_KEYS) localStorage.removeItem(k) } catch { /* private mode */ }

export const useAuthStore = defineStore('auth', () => {
  // A user is only "logged in" when the server issued a session. No demo identity is ever assumed.
  const user = ref<User | null>(null)

  const isAuthenticated = computed(() => !!user.value)

  // Cached restore: resolved on login, cleared on logout, retried per boot.
  let restoreInflight: Promise<boolean> | null = null

  function login(newUser: User) {
    user.value = newUser
    restoreInflight = Promise.resolve(true)
  }

  /**
   * Rebuild the memory profile from the cookie session. False when logged out.
   * One browser profile holds one API session, so a seller/admin session left
   * over from another console must NOT authenticate this storefront: the role
   * check turns cross-console clobbering into a clean logged-out state
   * (re-login) instead of calls made under the wrong identity.
   */
  async function restore(): Promise<boolean> {
    try {
      const { API_BASE_URL } = await import('../config')
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/me`)
      const json = await res.json().catch(() => null)
      const u = json?.data?.user
      if (res.ok && json?.success && u && u.id && u.role === 'ROLE_CUSTOMER') {
        user.value = { id: u.id, name: u.full_name || u.name || '회원', email: u.email || undefined, locale: u.locale || undefined }
        return true
      }
    } catch { /* logged out: fall through */ }
    user.value = null
    return false
  }

  function ensureSession(): Promise<boolean> {
    if (user.value) return Promise.resolve(true)
    if (!restoreInflight) restoreInflight = restore()
    return restoreInflight
  }

  function logout() {
    user.value = null
    restoreInflight = null
    // Best-effort server logout: revokes the rotation chain and clears cookies.
    try {
      void import('../config').then(({ API_BASE_URL }) =>
        fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        }).catch(() => {})
      ).catch(() => {})
    } catch { /* local state is already cleared */ }
  }

  let profileInflight: Promise<void> | null = null
  /** 6-2: load the server profile once per session (saved locale for the nudge). */
  function ensureProfile(): Promise<void> {
    if (!user.value || user.value.locale) return Promise.resolve()
    if (profileInflight) return profileInflight
    profileInflight = (async () => {
      try {
        const { API_BASE_URL } = await import('../config')
        const res = await fetch(`${API_BASE_URL}/api/v1/auth/me`)
        const json = await res.json().catch(() => null)
        const u = json?.data?.user
        if (res.ok && json?.success && u && user.value) {
          user.value = { ...user.value, name: u.full_name || u.name || user.value.name, email: u.email || user.value.email, locale: u.locale || undefined }
        }
      } catch { /* profile stays local-only */ }
      finally { profileInflight = null }
    })()
    return profileInflight
  }

  /** 6-2: persist an explicit language choice to the server profile. */
  async function saveLocale(v: string): Promise<void> {
    if (!user.value) return;
    try {
      const { API_BASE_URL } = await import('../config');
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: v })
      });
      if (res.ok && user.value) user.value = { ...user.value, locale: v };
    } catch { /* explicit device choice stands even if the save fails */ }
  }

  return { user, isAuthenticated, login, logout, ensureSession, restore, ensureProfile, saveLocale }
})
