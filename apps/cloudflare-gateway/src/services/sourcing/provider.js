// apps/cloudflare-gateway/src/services/sourcing/provider.js
// SourcingProvider contract + registry. Zero-Mock: every adapter fails
// closed (CONFIG_MISSING) when its credentials are absent — no dummy data.

export class SourcingConfigError extends Error {
  constructor(provider, missing) {
    super(`CONFIG_MISSING: ${provider} needs ${missing.join(', ')}`);
    this.code = 'CONFIG_MISSING';
    this.provider = provider;
  }
}

/** Read required env keys; throw SourcingConfigError when any is blank. */
export function requireEnv(env, provider, keys) {
  const out = {};
  const missing = [];
  for (const k of keys) {
    const v = String(env?.[k] ?? '').trim();
    if (!v) missing.push(k);
    else out[k] = v;
  }
  if (missing.length) throw new SourcingConfigError(provider, missing);
  return out;
}

/**
 * SourcingProvider interface (JSDoc contract):
 * - name: string (registry key)
 * - fetchOffer(env, externalId): Promise<raw offer> (live API call)
 * - checkAvailability(env, externalId, qty): Promise<{ok, stockQty}>
 */
const REGISTRY = new Map();

export function registerProvider(name, provider) {
  if (REGISTRY.has(name)) throw new Error(`PROVIDER_DUPLICATE: ${name}`);
  REGISTRY.set(name, { ...provider, name });
}

export function getProvider(name) {
  const p = REGISTRY.get(name);
  if (!p) throw new Error(`PROVIDER_UNKNOWN: ${name}`);
  return p;
}

export function listProviders() {
  return [...REGISTRY.keys()];
}

/** Fetch with an upper-bound timeout; slow origins become RECHECK, not hang. */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) throw new Error(`UPSTREAM_${res.status}: ${url}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}
