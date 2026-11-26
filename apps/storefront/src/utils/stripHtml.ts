// Shared client-side HTML sanitizer for seller descriptions rendered via v-html.
// Mirrors the server allowlist (apps/cloudflare-gateway/.../html-sanitizer.js)
// and the partner copy (apps/partner/src/utils/stripHtml.ts): every tag is
// parsed and rebuilt from an allowlist, so slash-separated payloads such as
// `<img/src=x/onerror=...>` that slipped through the old regex stripper here
// cannot survive. Unknown tags are unwrapped, scriptable subtrees dropped,
// and URL attributes restricted to http(s) / site-relative targets.

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'div', 'span', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'a', 'img'
]);

const DROP_CONTENT_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'applet',
  'form', 'link', 'meta', 'base', 'svg', 'math', 'noscript',
  'video', 'audio', 'source', 'canvas', 'slot', 'template'
]);

const VOID_TAGS = new Set(['br', 'hr', 'img']);

function isSafeUrl(value: string): boolean {
  const v = value.trim().replace(/[\u0000-\u0020]+/g, '');
  if (!v || v.startsWith('#')) return true;
  if (v.startsWith('/') && !v.startsWith('//')) return true;
  return /^https?:\/\//i.test(v);
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

interface ParsedTag { closing: boolean; name: string; attrs: Array<[string, string | null]> }

function parseTag(interior: string): ParsedTag | null {
  const m = interior.match(/^\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)\s*([\s\S]*)$/);
  if (!m) return null;
  const closing = m[1] === '/';
  const name = m[2].toLowerCase();
  const rest = (m[3] || '').replace(/\s*\/\s*$/, '');
  const attrs: Array<[string, string | null]> = [];
  const attrRe = /\/?\s*([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;
  let am: RegExpExecArray | null;
  while ((am = attrRe.exec(rest)) !== null) {
    const attrName = am[1].toLowerCase();
    if (!attrName || attrName === '/') continue;
    let attrValue: string | null = am[2] === undefined ? null : am[2];
    if (attrValue !== null && attrValue.length >= 2) {
      const q = attrValue[0];
      if ((q === '"' || q === "'") && attrValue[attrValue.length - 1] === q) {
        attrValue = attrValue.slice(1, -1);
      }
    }
    attrs.push([attrName, attrValue]);
    if (attrRe.lastIndex === am.index) break;
  }
  return { closing, name, attrs };
}

function allowedAttrs(tag: string): Set<string> {
  const base = new Set(['title']);
  if (tag === 'a') { base.add('href'); }
  if (tag === 'img') { base.add('src'); base.add('alt'); base.add('width'); base.add('height'); }
  if (tag === 'th' || tag === 'td') { base.add('colspan'); base.add('rowspan'); }
  return base;
}

function rebuildTag(tag: ParsedTag): string {
  if (!ALLOWED_TAGS.has(tag.name)) return '';
  if (tag.closing) return VOID_TAGS.has(tag.name) ? '' : `</${tag.name}>`;
  const allowed = allowedAttrs(tag.name);
  let out = `<${tag.name}`;
  for (const [attrName, attrValue] of tag.attrs) {
    if (attrName.startsWith('on')) continue;
    if (!allowed.has(attrName)) continue;
    if (attrValue === null) continue;
    if ((attrName === 'href' || attrName === 'src') && !isSafeUrl(attrValue)) continue;
    out += ` ${attrName}="${escapeAttr(attrValue)}"`;
  }
  return out + '>';
}

export function stripToSafeHtml(rawHtml: string | null | undefined): string {
  if (!rawHtml || typeof rawHtml !== 'string') return '';
  const src = rawHtml.replace(/<!--[\s\S]*?-->/g, '').replace(/<![^>]*>/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  let out = '';
  let i = 0;
  const len = src.length;
  while (i < len) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { out += src.slice(i); break; }
    out += src.slice(i, lt);
    const gt = src.indexOf('>', lt + 1);
    if (gt === -1) { out += src.slice(lt); break; }
    const tag = parseTag(src.slice(lt + 1, gt));
    if (!tag) { out += src.slice(lt, gt + 1); i = gt + 1; continue; }
    if (DROP_CONTENT_TAGS.has(tag.name)) {
      if (!tag.closing) {
        let depth = 1;
        const openRe = new RegExp(`<\\s*\\/?\\s*${tag.name}\\b[^>]*>`, 'gi');
        openRe.lastIndex = gt + 1;
        let end = len;
        let tm: RegExpExecArray | null;
        while ((tm = openRe.exec(src)) !== null) {
          if (/^<\s*\//.test(tm[0])) { depth--; } else if (!/\/\s*>$/.test(tm[0])) { depth++; }
          if (depth === 0) { end = tm.index + tm[0].length; break; }
        }
        i = end;
        continue;
      }
      i = gt + 1;
      continue;
    }
    out += rebuildTag(tag);
    i = gt + 1;
  }
  return out.replace(/javascript\s*:/gi, '').replace(/\son\w+\s*=/gi, ' data-on=').trim();
}
