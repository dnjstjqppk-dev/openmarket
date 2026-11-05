// apps/cloudflare-gateway/src/services/crawler/url-validator.js
// URL validation and robust Server-Side Request Forgery (SSRF) defense.

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
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

  const host = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTS.has(host) || host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.arpa')) {
    return { valid: false, error: `보안 정책에 따라 사설 호스트(${host}) 접근이 차단되었습니다. (SSRF 방어)` };
  }

  if (isPrivateIp(host)) {
    return { valid: false, error: `내부 사설 IP 대역(${host})에 대한 상품 수집은 금지되어 있습니다. (SSRF 방어)` };
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
