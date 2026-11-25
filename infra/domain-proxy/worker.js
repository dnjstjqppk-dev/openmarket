// infra/domain-proxy/worker.js — worker `olmoa-edge` (domain account), www.olmoa.com only.
//
// History: on 2026-11-25 this worker briefly proxied olmoa.com/admin/partner to the
// app workers in a second Cloudflare account. The app workers, D1 and R2 then moved
// into the domain account and own their Custom Domains directly (olmoa.com → openmarket,
// api → olmoa-api, admin → olmoa-admin, partner → olmoa-partner). What remains here is
// the www → apex redirect; there is deliberately no proxy code left to point at the
// retired workers.

export const APEX = 'olmoa.com';
const HSTS = 'max-age=31536000; includeSubDomains'; // no preload until the domain has run stably

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    if (host === `www.${APEX}`) {
      return new Response(null, {
        status: 301,
        headers: { Location: `https://${APEX}${url.pathname}${url.search}`, 'Strict-Transport-Security': HSTS }
      });
    }
    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  }
};
