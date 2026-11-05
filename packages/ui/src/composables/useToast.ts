// App-wide toast queue. Success toasts must only be raised after the server confirmed the action.
import { reactive } from 'vue'

export type ToastTone = 'success' | 'danger' | 'warning' | 'info'
export interface ToastItem { id: number; tone: ToastTone; message: string; title?: string; timeout: number }

const state = reactive<{ items: ToastItem[] }>({ items: [] })
let seq = 0

function push(tone: ToastTone, message: string, opts: { title?: string; timeout?: number } = {}) {
  const id = ++seq
  const timeout = opts.timeout ?? (tone === 'danger' ? 7000 : 4000)
  state.items.push({ id, tone, message, title: opts.title, timeout })
  if (state.items.length > 4) state.items.shift()
  if (timeout > 0) setTimeout(() => dismiss(id), timeout)
  return id
}
function dismiss(id: number) {
  const i = state.items.findIndex((t) => t.id === id)
  if (i >= 0) state.items.splice(i, 1)
}

export const toastState = state
export function useToast() {
  return {
    success: (m: string, o?: { title?: string; timeout?: number }) => push('success', m, o),
    error: (m: string, o?: { title?: string; timeout?: number }) => push('danger', m, o),
    warning: (m: string, o?: { title?: string; timeout?: number }) => push('warning', m, o),
    info: (m: string, o?: { title?: string; timeout?: number }) => push('info', m, o),
    dismiss
  }
}
