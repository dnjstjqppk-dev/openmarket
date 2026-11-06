// apps/storefront/src/stores/catalog.ts
// Category tree, loaded once per page session and shared by the shell, home, category list and category pages.
// Before this store the shell and each view fetched /api/v1/categories separately (2 requests per page load);
// that endpoint was the largest D1 row-read source (see migrations/d1_33_catalog_read_indexes.sql).
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { API_BASE_URL } from '../config'

export interface Category {
  id: string
  parent_id: string | null
  name: string
  slug: string
  depth: number
  sort_order: number
  product_count: number
}

export const useCatalogStore = defineStore('catalog', () => {
  const categories = ref<Category[]>([])
  const loaded = ref(false)
  const error = ref<string | null>(null)
  let inflight: Promise<void> | null = null

  const roots = computed(() => categories.value.filter((c) => Number(c.depth) === 0))
  const childrenOf = (id: string) => categories.value.filter((c) => c.parent_id === id)
  const bySlugOrId = (key: string) => categories.value.find((c) => c.slug === key || c.id === key) || null

  /** Loads the tree once; concurrent callers share one request. `force` re-fetches (retry after an error). */
  function load(force = false): Promise<void> {
    if (loaded.value && !force) return Promise.resolve()
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/categories`)
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.success || !Array.isArray(json.data)) throw new Error(json?.error || `카테고리를 불러오지 못했습니다 (${res.status})`)
        categories.value = json.data
        loaded.value = true
        error.value = null
      } catch (e: any) {
        error.value = e?.message || '카테고리를 불러오지 못했습니다'
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  return { categories, loaded, error, roots, childrenOf, bySlugOrId, load }
})
