// Client mirror of the server GTIN check (lib/product-identifiers.js).
// Instant feedback only — the server re-validates everything.

export const GTIN_EXEMPT_OPTIONS = [
  { value: 'SELF_MADE', label: '자체제작' },
  { value: 'NOBRAND_IMPORT', label: '노브랜드 수입' },
  { value: 'HANDMADE', label: '수공예' },
  { value: 'OVERSEAS_AGENT', label: '해외구매대행' },
  { value: 'OTHER', label: '기타 (직접 입력)' }
] as const

export const NOBRAND_VALUE = '노브랜드/자체제작'

export function isValidGtin(raw: string): boolean {
  const s = String(raw || '').replace(/[\s-]/g, '')
  if (!/^\d+$/.test(s) || ![8, 12, 13, 14].includes(s.length)) return false
  let sum = 0
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[s.length - 1 - i])
    sum += i % 2 === 0 ? d : d * 3
  }
  return sum % 10 === 0
}
