// Stale-chunk recovery after a deploy.
//
// Every push to main redeploys the consoles and the storefront, and the new
// dist replaces the old hashed chunks. A tab opened before the deploy then
// requests a chunk that no longer exists; the asset layer answers with the SPA
// index.html, the dynamic import fails, and the navigation dies silently.
// The fix is the one Vite documents: reload once onto the target URL so the
// tab picks up the new index.html. A session-scoped timestamp stops a reload
// loop when the chunk is genuinely broken (not just stale).

const STORAGE_KEY = 'olmoa_chunk_reload_at'
const LOOP_WINDOW_MS = 10_000

const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|is not a valid JavaScript MIME type|Expected a JavaScript(-or-Wasm)? module script|ChunkLoadError/i

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false
  const e = err as { message?: unknown; name?: unknown }
  const text = `${String(e.name ?? '')} ${String(e.message ?? err)}`
  return CHUNK_ERROR_RE.test(text)
}

export interface ReloadStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * true = reload now (and the attempt is recorded); false = a reload already
 * happened inside the loop window, or storage is unusable (fail safe: never
 * risk an endless reload loop).
 */
export function shouldReloadForChunk(store: ReloadStore | null, now: number): boolean {
  if (!store) return false
  try {
    const last = Number(store.getItem(STORAGE_KEY) || 0)
    if (Number.isFinite(last) && now - last >= 0 && now - last < LOOP_WINDOW_MS) return false
    store.setItem(STORAGE_KEY, String(now))
    return true
  } catch {
    return false
  }
}

interface RouterLike {
  onError(handler: (error: unknown, to?: { fullPath?: string }) => void): unknown
}

function sessionStore(): ReloadStore | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** Installs the guard on `window` (Vite preload failures) and on the router (lazy route chunks). */
export function installChunkReloadGuard(router: RouterLike): void {
  if (typeof window === 'undefined') return
  window.addEventListener('vite:preloadError', (event) => {
    if (shouldReloadForChunk(sessionStore(), Date.now())) {
      event.preventDefault()
      window.location.reload()
    }
  })
  router.onError((error, to) => {
    if (!isChunkLoadError(error)) return
    if (!shouldReloadForChunk(sessionStore(), Date.now())) return
    const target = to && typeof to.fullPath === 'string' && to.fullPath.startsWith('/') && !to.fullPath.startsWith('//') ? to.fullPath : null
    if (target) window.location.assign(target)
    else window.location.reload()
  })
}
