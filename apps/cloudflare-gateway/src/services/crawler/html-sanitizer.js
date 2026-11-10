// apps/cloudflare-gateway/src/services/crawler/html-sanitizer.js
// Allowlist HTML sanitizer for seller-supplied product descriptions.
//
// The previous regex stripper only removed ` on*=` attributes preceded by
// whitespace, so `<img/src=x/onerror=...>` (slash-separated, no whitespace)
// survived and executed under the storefront's v-html (P1-C02). This version
// parses every tag and rebuilds it from an allowlist: unknown tags are
// unwrapped (their text kept), unknown attributes dropped, and URL attributes
// restricted to http(s) / site-relative targets. Script/style content is
// dropped entirely.

// Tags that may appear in a product description. Everything else is unwrapped
// (block/script-like content tags below are dropped with their content).
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'div', 'span', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'a', 'img'
]);

// Tags whose entire subtree is dangerous: drop tag AND content.
const DROP_CONTENT_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'applet',
  'form', 'link', 'meta', 'base', 'svg', 'math', 'noscript',
  'video', 'audio', 'source', 'canvas', 'slot', 'template'
]);

const VOID_TAGS = new Set(['br', 'hr', 'img']);

// attribute allowlist per tag ('*' = allowed on any allowed tag)
const ATTR_ALLOW = {
  '*': new Set(['title']),
  'a': new Set(['href', 'title']),
  'img': new Set(['src', 'alt', 'title', 'width', 'height']),
  'th': new Set(['colspan', 'rowspan']),
  'td': new Set(['colspan', 'rowspan'])
};

function isSafeUrl(value) {
  const v = String(value || '').trim().replace(/[\u0000-\u0020]+/g, '');
  if (!v || v.startsWith('#')) return true;
  if (v.startsWith('/') && !v.startsWith('//')) return true;
  return /^(https?):\/\//i.test(v);
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// Parses one raw tag interior ("img src=x/onerror=y" incl. slash separators)
// into [tagName, [[attrName, attrValue|null]...]]. Returns null when the
// interior is not a plausible tag (e.g. stray "<3" in text).
function parseTag(interior) {
  const m = interior.match(/^\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)\s*([\s\S]*)$/);
  if (!m) return null;
  const closing = m[1] === '/';
  const name = m[2].toLowerCase();
  let rest = m[3] || '';
  // Trailing "/" of a self-closing tag
  rest = rest.replace(/\s*\/\s*$/, '');
  const attrs = [];
  // Attribute scanner: tolerates missing whitespace ("src=x/onerror=y").
  const attrRe = /\/?\s*([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g;
  let am;
  while ((am = attrRe.exec(rest)) !== null) {
    const attrName = am[1].toLowerCase();
    if (!attrName || attrName === '/') continue;
    let attrValue = am[2] === undefined ? null : am[2];
    if (attrValue !== null && attrValue.length >= 2) {
      const q = attrValue[0];
      if ((q === '"' || q === "'") && attrValue[attrValue.length - 1] === q) {
        attrValue = attrValue.slice(1, -1);
      }
    }
    attrs.push([attrName, attrValue]);
    if (attrRe.lastIndex === am.index) break; // zero-width guard
  }
  return { closing, name, attrs };
}

function rebuildTag(tag) {
  const { closing, name, attrs } = tag;
  if (!ALLOWED_TAGS.has(name)) return '';
  if (closing) return VOID_TAGS.has(name) ? '' : `</${name}>`;
  const allowed = new Set([...(ATTR_ALLOW['*'] || []), ...((ATTR_ALLOW[name] || new Set()))]);
  let out = `<${name}`;
  for (const [attrName, attrValue] of attrs) {
    // Event handlers and scriptable attributes can never be allowlisted.
    if (attrName.startsWith('on')) continue;
    if (!allowed.has(attrName)) continue;
    if (attrValue === null) continue; // valueless attrs add nothing for descriptions
    if ((attrName === 'href' || attrName === 'src') && !isSafeUrl(attrValue)) continue;
    out += ` ${attrName}="${escapeAttr(attrValue)}"`;
  }
  out += '>';
  return out;
}

export function sanitizeHtml(rawHtml) {
  if (!rawHtml || typeof rawHtml !== 'string') return '';

  // Strip comments / doctype / processing instructions first.
  let src = rawHtml.replace(/<!--[\s\S]*?-->/g, '').replace(/<![^>]*>/g, '').replace(/<\?[\s\S]*?\?>/g, '');

  let out = '';
  let i = 0;
  const len = src.length;
  while (i < len) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { out += src.slice(i); break; }
    out += src.slice(i, lt);
    const gt = src.indexOf('>', lt + 1);
    if (gt === -1) { out += src.slice(lt); break; } // unterminated: keep as text
    const interior = src.slice(lt + 1, gt);
    const tag = parseTag(interior);
    if (!tag) { out += src.slice(lt, gt + 1); i = gt + 1; continue; } // not a tag: keep text
    if (DROP_CONTENT_TAGS.has(tag.name)) {
      if (!tag.closing && !/\/\s*$/.test(interior)) {
        // Skip the whole subtree: find the matching close tag (nesting-aware).
        let depth = 1;
        let j = gt + 1;
        const openRe = new RegExp(`<\\s*\\/?\\s*${tag.name}\\b[^>]*>`, 'gi');
        openRe.lastIndex = j;
        let tm;
        let end = len;
        while ((tm = openRe.exec(src)) !== null) {
          if (/^<\s*\//.test(tm[0])) { depth--; } else if (!/\/\s*>$/.test(tm[0])) { depth++; }
          if (depth === 0) { end = tm.index + tm[0].length; break; }
        }
        i = end;
        continue;
      }
      i = gt + 1; // lone closing tag of a dropped element: skip
      continue;
    }
    out += rebuildTag(tag);
    i = gt + 1;
  }

  // Residual defense-in-depth: even after rebuild, no javascript: URL or
  // inline handler may survive (e.g. inside malformed survivors kept as text).
  return out.replace(/javascript\s*:/gi, '').replace(/\son\w+\s*=/gi, ' data-on=').trim();
}
