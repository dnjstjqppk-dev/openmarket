// apps/cloudflare-gateway/src/services/channels/channel.js
// Outbound ChannelAdapter contract + registry (Phase 2 distribution side).
// Mirrors services/sourcing/provider.js: Zero-Mock, every adapter fails
// closed (CHANNEL_NOT_CONFIGURED) when its credentials are absent.

export class ChannelConfigError extends Error {
  constructor(channel, missing) {
    super(`CHANNEL_NOT_CONFIGURED: ${channel} needs ${missing.join(', ')}`);
    this.code = 'CHANNEL_NOT_CONFIGURED';
    this.channel = channel;
    // 6-0/D2: callers (partner-live error mapping) name the blank fields.
    this.missing = missing;
  }
}

/** Read required env keys; throw ChannelConfigError when any is blank. */
export function requireChannelEnv(env, channel, keys) {
  const out = {};
  const missing = [];
  for (const k of keys) {
    const v = String(env?.[k] ?? '').trim();
    if (!v) missing.push(k);
    else out[k] = v;
  }
  if (missing.length) throw new ChannelConfigError(channel, missing);
  return out;
}

/**
 * ChannelAdapter interface (JSDoc contract):
 * - publish(env, payload): Promise<{ externalId }> (live platform call)
 * - updateStock(env, externalId, qty): Promise<{ ok }> (live call)
 * - retire(env, externalId): Promise<{ ok }> (live delist call)
 * - keyStatus(env): { configured, missing } (never leaks values)
 */
const REGISTRY = new Map();

export function registerChannel(name, adapter) {
  if (REGISTRY.has(name)) throw new Error(`CHANNEL_DUPLICATE: ${name}`);
  REGISTRY.set(name, { ...adapter, name });
}

export function getChannel(name) {
  const c = REGISTRY.get(name);
  if (!c) throw new Error(`CHANNEL_UNKNOWN: ${name}`);
  return c;
}

export function listChannels() {
  return [...REGISTRY.keys()];
}

/** Fetch with an upper-bound timeout; slow platforms become 503, not hang. */
export async function channelFetch(url, options = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (res.status === 429) throw new Error('CHANNEL_RATELIMIT: platform throttled the call');
    if (res.status === 401 || res.status === 403) throw new Error('CHANNEL_AUTH: platform rejected credentials');
    if (!res.ok) throw new Error(`UPSTREAM_${res.status}: ${url}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}
