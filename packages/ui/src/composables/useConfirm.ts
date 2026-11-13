// Promise-based confirm dialog: `const ok = await confirm({ title, body, danger })`.
// Mount <OmConfirmDialog /> once near the app root; requests resolve in order.
import { reactive } from 'vue'

export interface ConfirmOptions {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}
interface Pending extends Required<Omit<ConfirmOptions, 'body'>> {
  id: number
  body: string
  resolve: (ok: boolean) => void
}

const state = reactive<{ queue: Pending[] }>({ queue: [] })
let seq = 0

export const confirmState = state

export function useConfirm() {
  const confirm = (opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      state.queue.push({
        id: ++seq,
        title: opts.title,
        body: opts.body ?? '',
        confirmLabel: opts.confirmLabel ?? '확인',
        cancelLabel: opts.cancelLabel ?? '취소',
        danger: opts.danger ?? false,
        resolve
      })
    })
  }
  const settle = (id: number, ok: boolean) => {
    const i = state.queue.findIndex((q) => q.id === id)
    if (i < 0) return
    const [q] = state.queue.splice(i, 1)
    q.resolve(ok)
  }
  return { confirm, settle, state }
}
