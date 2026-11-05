// apps/cloudflare-gateway/src/services/crawler/html-sanitizer.js
// Strips scripts, iframes, styles, inline event handlers, and malicious payloads.

export function sanitizeHtml(rawHtml) {
  if (!rawHtml || typeof rawHtml !== 'string') return '';

  let clean = rawHtml
    // Remove scripts and style blocks
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    // Remove dangerous structural tags
    .replace(/<\/?(iframe|object|embed|form|link|meta|base|applet|svg)\b[^>]*>/gi, '')
    // Strip on* inline event handlers (e.g. onclick, onerror, onload)
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    // Strip javascript: pseudo-protocol in href/src
    .replace(/href\s*=\s*(['"])javascript:[^'"]*\1/gi, 'href="#"')
    .replace(/src\s*=\s*(['"])javascript:[^'"]*\1/gi, 'src=""')
    // Remove data-uri executable scripts
    .replace(/data\s*:\s*text\/html/gi, 'data:blocked');

  return clean.trim();
}

