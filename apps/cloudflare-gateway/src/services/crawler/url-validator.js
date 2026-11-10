// apps/cloudflare-gateway/src/services/crawler/url-validator.js
// URL validation and robust Server-Side Request Forgery (SSRF) defense.

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '::',
  '169.254.169.254',             // AWS / Cloud metadata service
  'metadata.google.internal',     // GCP metadata
  'instance-data',                // Cloud instance metadata
  'localtest.me'
]);

function isPrivateIp(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (Link-local)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8
  if (a === 0) return true;
  return false;
}

// Normalizes a WHATWG hostname for block-list comparison: Node keeps IPv6
// brackets in `hostname` ("[::1]" !== "::1"), and DNS names may carry a
// trailing root dot. Returns lowercase without brackets / trailing dot.
export function normalizeHost(hostname) {
  let h = String(hostname || '').toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.endsWith('.') && h.length > 1) h = h.slice(0, -1);
  return h;
}

function isBlockedIpv6(host) {
  // host must already be normalized (no brackets, lowercase)
  if (!host.includes(':')) return false;
  if (host === '::1' || host === '::') return true;
  // IPv4-mapped / translated (::ffff:1.2.3.4, ::ffff:0:1.2.3.4): judge the embedded IPv4
  const v4 = host.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4 && isPrivateIp(v4[1])) return true;
  // Unique-local fc00::/7, link-local fe80::/10
  if (/^f[c-d][0-9a-f]/i.test(host.replace(/^:/, ''))) return true;
  if (/^fe[89ab][0-9a-f]/i.test(host.replace(/^:/, ''))) return true;
  // Any other literal IPv6 (global unicast, documentation, multicast, ...) is
  // not a crawl target either: fail closed rather than allowlisting the world.
  return true;
}

export function validateProductUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL을 입력해 주세요.' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { valid: false, error: '유효한 웹 주소(URL) 형식이 아닙니다.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, error: 'HTTP 및 HTTPS 프로토콜만 수집 가능합니다.' };
  }

  const host = normalizeHost(parsed.hostname);

  if (BLOCKED_HOSTS.has(host) || host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.arpa')) {
    return { valid: false, error: `보안 정책에 따라 사설 호스트(${host}) 접근이 차단되었습니다. (SSRF 방어)` };
  }

  if (isPrivateIp(host)) {
    return { valid: false, error: `내부 사설 IP 대역(${host})에 대한 상품 수집은 금지되어 있습니다. (SSRF 방어)` };
  }

  if (isBlockedIpv6(host)) {
    return { valid: false, error: `보안 정책에 따라 IP 리터럴(${host}) 접근이 차단되었습니다. (SSRF 방어)` };
  }

  const cleanDomain = host.replace(/^www\./, '');

  return {
    valid: true,
    url: parsed.href,
    domain: cleanDomain,
    pathname: parsed.pathname,
    protocol: parsed.protocol
  };
}
