// Shared behaviour of modal surfaces: body scroll lock, Escape to close, focus trap, focus restore.
import { watch, nextTick, onBeforeUnmount, type Ref } from 'vue'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
let lockCount = 0

export function useOverlay(open: Ref<boolean>, panel: Ref<HTMLElement | null>, close: () => void, opts: { dismissible?: () => boolean } = {}) {
  let restoreTo: HTMLElement | null = null

  const onKey = (e: KeyboardEvent) => {
    if (!open.value || !panel.value) return
    if (e.key === 'Escape' && (opts.dismissible ? opts.dismissible() : true)) { e.stopPropagation(); close(); return }
    if (e.key !== 'Tab') return
    const items = Array.from(panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
    if (!items.length) { e.preventDefault(); panel.value.focus(); return }
    const first = items[0]; const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const activate = async () => {
    restoreTo = document.activeElement as HTMLElement | null
    if (lockCount++ === 0) document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey, true)
    await nextTick()
    const target = panel.value?.querySelector<HTMLElement>('[data-autofocus]') || panel.value
    target?.focus()
  }
  const deactivate = () => {
    document.removeEventListener('keydown', onKey, true)
    if (lockCount > 0 && --lockCount === 0) document.body.style.overflow = ''
    restoreTo?.focus?.()
  }

  watch(open, (v, old) => { if (v && !old) activate(); else if (!v && old) deactivate() }, { immediate: true })
  onBeforeUnmount(() => { if (open.value) deactivate() })
}
