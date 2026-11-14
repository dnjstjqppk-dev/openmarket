// apps/storefront/src/stores/wishlist.ts
// Wishlist id set, loaded once per session and shared by every grid so heart
// states stay consistent. Server POST toggles; the response is the truth.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { API_BASE_URL } from '../config'
import { useAuthStore } from './auth'

export const useWishlistStore = defineStore('wishlist', () => {
  const ids = ref<Set<string>>(new Set())
  const loaded = ref(false)
  let inflight: Promise<void> | null = null

  function load(): Promise<void> {
    const auth = useAuthStore()
    if (!auth.isAuthenticated || loaded.value) return Promise.resolve()
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/wishlist`, {
          headers: { Authorization: `Bearer ${auth.token}` }
        })
        const json = await res.json().catch(() => null)
        if (res.ok && json?.success && Array.isArray(json.data)) {
          ids.value = new Set(json.data.map((r: any) => r.product_id || r.id).filter(Boolean))
          loaded.value = true
        }
      } catch {
        // Hearts stay unfilled until a toggle succeeds; never fabricated.
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  /** Toggles server-side; returns the new state, or null on failure. */
  async function toggle(productId: string): Promise<boolean | null> {
    const auth = useAuthStore()
    if (!auth.isAuthenticated) return null
    const res = await fetch(`${API_BASE_URL}/api/v1/wishlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ product_id: productId })
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) return null
    const next = new Set(ids.value)
    if (json.wished) next.add(productId)
    else next.delete(productId)
    ids.value = next
    loaded.value = true
    return !!json.wished
  }

  function reset() {
    ids.value = new Set()
    loaded.value = false
  }

  return { ids, loaded, load, toggle, reset }
})
