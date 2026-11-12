// apps/cloudflare-gateway/src/routes/shipping.js
// NEW-20: remote/island surcharge zones. The public list lets checkout and
// order screens explain the fee; operators own the rows through the admin API.

import { requireAdmin } from '../lib/auth.js';
import { json, readJson } from '../lib/http.js';
import { validateZoneInput } from '../lib/remote-zones.js';

export async function handleShippingRoutes(request, url, env, corsHeaders) {
  const p = url.pathname;

  if (p === '/api/v1/shipping/remote-zones' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT postal_prefix, zone_name, surcharge_amount, updated_at FROM shipping_remote_zones ORDER BY postal_prefix'
    ).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }

  if (p === '/api/v1/admin/shipping/remote-zones' && request.method === 'GET') {
    await requireAdmin(request, env);
    const { results } = await env.DB.prepare(
      'SELECT postal_prefix, zone_name, surcharge_amount, updated_at FROM shipping_remote_zones ORDER BY postal_prefix'
    ).all();
    return json(corsHeaders, { success: true, count: results.length, data: results });
  }

  if (p === '/api/v1/admin/shipping/remote-zones' && (request.method === 'PUT' || request.method === 'POST')) {
    const admin = await requireAdmin(request, env);
    const b = await readJson(request);
    const { prefix, name, amount } = validateZoneInput(b);
    await env.DB.prepare(
      `INSERT INTO shipping_remote_zones (postal_prefix, zone_name, surcharge_amount, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(postal_prefix) DO UPDATE SET zone_name = excluded.zone_name,
         surcharge_amount = excluded.surcharge_amount, updated_at = CURRENT_TIMESTAMP`
    ).bind(prefix, name, amount).run();
    return json(corsHeaders, { success: true, data: { postal_prefix: prefix, zone_name: name, surcharge_amount: amount } });
  }

  const delM = p.match(/^\/api\/v1\/admin\/shipping\/remote-zones\/([^/]+)$/);
  if (delM && request.method === 'DELETE') {
    await requireAdmin(request, env);
    const r = await env.DB.prepare('DELETE FROM shipping_remote_zones WHERE postal_prefix = ?').bind(delM[1]).run();
    return json(corsHeaders, { success: true, deleted: r.meta.changes || 0 });
  }

  return null;
}
