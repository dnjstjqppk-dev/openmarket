// tests/audit/phase1_inventory.mjs — PHASE 1 inventory of every buyer / admin / partner screen.
//
// Static scan of each routed view (API calls, buttons, state handling, suspicious hard-coded claims) plus a live
// probe: every API call a screen makes is sent to the real gateway (in-process, dev seed) with a token of the
// role that screen runs as, so a 401 cannot hide a missing route. ROUTE_NOT_FOUND => the screen calls an API
// that does not exist.  Output: reports/v4/phase1/inventory.json + INVENTORY.md
//   run: node tests/audit/phase1_inventory.mjs

import fs from 'node:fs';
import path from 'node:path';
import { createGateway } from '../lib/harness.mjs';
import { signJwt } from '../../apps/cloudflare-gateway/src/utils/crypto-auth.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '../..');
const OUT = path.join(ROOT, 'reports/v4/phase1');
fs.mkdirSync(OUT, { recursive: true });

const APPS = {
  storefront: { role: 'ROLE_CUSTOMER', user: 'u_customer_001' },
  admin: { role: 'ROLE_ADMIN', user: 'u_admin_001' },
  partner: { role: 'ROLE_PARTNER', user: 'u_partner_001' }
};

// ---- router: path -> component file -------------------------------------------------------------------------
function routesOf(app) {
  const src = fs.readFileSync(path.join(ROOT, `apps/${app}/src/router/index.ts`), 'utf8');
  const imports = {};
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+'\.\.\/views\/(\w+)\.vue'/g)) imports[m[1]] = m[2];
  const routes = [];
  for (const m of src.matchAll(/\{\s*path:\s*'([^']*)'[^}]*?component:\s*(?:(\w+)|\(\)\s*=>\s*import\('\.\.\/views\/(\w+)\.vue'\))/g)) {
    routes.push({ path: m[1], view: m[3] || imports[m[2]] || m[2] });
  }
  for (const m of src.matchAll(/\{\s*path:\s*'([^']*)'[^}]*?redirect:\s*'([^']*)'/g)) routes.push({ path: m[1], redirect: m[2] });
  const guard = /beforeEach/.test(src);
  return { routes, guard, guardSrc: guard ? src.slice(src.indexOf('beforeEach'), src.indexOf('beforeEach') + 900) : '' };
}

