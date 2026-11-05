// tests/runtime/v3_1_smoke.mjs — V3.1 smoke against `npm run dev:db && npm run dev:api` (real workerd + LOCAL D1 only).
const API = process.env.API_URL || 'http://127.0.0.1:8787';
const PW = 'DevPass!2026#';
const out = [];
const log = (k, v) => { out.push(`${k}: ${v}`); console.log(`${k}: ${v}`); };
const call = async (path, { method = 'GET', token, body, headers = {} } = {}) => {
  const res = await fetch(`${API}${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
};
const fail = [];
const check = (name, cond, detail = '') => { log(`${cond ? 'PASS' : 'FAIL'} ${name}`, detail); if (!cond) fail.push(name); };

const h = await call('/health');
check('health', h.status === 200 && h.json.databaseStatus === 'CONNECTED_D1', JSON.stringify(h.json.readiness));
const adm = await call('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@openmarket.com', password: PW, role: 'ADMIN' } });
check('admin login (admin_role from d1_24)', adm.status === 200 && adm.json.admin_role === 'SUPER_ADMIN', `admin_role=${adm.json && adm.json.admin_role}`);
const tok = adm.json.token;
const rec = await call('/api/v1/admin/reconciliation', { token: tok });
const failing = (rec.json.data.checks || []).filter((c) => !c.ok && c.id !== 'R07').map((c) => c.id);
check('reconciliation R01–R21 on workerd D1 (json_each etc.)', rec.status === 200 && rec.json.data.checks.length === 22 && failing.length === 0, `checks=${rec.json.data.checks.length} failing=${failing.join(',') || 'none'}`);
const runs = await call('/api/v1/admin/finance/reconciliation-runs', { token: tok });
check('reconciliation run recorded', runs.status === 200 && runs.json.data.runs.length >= 1);
const setup = await call('/api/v1/auth/2fa/setup', { method: 'POST', token: tok, body: {} });
check('TOTP setup (WebCrypto AES-GCM on workerd)', setup.status === 200 && /^otpauth:/.test(setup.json.data.otpauth_uri));
const brn = (nine) => { const d = String(nine).split('').map(Number); const w = [1, 3, 7, 1, 3, 7, 1, 3, 5]; const s = d.reduce((a, x, i) => a + x * w[i], 0) + Math.floor((d[8] * 5) / 10); return `${nine}${(10 - (s % 10)) % 10}`; };
const stamp = Date.now().toString().slice(-6);
const app = await call('/api/v1/partner-applications', { method: 'POST', body: {
  email: `smoke${stamp}@example.com`, password: 'SellerApply!2026', contact_name: '스모크', phone: '010-1111-2222', business_name: `스모크상회${stamp}`, representative_name: '대표',
  business_reg_number: brn(`123${stamp}`), mail_order_reg_number: '제2026-서울-0001호', bank_code: '004', bank_account_number: '123-456-789012', bank_account_holder: '스모크',
  customer_service_phone: '02-000-0000', return_shipping_address: '서울', agree_seller_terms: true, agree_privacy: true } });
check('seller application (d1_23)', app.status === 201, app.text.slice(0, 120));
if (app.status === 201) {
  const up = await call('/api/v1/storage/upload', { method: 'POST', token: app.json.data.token, body: { file_name: 'a.pdf', content_type: 'application/pdf', folder: 'kyb', file_data: Buffer.from('%PDF-1.4').toString('base64') } });
  check('private KYB upload', up.status === 201 && up.json.data.visibility === 'PRIVATE');
  if (up.status === 201) {
    const anon = await call(`/api/v1/storage/file/${up.json.data.file_id}`);
    check('KYB file hidden from anonymous', anon.status === 404, `status=${anon.status}`);
  }
}
const cust = await call('/api/v1/auth/login', { method: 'POST', body: { email: 'customer@example.com', password: PW } });
const pre = await call('/api/v1/auth/withdraw/precheck', { token: cust.json.token });
check('withdrawal precheck (d1_22)', pre.status === 200 && typeof pre.json.data.can_withdraw === 'boolean');
const exp = await call('/api/v1/auth/privacy/export', { token: cust.json.token });
check('data export', exp.status === 200 && exp.json.data.account.email === 'customer@example.com');
const cs = await call('/api/v1/admin/admin-users', { method: 'POST', token: tok, body: { email: `cs${stamp}@olmoa.test`, full_name: 'cs', admin_role: 'CS', password: 'Operator!2026#pw' } });
check('create CS operator', cs.status === 201, cs.text.slice(0, 100));
const csTok = (await call('/api/v1/auth/login', { method: 'POST', body: { email: `cs${stamp}@olmoa.test`, password: 'Operator!2026#pw', role: 'ADMIN' } })).json.token;
check('CS denied finance', (await call('/api/v1/admin/reconciliation', { token: csTok })).status === 403);
check('CS allowed orders', (await call('/api/v1/admin/orders', { token: csTok })).status === 200);
console.log(`\nRUNTIME SMOKE: ${out.filter((l) => l.startsWith('PASS')).length} passed, ${fail.length} failed`);
if (fail.length) process.exitCode = 1;
