import { onMounted, onBeforeUnmount, type Ref } from 'vue'

/** Calls `handler` on a pointer-down outside every given element (dropdowns, popovers, autocomplete). */
export function useClickOutside(targets: Ref<HTMLElement | null>[], handler: (e: Event) => void) {
  const listener = (e: Event) => {
    const t = e.target as Node
    if (targets.some((r) => r.value && r.value.contains(t))) return
    handler(e)
  }
  onMounted(() => document.addEventListener('pointerdown', listener, true))
  onBeforeUnmount(() => document.removeEventListener('pointerdown', listener, true))
}
