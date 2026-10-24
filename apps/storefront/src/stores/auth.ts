import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface User {
  id: string
  name: string
  email?: string
}

export const useAuthStore = defineStore('auth', () => {
  const storedId = localStorage.getItem('olmoa_customer_id') || 'cust_demo_001'
  const storedName = localStorage.getItem('olmoa_customer_name') || 'Alex Kim'

  const user = ref<User | null>({
    id: storedId,
    name: storedName,
  })

  const isAuthenticated = computed(() => !!user.value)

  function login(newUser: User, token?: string) {
    user.value = newUser
    localStorage.setItem('olmoa_customer_id', newUser.id)
    localStorage.setItem('olmoa_customer_name', newUser.name)
    if (token) localStorage.setItem('olmoa_token', token)
  }

  function logout() {
    user.value = null
    localStorage.removeItem('olmoa_customer_id')
    localStorage.removeItem('olmoa_customer_name')
    localStorage.removeItem('olmoa_token')
  }

  return {
    user,
    isAuthenticated,
    login,
    logout,
  }
})

