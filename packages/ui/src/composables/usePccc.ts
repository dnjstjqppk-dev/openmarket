// Personal Customs Clearance Code (개인통관고유부호) input hook.
// Mirrors the gateway format (P + 12 digits); server verification stays the
// source of truth — this hook only gates the request client-side.
import { computed, ref } from 'vue'

export const PCCC_PATTERN = /^P\d{12}$/
export type PcccMode = 'FORMAT_ONLY' | 'UNIPASS_MATCH' | 'UNIPASS_NO_MATCH' | 'UNIPASS_UNAVAILABLE'

export interface PcccVerdict {
  verified: boolean
  mode: PcccMode
  message: string
}

export function normalizePcccInput(raw: string): string {
  return String(raw ?? '').trim().toUpperCase().replace(/[\s-]/g, '')
}

export function usePccc(opts: { apiBase: string; token?: () => string | null } = { apiBase: '' }) {
  const pccc = ref('')
  const holderName = ref('')
  const holderPhone = ref('')
  const checking = ref(false)
  const verdict = ref<PcccVerdict | null>(null)
  const error = ref<string | null>(null)

  const normalized = computed(() => normalizePcccInput(pccc.value))
  const formatValid = computed(() => PCCC_PATTERN.test(normalized.value))
  const formatError = computed(() =>
    !pccc.value ? null
    : formatValid.value ? null
    : "'P'로 시작하는 13자리 번호여야 합니다 (예: P123456789012)")

  async function verify(): Promise<PcccVerdict | null> {
    error.value = null
    verdict.value = null
    if (!formatValid.value) {
      error.value = formatError.value ?? '개인통관고유부호 형식이 올바르지 않습니다.'
      return null
    }
    checking.value = true
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = opts.token?.()
      if (token) headers.Authorization = `Bearer ${token}`
      const res = await fetch(`${opts.apiBase}/api/v1/customs/validate-pccc`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ pccc: normalized.value, name: holderName.value, phone: holderPhone.value })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data) throw new Error(data?.error || '조회에 실패했습니다.')
      verdict.value = { verified: data.verified === true, mode: data.verification_mode, message: data.message }
      return verdict.value
    } catch (e) {
      error.value = e instanceof Error ? e.message : '조회에 실패했습니다.'
      return null
    } finally {
      checking.value = false
    }
  }

  return { pccc, holderName, holderPhone, checking, verdict, error, normalized, formatValid, formatError, verify }
}
