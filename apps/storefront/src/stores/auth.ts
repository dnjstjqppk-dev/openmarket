import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface User {
  id: string
  name: string
  email?: string
}

const KEYS = { token: 'olmoa_token', refresh: 'olmoa_refresh_token', id: 'olmoa_customer_id', name: 'olmoa_customer_name', email: 'olmoa_customer_email' }

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

export const useAuthStore = defineStore('auth', () => {
  // A user is only "logged in" when the server issued a token. No demo identity is ever assumed.
  const token = ref<string | null>(read(KEYS.token))
  // P2-SEC-07: single-use refresh token. It is sent ONLY to POST /api/v1/auth/refresh (see main.ts).
  const refreshToken = ref<string | null>(read(KEYS.refresh))
  const user = ref<User | null>(token.value && read(KEYS.id)
    ? { id: read(KEYS.id) as string, name: read(KEYS.name) || '회원', email: read(KEYS.email) || undefined }
    : null)

  const isAuthenticated = computed(() => !!token.value && !!user.value)

  function login(newUser: User, newToken: string, newRefreshToken?: string) {
    user.value = newUser
    token.value = newToken
    try {
      localStorage.setItem(KEYS.token, newToken)
      localStorage.setItem(KEYS.id, newUser.id)
      localStorage.setItem(KEYS.name, newUser.name)
      if (newUser.email) localStorage.setItem(KEYS.email, newUser.email)
      if (newRefreshToken) {
        refreshToken.value = newRefreshToken
        localStorage.setItem(KEYS.refresh, newRefreshToken)
      } else {
        refreshToken.value = null
        localStorage.removeItem(KEYS.refresh)
      }
    } catch { /* storage unavailable: session lives in memory only */ }
  }

  /** Swap in a rotated pair after a successful /auth/refresh. */
  function applyRefresh(newToken: string, newRefreshToken: string) {
    token.value = newToken
    refreshToken.value = newRefreshToken
    try {
      localStorage.setItem(KEYS.token, newToken)
      localStorage.setItem(KEYS.refresh, newRefreshToken)
    } catch { /* ignore */ }
  }

  function logout() {
    user.value = null
    token.value = null
    refreshToken.value = null
    try { Object.values(KEYS).forEach((k) => localStorage.removeItem(k)) } catch { /* ignore */ }
  }

  return { user, token, refreshToken, isAuthenticated, login, applyRefresh, logout }
})
