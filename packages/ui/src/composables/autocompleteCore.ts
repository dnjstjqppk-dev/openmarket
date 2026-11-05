// Framework-free autocomplete controller (unit-tested in tests/ui/autocomplete_core.test.mjs).
// Guarantees:
//   * no request while a Korean IME composition is in progress (compositionstart … compositionend);
//   * debounce; queries shorter than `minChars` never hit the network;
//   * every new request aborts the previous one (AbortController) and a late response can never
//     overwrite a newer one (sequence check);
//   * identical consecutive queries are not re-sent; results are cached per normalised query;
//   * errors are surfaced (state.error) — never turned into an empty "no results" success.

export interface AcItem { id: string; type: string; label: string; sub?: string; image?: string | null; to?: string; meta?: Record<string, unknown> }
export interface AcGroup { key: string; label: string; items: AcItem[] }
export type AcFetcher = (query: string, signal: AbortSignal) => Promise<AcGroup[]>

export interface AcState { query: string; loading: boolean; error: string | null; groups: AcGroup[]; settledQuery: string }

export function normalizeQuery(q: string): string {
  return String(q || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function createAutocomplete(opts: {
  fetcher: AcFetcher
  onChange: (s: AcState) => void
  debounceMs?: number
  minChars?: number
  cacheSize?: number
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void }
}) {
  const debounceMs = opts.debounceMs ?? 200
  const minChars = opts.minChars ?? 1
  const cacheSize = opts.cacheSize ?? 30
  const timers = opts.timers ?? { set: (fn: () => void, ms: number) => setTimeout(fn, ms), clear: (h: unknown) => clearTimeout(h as any) }
  const cache = new Map<string, AcGroup[]>()
  const state: AcState = { query: '', loading: false, error: null, groups: [], settledQuery: '' }
  let composing = false
  let timer: unknown = null
  let seq = 0
  let controller: AbortController | null = null
  let lastSent = ''
  const emit = () => opts.onChange({ ...state, groups: state.groups })

  async function run(norm: string) {
    if (norm === lastSent && !state.error) return
    lastSent = norm
    const hit = cache.get(norm)
    if (hit) { Object.assign(state, { groups: hit, loading: false, error: null, settledQuery: norm }); emit(); return }
    controller?.abort()
    controller = new AbortController()
    const mine = ++seq
    state.loading = true; state.error = null; emit()
    try {
      const groups = await opts.fetcher(norm, controller.signal)
      if (mine !== seq) return // a newer request was issued meanwhile
      cache.set(norm, groups)
      if (cache.size > cacheSize) cache.delete(cache.keys().next().value as string)
      Object.assign(state, { groups, loading: false, error: null, settledQuery: norm }); emit()
    } catch (e: any) {
      if (mine !== seq || e?.name === 'AbortError') return
      Object.assign(state, { loading: false, error: e?.message || '검색 결과를 불러오지 못했습니다.' }); emit()
      lastSent = '' // allow retry of the same query
    }
  }

  function schedule() {
    if (timer) timers.clear(timer)
    const norm = normalizeQuery(state.query)
    if (norm.length < minChars) {
      seq++; controller?.abort(); lastSent = ''
      Object.assign(state, { groups: [], loading: false, error: null, settledQuery: '' }); emit(); return
    }
    timer = timers.set(() => { timer = null; void run(norm) }, debounceMs)
  }

  return {
    state,
    input(value: string) { state.query = value; if (!composing) schedule(); else emit() },
    compositionStart() { composing = true },
    compositionEnd(value: string) { composing = false; state.query = value; schedule() },
    retry() { lastSent = ''; void run(normalizeQuery(state.query)) },
    clear() { if (timer) timers.clear(timer); seq++; controller?.abort(); lastSent = ''; Object.assign(state, { query: '', groups: [], loading: false, error: null, settledQuery: '' }); emit() },
    dispose() { if (timer) timers.clear(timer); controller?.abort() },
    get composing() { return composing }
  }
}
