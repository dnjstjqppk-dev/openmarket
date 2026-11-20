// apps/cloudflare-gateway/src/services/sourcing/r2-migrate.js
// R2 image migration worker skeleton: copy provider image URLs into the
// olmoa-media bucket and record the R2 key on the offer. D1 fallback when
// the bucket binding is absent (mirrors storage.js 1MB honest cap).
//
// Bucket layout: sourcing/{provider}/{safeExternalId}/{index}.bin
// Phase 2 wiring: cron/queue worker pulls PENDING offers with remote URLs,
// migrates, then flips image_r2_key; storefront serves R2 keys only.

const MAX_BYTES = 8 * 1024 * 1024;

export function r2KeyFor(provider, externalId, index) {
  const safe = String(externalId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return `sourcing/${provider}/${safe}/${index}.bin`;
}

/** Fetch one origin image with timeout; returns bytes + contentType. */
export async function fetchOriginImage(url, { timeoutMs = 10000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`ORIGIN_${res.status}: ${url.slice(0, 80)}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) throw new Error('IMAGE_TOO_LARGE');
    return { bytes: buf, contentType: res.headers.get('content-type') || 'application/octet-stream' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Migrate up to `limit` images for an offer. Returns {migrated, keys}.
 * Without STORAGE_BUCKET binding, records nothing and reports honestly.
 */
export async function migrateOfferImages(env, offer, imageUrls, { limit = 8 } = {}) {
  if (!env?.STORAGE_BUCKET) return { migrated: 0, keys: [], fallback: 'R2_UNBOUND' };
  const keys = [];
  const urls = (imageUrls || []).slice(0, Math.max(1, limit));
  let i = 0;
  for (const url of urls) {
    const { bytes, contentType } = await fetchOriginImage(url);
    const key = r2KeyFor(offer.provider, offer.external_id, i++);
    await env.STORAGE_BUCKET.put(key, bytes, { httpMetadata: { contentType } });
    keys.push(key);
  }
  if (keys.length) {
    await env.DB.prepare(
      'UPDATE sourcing_offers SET image_r2_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(keys[0], offer.id).run();
  }
  return { migrated: keys.length, keys, fallback: null };
}
