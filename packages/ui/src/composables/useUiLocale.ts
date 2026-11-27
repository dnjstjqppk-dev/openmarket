// Shared reactive UI locale composable + deterministic exact-phrase DOM translator
// for @olmoa/ui, Storefront, Partner Center, and Admin Console.
// NEVER touches seller product titles/descriptions (decision-22): only translates
// exact UI chrome strings present in UI_PHRASES.
import { ref, watch } from 'vue'
import { UI_PHRASES, UI_LOCALE_OPTIONS, type UiLocale } from '../i18n/phrases.ts'

export type { UiLocale }
export { UI_LOCALE_OPTIONS, UI_PHRASES }

const STORAGE_KEY = 'olmoa_ui_locale'
const VALID: ReadonlySet<string> = new Set(['ko-KR', 'en-US', 'ja-JP', 'zh-TW'])

function readInitial(): UiLocale {
  try {
    if (typeof location !== 'undefined') {
      const m = location.pathname.match(/^\/(ko|en|ja|zh-tw)(?:\/|$)/i)
      if (m) {
        const l = m[1].toLowerCase()
        if (l === 'en') return 'en-US'
        if (l === 'ja') return 'ja-JP'
        if (l === 'zh-tw') return 'zh-TW'
        return 'ko-KR'
      }
    }
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved && VALID.has(saved)) return saved as UiLocale
    }
  } catch { /* storage unavailable */ }
  return 'ko-KR'
}

export const uiLocale = ref<UiLocale>(readInitial())

export function setUiLocale(next: UiLocale, persist = false) {
  if (!VALID.has(next)) return
  uiLocale.value = next
  try {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = next === 'ko-KR' ? 'ko' : next === 'en-US' ? 'en' : next === 'ja-JP' ? 'ja' : 'zh-TW'
    }
    if (persist && typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, next)
    }
  } catch { /* ignore */ }
}

export function initUiLocale() {
  setUiLocale(readInitial(), false)
}

/** Pure exact-phrase translator usable in tests and non-reactive contexts. */
export function translatePhrase(ko: string, locale: UiLocale = 'ko-KR'): string {
  if (!ko || locale === 'ko-KR') return ko
  const entry = UI_PHRASES[ko]
  if (!entry) return ko
  if (locale === 'en-US') return entry.en
  if (locale === 'ja-JP') return entry.ja
  if (locale === 'zh-TW') return entry.zh
  return ko
}

/** Reactive phrase translator for templates and computed properties. */
export function uiT(ko: string): string {
  return translatePhrase(ko, uiLocale.value)
}

export function useUiLocale() {
  return {
    locale: uiLocale,
    options: UI_LOCALE_OPTIONS,
    setLocale: setUiLocale,
    t: uiT
  }
}

// ---- Deterministic exact-phrase DOM translator (secondary views & consoles) ----
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'OPTION'])
const ATTR_NAMES = ['placeholder', 'aria-label', 'title'] as const
const origText = new WeakMap<Text, string>()
const origAttr = new WeakMap<Element, Map<string, string>>()
let domInstalled = false

function translateTextNode(node: Text, loc: UiLocale) {
  const raw = origText.get(node) ?? node.nodeValue ?? ''
  if (!raw) return
  const m = raw.match(/^(\s*)([\s\S]*?)(\s*)$/)
  if (!m || !m[2]) return
  const core = m[2]
  if (!(core in UI_PHRASES)) return
  if (!origText.has(node)) origText.set(node, raw)
  const next = loc === 'ko-KR' ? raw : `${m[1]}${translatePhrase(core, loc)}${m[3]}`
  if (node.nodeValue !== next) node.nodeValue = next
}

function translateElementAttrs(el: Element, loc: UiLocale) {
  for (const attr of ATTR_NAMES) {
    const val = el.getAttribute(attr)
    if (!val) continue
    let map = origAttr.get(el)
    const base = map?.get(attr) ?? val
    if (!(base in UI_PHRASES)) continue
    if (!map) { map = new Map(); origAttr.set(el, map) }
    if (!map.has(attr)) map.set(attr, base)
    const next = loc === 'ko-KR' ? base : translatePhrase(base, loc)
    if (val !== next) el.setAttribute(attr, next)
  }
}

function walkSubtree(root: Node, loc: UiLocale) {
  if (root.nodeType === Node.TEXT_NODE) {
    const parent = root.parentElement
    if (parent && !SKIP_TAGS.has(parent.tagName) && !parent.closest('[data-no-i18n]')) {
      translateTextNode(root as Text, loc)
    }
    return
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return
  const el = root as Element
  if (SKIP_TAGS.has(el.tagName) || el.hasAttribute('data-no-i18n')) return
  translateElementAttrs(el, loc)
  for (let child = el.firstChild; child; child = child.nextSibling) {
    walkSubtree(child, loc)
  }
}

/**
 * Installs a lightweight exact-phrase DOM synchronizer on the app root so every
 * view across Storefront, Partner Center, and Admin Console renders UI chrome
 * in the active locale while leaving product titles and user data untouched.
 */
export function installDomLocaleSync(target?: Element | null) {
  if (domInstalled || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  domInstalled = true
  let busy = false
  let observer: MutationObserver | null = null

  const getRoot = () => target || document.getElementById('app') || document.body
  const run = (node: Node) => {
    if (busy) return
    busy = true
    try { walkSubtree(node, uiLocale.value) } finally { busy = false }
  }

  const syncObserver = () => {
    const root = getRoot()
    if (!root) return
    run(root)
    if (uiLocale.value === 'ko-KR') {
      observer?.disconnect()
      observer = null
      return
    }
    if (!observer) {
      observer = new MutationObserver((mutations) => {
        if (busy || uiLocale.value === 'ko-KR') return
        busy = true
        try {
          for (const m of mutations) {
            if (m.type === 'characterData' && m.target.nodeType === Node.TEXT_NODE) {
              const t = m.target as Text
              const cur = t.nodeValue ?? ''
              const trimmed = cur.trim()
              if (trimmed && trimmed in UI_PHRASES) {
                origText.set(t, cur)
                translateTextNode(t, uiLocale.value)
              }
            } else if (m.type === 'childList') {
              for (let i = 0; i < m.addedNodes.length; i++) walkSubtree(m.addedNodes[i], uiLocale.value)
            }
          }
        } finally { busy = false }
      })
      observer.observe(root, { childList: true, subtree: true, characterData: true })
    }
  }

  watch(uiLocale, () => { syncObserver() }, { immediate: true })
}
