// Display formatting shared by all consoles. Money is integer KRW everywhere in OLMOA.

export function formatKrw(v: number | string | null | undefined): string {
  const n = Number(v)
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return '-'
  return `${Math.round(n).toLocaleString('ko-KR')}원`
}

export function formatNumber(v: number | string | null | undefined): string {
  const n = Number(v)
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? '-' : n.toLocaleString('ko-KR')
}

// D1 stores 'YYYY-MM-DD HH:MM:SS' in UTC; render in the viewer's local time.
function parse(v: string | number | Date): Date {
  if (v instanceof Date) return v
  if (typeof v === 'number') return new Date(v)
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v.replace(' ', 'T') + 'Z')
}

export function formatDate(v: string | number | Date | null | undefined): string {
  if (!v) return '-'
  const d = parse(v)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function formatDateTime(v: string | number | Date | null | undefined): string {
  if (!v) return '-'
  const d = parse(v)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Whole-percent discount, only when the original price is really higher (never invented). */
export function discountRate(original: number | null | undefined, sale: number | null | undefined): number {
  const o = Number(original); const s = Number(sale)
  if (!Number.isFinite(o) || !Number.isFinite(s) || o <= 0 || s >= o) return 0
  return Math.floor(((o - s) * 100) / o)
}
