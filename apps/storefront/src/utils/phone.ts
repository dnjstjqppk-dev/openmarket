// apps/storefront/src/utils/phone.ts
// P2-S12 / S-N03: Korean phone validation shared by checkout, address book and
// the cash-receipt form. Mirrors the server backstop in services/orders.js
// parseAddress: digits only, starts with 0, 9-11 digits total. The old
// /^[0-9+\-\s()]{9,20}$/ accepted '+++++++++' — this does not.
export const digitsOnly = (v: string): string => String(v || '').replace(/\D/g, '')

/** General contact number (mobile or landline). Returns an error message or null. */
export function validateKrPhone(phone: string): string | null {
  const d = digitsOnly(phone)
  if (!/^0\d{8,10}$/.test(d)) return '연락처를 숫자로 입력해 주세요 (예: 010-1234-5678)'
  return null
}

/** Mobile-only (cash-receipt PERSONAL issuance). Returns an error message or null. */
export function validateKrMobile(phone: string): string | null {
  const d = digitsOnly(phone)
  if (!/^01[016789]\d{7,8}$/.test(d)) return '휴대폰 번호 10-11자리를 입력해 주세요 (예: 01012345678)'
  return null
}

/** Business registration number (cash-receipt BUSINESS issuance). */
export function validateBrnDigits(brn: string): string | null {
  const d = digitsOnly(brn)
  if (!/^\d{10}$/.test(d)) return '사업자등록번호 숫자 10자리를 입력해 주세요'
  return null
}
