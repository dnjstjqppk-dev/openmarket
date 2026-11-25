// apps/storefront/src/lib/legal.ts
// Work order 5-6: client-side parsing of legal_documents bodies (see
// migrations/d1_68_legal_documents.sql for the line format). No v-html: text is
// rendered as Vue text nodes with **bold** mapped to <strong>.

export interface InlinePart {
  text: string
  bold: boolean
}

export type LegalBlock = { type: 'p'; parts: InlinePart[] } | { type: 'ul'; items: InlinePart[][] }

export interface LegalSection {
  id: string
  title: string
  blocks: LegalBlock[]
}

export interface LegalDoc {
  version: string
  effective_date: string
  body: string
}

export interface LegalUpcoming extends LegalDoc {
  days_until_effective: number
}

export interface LegalNotice {
  version: string
  effective_date: string
  days_until_effective: number
}

export interface LegalPayload {
  kind: string
  today: string
  current: LegalDoc | null
  upcoming: LegalUpcoming[]
  history: LegalDoc[]
  notice: LegalNotice | null
}

function inline(s: string): InlinePart[] {
  const parts: InlinePart[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) parts.push({ text: s.slice(last, m.index), bold: false })
    parts.push({ text: m[1], bold: true })
    last = m.index + m[0].length
  }
  if (last < s.length) parts.push({ text: s.slice(last), bold: false })
  return parts.length ? parts : [{ text: s, bold: false }]
}

export function parseLegalBody(body: string): LegalSection[] {
  const sections: LegalSection[] = []
  let cur: LegalSection | null = null
  const flush = () => {
    if (cur) sections.push(cur)
    cur = null
  }
  const ensure = () => {
    if (!cur) cur = { id: `a${sections.length + 1}`, title: '', blocks: [] }
    return cur
  }
  for (const raw of String(body || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('# ')) {
      flush()
      cur = { id: `a${sections.length + 1}`, title: line.slice(2).trim(), blocks: [] }
      continue
    }
    const sec = ensure()
    if (line.startsWith('- ')) {
      const lastBlock = sec.blocks[sec.blocks.length - 1]
      if (lastBlock && lastBlock.type === 'ul') lastBlock.items.push(inline(line.slice(2).trim()))
      else sec.blocks.push({ type: 'ul', items: [inline(line.slice(2).trim())] })
    } else {
      sec.blocks.push({ type: 'p', parts: inline(line) })
    }
  }
  flush()
  return sections
}

export function formatEffectiveDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''))
  if (!m) return String(ymd || '')
  return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일`
}

// 6-4: AEO question headings for the seeded legal sections. Display-only —
// the document body stays byte-identical; unmatched sections keep the title.
const QUESTION_MAP: Record<string, Array<[string, string]>> = {
  TERMS: [
    ['목적', '이 약관은 무엇을 정하나요?'],
    ['정의', '여기서 말하는 몰·이용자·판매자란 누구인가요?'],
    ['명시와 개정', '약관은 어디에 게시되고 어떻게 바뀌나요?'],
    ['성립 및 결제', '주문 계약은 언제 성립하나요?']
  ],
  PRIVACY: [
    ['수집하는 개인정보', '어떤 개인정보를 수집하나요?'],
    ['수집 및 이용목적', '수집한 개인정보는 어디에 쓰나요?'],
    ['보유 및 이용기간', '개인정보는 얼마나 보관하나요?']
  ],
  REFUND: [
    ['결제 전 주문', '결제 전 주문은 어떻게 취소되나요?'],
    ['출고 전 취소', '출고 전에 취소할 수 있나요?'],
    ['반품', '반품은 언제까지 할 수 있나요?'],
    ['환불 시기', '환불은 언제 되나요?'],
    ['판매 주체', '반품·환불 책임은 누구에게 있나요?']
  ]
}

export function questionFor(kind: string, title: string): string | null {
  for (const [match, q] of QUESTION_MAP[kind] || []) {
    if (String(title || '').includes(match)) return q
  }
  return null
}
