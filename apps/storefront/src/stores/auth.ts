import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface User {
  id: string
  name: string
  email?: string
}

const KEYS = { token: 'olmoa_token', id: 'olmoa_customer_id', name: 'olmoa_customer_name', email: 'olmoa_customer_email' }

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

export const useAuthStore = defineStore('auth', () => {
  // A user is only "logged in" when the server issued a token. No demo identity is ever assumed.
  const token = ref<string | null>(read(KEYS.token))
  const user = ref<User | null>(token.value && read(KEYS.id)
    ? { id: read(KEYS.id) as string, name: read(KEYS.name) || '회원', email: read(KEYS.email) || undefined }
    : null)

  const isAuthenticated = computed(() => !!token.value && !!user.value)

  function login(newUser: User, newToken: string) {
    user.value = newUser
    token.value = newToken
    try {
      localStorage.setItem(KEYS.token, newToken)
      localStorage.setItem(KEYS.id, newUser.id)
      localStorage.setItem(KEYS.name, newUser.name)
      if (newUser.email) localStorage.setItem(KEYS.email, newUser.email)
    } catch { /* storage unavailable: session lives in memory only */ }
  }

  function logout() {
    user.value = null
    token.value = null
    try { Object.values(KEYS).forEach((k) => localStorage.removeItem(k)) } catch { /* ignore */ }
  }

  return { user, token, isAuthenticated, login, logout }
})
