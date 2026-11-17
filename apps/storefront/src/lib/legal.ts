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