// ---- API calls in a file ------------------------------------------------------------------------------------
function apiCalls(src) {
  const calls = [];
  const re = /([`'"])((?:\$\{API_BASE_URL\}|\$\{API\}|\$\{base\})?\/api\/v1\/[^`'"]*)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const raw = m[2];
    const after = src.slice(m.index, m.index + 420);
    const next = after.indexOf('/api/v1/', 10);
    const win = next > 0 ? after.slice(0, next) : after;
    const mm = win.match(/method:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/);
    // drop a trailing, unterminated `${cond ? `?q` : ''}` (nested template) before substituting params
    const p = raw.replace(/^\$\{[^}]+\}/, '').split('?')[0].replace(/\$\{[^}]*$/, '').replace(/\$\{[^}]+\}/g, 'x_probe');
    calls.push({ raw, path: p, method: mm ? mm[1] : 'GET' });
  }
  const seen = new Set();
  return calls.filter((c) => { const k = c.method + ' ' + c.path; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---- static UI heuristics -------------------------------------------------------------------------------------
function scanView(src) {
  const tpl = (src.match(/<template>([\s\S]*)<\/template>/) || [, ''])[1];
  const buttons = [...tpl.matchAll(/<button\b([^>]*)>/g)].map((b) => b[1]);
  const dead = buttons.filter((a) => !/@click|v-on:click|type="submit"|:onClick/.test(a)).length;
  const deadLinks = (tpl.match(/href="#"/g) || []).length;
  const suspicious = [];
  const pats = [
    [/\|\|\s*\d{2,}\b/g, 'numeric fallback (|| N)'],
    [/Math\.random/g, 'Math.random'],
    [/실시간\s*\d|실시간 인기|LIVE NOW|명이 (함께 )?보는/g, 'live/realtime claim'],
    [/최저가 보장|정품 보증|전수 검수|100%|무조건|즉시 환불|무료 반품/g, 'guarantee claim'],
    [/Official|Verified|Guaranteed|Premium Quality/g, 'English trust claim'],
    [/placeholder="[^"]*(예: 홍길동|010-1234-5678)/g, 'fake default input']
  ];
  for (const [re, label] of pats) { const n = (src.match(re) || []).length; if (n) suspicious.push(`${label}×${n}`); }
  const textNodes = [...tpl.matchAll(/>([^<>{}]{3,})</g)].map((t) => t[1].trim()).filter(Boolean);
  const english = textNodes.filter((t) => /^[A-Za-z][A-Za-z0-9 .,'&:()!?+/-]{4,}$/.test(t)).length;
  return {
    lines: src.split('\n').length,
    buttons: buttons.length,
    buttons_without_handler: dead,
    dead_links: deadLinks,
    has_loading: /loading|isLoading|skeleton|animate-pulse/i.test(src),
    has_error: /error|catch\s*\(/i.test(src),
    has_empty: /\.length\s*===\s*0|!\w+\.length|없습니다|no results|empty/i.test(src),
    responsive_classes: (tpl.match(/\b(sm|md|lg|xl):/g) || []).length,
    english_text_nodes: english,
    korean_text_nodes: textNodes.filter((t) => /[가-힣]/.test(t)).length,
    aria: (tpl.match(/aria-|role="/g) || []).length,
    inline_hex_colors: (src.match(/#[0-9A-Fa-f]{6}\b/g) || []).length,
    suspicious
  };
}

// ---- live probe ----------------------------------------------------------------------------------------------
const env = { JWT_SECRET: 'phase1-audit-secret-0123456789abcdefghijkl', ENVIRONMENT: 'development', PAYMENT_MODE: 'sandbox', RATE_LIMIT_REQUIRED: 'false', CARRIER_WEBHOOK_SECRET: 'carrier-secret-0123456789ab' };
const g = await createGateway({ env, seedFiles: ['migrations/dev/seed_local_dev.sql'] });
const tokens = {};
for (const [app, cfg] of Object.entries(APPS)) {
  const u = g.db.prepare('SELECT u.id, u.role, u.token_version, p.id AS pid FROM users u LEFT JOIN partners p ON p.owner_user_id = u.id WHERE u.id = ?').get(cfg.user);
  tokens[app] = await signJwt({ sub: u.id, role: u.role, tv: u.token_version || 0, ...(u.pid ? { pid: u.pid } : {}), ...(u.role === 'ROLE_ADMIN' ? { mfa: 1 } : {}) }, env.JWT_SECRET, 3600);
}
// The method is read from the source near the URL; when that guess is wrong the route may still exist under
// another method, so a miss is only reported once every method misses.
async function probe(app, call) {
  const first = await probeOnce(app, call, call.method);
  if (first.verdict !== 'MISSING_ROUTE') return first;
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'GET'].filter((x) => x !== call.method)) {
    const r = await probeOnce(app, call, m);
    if (r.verdict !== 'MISSING_ROUTE') return { ...r, method_found: m };
  }
  return first;
}
async function probeOnce(app, call, method) {
  const opts = { method, token: tokens[app] };
  if (method !== 'GET') opts.body = {};
  try {
    const r = await g.call(call.path, opts);
    if (r.json && r.json.code === 'ROUTE_NOT_FOUND') return { status: r.status, verdict: 'MISSING_ROUTE' };
    if (r.status === 405) return { status: r.status, verdict: 'WRONG_METHOD' };
    if (r.status >= 500) return { status: r.status, verdict: 'SERVER_ERROR', code: r.json && r.json.code };
    return { status: r.status, verdict: 'EXISTS', code: r.json && r.json.code };
  } catch (e) {
    return { status: 0, verdict: 'PROBE_ERROR', code: String(e.message).slice(0, 80) };
  }
}

const inventory = {};
for (const app of Object.keys(APPS)) {
  const { routes, guard, guardSrc } = routesOf(app);
  const viewsDir = path.join(ROOT, `apps/${app}/src/views`);
  const routedViews = new Set(routes.filter((r) => r.view).map((r) => r.view));
  const allViews = fs.readdirSync(viewsDir).filter((f) => f.endsWith('.vue')).map((f) => f.replace('.vue', ''));
  const screens = [];
  for (const r of routes) {
    if (!r.view) { screens.push({ url: r.path, redirect: r.redirect }); continue; }
    const file = path.join(viewsDir, `${r.view}.vue`);
    if (!fs.existsSync(file)) { screens.push({ url: r.path, view: r.view, error: 'VIEW_FILE_MISSING' }); continue; }
    const src = fs.readFileSync(file, 'utf8');
    const calls = apiCalls(src);
    for (const c of calls) Object.assign(c, await probe(app, c));
    screens.push({ url: r.path, view: r.view, ...scanView(src), api: calls });
  }
  // shared components / app shell count too (header, footer, nav)
  const shell = ['App.vue', ...(fs.existsSync(path.join(ROOT, `apps/${app}/src/components`)) ? fs.readdirSync(path.join(ROOT, `apps/${app}/src/components`)).map((f) => `components/${f}`) : [])];
  const shellScreens = [];
  for (const f of shell) {
    const src = fs.readFileSync(path.join(ROOT, `apps/${app}/src`, f), 'utf8');
    const calls = apiCalls(src);
    for (const c of calls) Object.assign(c, await probe(app, c));
    shellScreens.push({ file: f, ...scanView(src), api: calls });
  }
  inventory[app] = { router_guard: guard, guard_excerpt: guardSrc.slice(0, 400), unrouted_views: allViews.filter((v) => !routedViews.has(v)), screens, shell: shellScreens };
}
fs.writeFileSync(path.join(OUT, 'inventory.json'), JSON.stringify(inventory, null, 2));

// ---- markdown -------------------------------------------------------------------------------------------------
const md = ['# PHASE 1 — 화면·API 전수 인벤토리 (자동 생성)', '', `생성: ${new Date().toISOString()} · 생성기: \`tests/audit/phase1_inventory.mjs\``, '',
  'API 판정은 각 화면 역할의 토큰으로 개발 시드 게이트웨이에 실제 요청한 결과입니다. `MISSING_ROUTE` = 화면이 존재하지 않는 API를 호출.', ''];
const totals = { screens: 0, api: 0, missing: 0, server_error: 0, dead_buttons: 0, suspicious: 0 };
for (const [app, inv] of Object.entries(inventory)) {
  md.push(`## ${app}`, '', `라우터 가드: ${inv.router_guard ? '있음' : '없음'} · 라우트에 연결되지 않은 화면: ${inv.unrouted_views.join(', ') || '없음'}`, '');
  md.push('| URL | 화면 | 줄 | API(존재/누락/5xx) | 핸들러 없는 버튼 | 로딩·오류·빈 | 반응형 클래스 | 영문 문구 | 의심 패턴 |', '|---|---|---:|---|---:|---|---:|---:|---|');
  for (const s of inv.screens) {
    if (s.redirect) { md.push(`| ${s.url} | → ${s.redirect} | | | | | | | |`); continue; }
    if (s.error) { md.push(`| ${s.url} | ${s.view} | | **${s.error}** | | | | | |`); continue; }
    totals.screens++;
    const ex = s.api.filter((a) => a.verdict === 'EXISTS').length;
    const miss = s.api.filter((a) => a.verdict === 'MISSING_ROUTE' || a.verdict === 'WRONG_METHOD');
    const err = s.api.filter((a) => a.verdict === 'SERVER_ERROR' || a.verdict === 'PROBE_ERROR');
    totals.api += s.api.length; totals.missing += miss.length; totals.server_error += err.length; totals.dead_buttons += s.buttons_without_handler; totals.suspicious += s.suspicious.length;
    const state = `${s.has_loading ? 'L' : '-'}${s.has_error ? 'E' : '-'}${s.has_empty ? '0' : '-'}`;
    md.push(`| ${s.url} | ${s.view} | ${s.lines} | ${ex}/${miss.length}/${err.length} | ${s.buttons_without_handler}/${s.buttons} | ${state} | ${s.responsive_classes} | ${s.english_text_nodes} | ${s.suspicious.join(', ')} |`);
  }
  const broken = inv.screens.concat(inv.shell).flatMap((s) => (s.api || []).filter((a) => a.verdict !== 'EXISTS').map((a) => `| ${s.url || s.file} | ${a.method} | \`${a.raw}\` | ${a.verdict} | ${a.status} ${a.code || ''} |`));
  if (broken.length) md.push('', `### ${app}: 동작하지 않는 API 호출`, '', '| 화면 | 메서드 | 호출 | 판정 | 응답 |', '|---|---|---|---|---|', ...broken);
  md.push('');
}
md.splice(5, 0, `**합계** 화면 ${totals.screens} · API 호출 ${totals.api} · 없는 경로 ${totals.missing} · 서버 오류 ${totals.server_error} · 핸들러 없는 버튼 ${totals.dead_buttons} · 의심 패턴 화면 ${totals.suspicious}`, '');
fs.writeFileSync(path.join(OUT, 'INVENTORY.md'), md.join('\n'));
console.log(JSON.stringify(totals));
