// Cookie-session fetch wrapper (P2 consolidation: was triplicated verbatim in
// the storefront, admin and partner mains — a refresh/credential policy fix
// needed the same edit in 3 places and one could silently lag).
//
// Every request to apiBaseUrl carries credentials so the httpOnly cookies
// authenticate it; no token is ever read from JS-accessible storage. On 401,
// one single-flight refresh is attempted and the original request retried
// once; only a failed refresh calls onExpiredSession. The x-olmoa-retried
// marker stops refresh loops.

export interface ApiFetchOptions {
  apiBaseUrl: string;
  noRefreshPaths?: string[];
  onExpiredSession?: () => void;
}

const DEFAULT_NO_REFRESH = ['/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/register'];

export function installApiFetch(options: ApiFetchOptions): void {
  const { apiBaseUrl } = options;
  const noRefresh = options.noRefreshPaths ?? DEFAULT_NO_REFRESH;
  const onExpired = options.onExpiredSession ?? (() => {});
  const nativeFetch = window.fetch.bind(window);

  async function withApiCredentials(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (input instanceof Request) {
      return input.credentials === 'include'
        ? nativeFetch(input, init)
        : nativeFetch(new Request(input), { ...init, credentials: 'include' as RequestCredentials });
    }
    return nativeFetch(input, { ...init, credentials: 'include' as RequestCredentials });
  }

  let refreshInflight: Promise<boolean> | null = null;
  async function refreshAccessToken(): Promise<boolean> {
    if (!refreshInflight) {
      refreshInflight = (async () => {
        try {
          // The httpOnly refresh cookie is presented automatically; rotation
          // re-sets both cookies, so there is nothing to store.
          const res = await nativeFetch(`${apiBaseUrl}/api/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include' as RequestCredentials,
            body: '{}'
          });
          const data = await res.json().catch(() => ({} as any));
          return res.ok && !!data.success;
        } catch {
          return false;
        } finally {
          refreshInflight = null;
        }
      })();
    }
    return refreshInflight;
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const isApi = url.startsWith(apiBaseUrl);
    const res = isApi ? await withApiCredentials(input, init) : await nativeFetch(input, init);
    const initHeaders = new Headers(init?.headers);
    const skipRefresh = initHeaders.get('x-olmoa-retried') === '1'
      || input instanceof Request
      || noRefresh.some((p) => url.includes(p));
    if (res.status === 401 && isApi && !skipRefresh) {
      const ok = await refreshAccessToken();
      if (ok) {
        const merged: Record<string, string> = {};
        initHeaders.forEach((v, k) => { merged[k] = v; });
        merged['x-olmoa-retried'] = '1';
        return withApiCredentials(input, { ...init, headers: merged });
      }
      onExpired();
    }
    return res;
  };
}
