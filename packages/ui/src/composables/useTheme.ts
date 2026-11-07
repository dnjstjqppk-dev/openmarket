// Light / dark / system theme, persisted per browser (a viewer convenience only).
import { ref } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'
const KEY = 'olmoa_theme'
const mode = ref<ThemeMode>('system')

/// Header toggle order: explicit light, explicit dark, then OS-driven system.
export function nextThemeMode(m: ThemeMode): ThemeMode {
  return m === 'light' ? 'dark' : m === 'dark' ? 'system' : 'light'
}

function apply(m: ThemeMode) {
  const root = document.documentElement
  if (m === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', m)
}

export function useTheme() {
  return {
    mode,
    init() {
      try { const saved = localStorage.getItem(KEY) as ThemeMode | null; if (saved) mode.value = saved } catch { /* storage unavailable */ }
      apply(mode.value)
    },
    set(m: ThemeMode) {
      mode.value = m
      apply(m)
      try { localStorage.setItem(KEY, m) } catch { /* storage unavailable */ }
    }
  }
}
