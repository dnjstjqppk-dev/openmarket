// tests/legal_documents_test.mjs
// Work order 5-6: legal documents (TERMS/PRIVACY/REFUND) are operator-managed
// versioned rows. The storefront reads the current + history over the public
// API with a 7-day "revision planned" notice; registration is SUPER_ADMIN-only
// and can never backdate before today (KST); signup consent rows store the
// agreed versions.
import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';

const t = createRunner('Legal documents (5-6)');

const DAY_MS = 86400000;
const kstDate = (baseMs, offsetDays = 0) =>
  new Date(baseMs + 9 * 3600 * 1000 + offsetDays * DAY_MS).toISOString().slice(0, 10);

async function newGateway(todayKst) {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox',
      ...(todayKst ? { LEGAL_TEST_TODAY_KST: todayKst } : {})
    }
  });
}

const PW = 'DevPass!2026#';

async function login(g, email, role, password = PW) {
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password, role } });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return r.json.token;
}

async function csToken(g) {
  const superTok = await login(g, 'admin@openmarket.com', 'ADMIN');
  const created = await g.call('/api/v1/admin/admin-users', {
    method: 'POST', token: superTok,
    body: { email: 'cs-legal@openmarket.com', full_name: 'CS 약관', admin_role: 'CS', password: 'CsPass!2026#x' }
  });
  assert.equal(created.status, 201, created.text);
  return login(g, 'cs-legal@openmarket.com', 'ADMIN', 'CsPass!2026#x');
}

await t.test('1. public API serves the seeded 5-5 texts as current', async () => {
  const g = await newGateway();
  const terms = await g.call('/api/v1/legal/terms');
  assert.equal(terms.status, 200, terms.text);
  assert.equal(terms.json.data.current.version, 'v1.1');
  assert.equal(terms.json.data.current.effective_date, '2026-11-17');
  const heads = [...terms.json.data.current.body.matchAll(/제(\d+)조/g)].map((m) => Number(m[1]));
  assert.deepEqual([...new Set(heads)], [1, 2, 3, 4], 'seeded terms read 제1..4조 with no gap');
  assert.ok(!terms.json.data.current.body.includes('최저가'), 'retired guarantee article stays out of the seed');
  const privacy = await g.call('/api/v1/legal/privacy');
  assert.equal(privacy.status, 200, privacy.text);
  assert.equal(privacy.json.data.current.version, 'v1.0');
  const refund = await g.call('/api/v1/legal/refund');
  assert.equal(refund.status, 200, refund.text);
  assert.equal(refund.json.data.current.version, 'v1.0');
  assert.deepEqual(terms.json.data.history, [], 'no history before the first revision');
  assert.equal(terms.json.data.notice, null, 'no revision notice before the first revision');
});

await t.test('2. pre-effective queries still serve the old version', async () => {
  const today = kstDate(Date.now());
  const g = await newGateway(today);
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const c = await g.call('/api/v1/admin/legal-documents', {
    method: 'POST', token: adm,
    body: { kind: 'TERMS', version: 'v9.9', effective_date: kstDate(Date.now(), 30), body: '# 제1조 (목적)\n개정 본문' }
  });
  assert.equal(c.status, 201, c.text);
  const r = await g.call('/api/v1/legal/terms');
  assert.equal(r.json.data.current.version, 'v1.1', 'old version stays current before the effective date');
  assert.equal(r.json.data.upcoming.length, 1);
  assert.equal(r.json.data.upcoming[0].version, 'v9.9');
  assert.equal(r.json.data.notice, null, '30 days out: no revision notice yet');
});

await t.test('3. post-effective queries serve the new version with history', async () => {
  const g = await newGateway(kstDate(Date.now()));
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const eff = kstDate(Date.now(), 30);
  const c = await g.call('/api/v1/admin/legal-documents', {
    method: 'POST', token: adm,
    body: { kind: 'TERMS', version: 'v9.9', effective_date: eff, body: '# 제1조 (목적)\n개정 본문' }
  });
  assert.equal(c.status, 201, c.text);
  const g2 = await newGateway(kstDate(Date.now(), 31));
  // Same registration must be visible on the later clock: re-register is forbidden,
  // so copy the row into the fresh harness DB (the clock pin is env-only).
  g2.db.prepare('INSERT INTO legal_documents (id, kind, version, effective_date, body, author_user_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(c.json.data.id, 'TERMS', 'v9.9', eff, '# 제1조 (목적)\n개정 본문', 'u_admin_001');
  const r = await g2.call('/api/v1/legal/terms');
  assert.equal(r.json.data.current.version, 'v9.9', 'new version is current after its effective date');
  assert.deepEqual(r.json.data.upcoming, [], 'nothing upcoming after effectiveness');
  assert.equal(r.json.data.history.length, 1);
  assert.equal(r.json.data.history[0].version, 'v1.1', 'superseded version stays readable');
  assert.ok(r.json.data.history[0].body.includes('제4조'), 'history carries full bodies');
});

await t.test('4. revision notice appears 7 days before the effective date', async () => {
  const g = await newGateway(kstDate(Date.now(), 23));
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const eff = kstDate(Date.now(), 30);
  g.db.prepare('INSERT INTO legal_documents (id, kind, version, effective_date, body, author_user_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run('ld_notice_1', 'TERMS', 'v9.9', eff, '# 제1조 (목적)\n개정 본문', 'u_admin_001');
  void adm;
  const r = await g.call('/api/v1/legal/terms');
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.data.notice, 'notice shown 7 days before effectiveness');
  assert.equal(r.json.data.notice.version, 'v9.9');
  assert.equal(r.json.data.notice.days_until_effective, 7);
  const g2 = await newGateway(kstDate(Date.now(), 22));
  g2.db.prepare('INSERT INTO legal_documents (id, kind, version, effective_date, body, author_user_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run('ld_notice_1', 'TERMS', 'v9.9', eff, '# 제1조 (목적)\n개정 본문', 'u_admin_001');
  const r2 = await g2.call('/api/v1/legal/terms');
  assert.equal(r2.json.data.notice, null, '8 days out: still silent');
});

await t.test('5. retroactive, duplicate and malformed registrations are refused', async () => {
  const today = kstDate(Date.now());
  const g = await newGateway(today);
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const back = await g.call('/api/v1/admin/legal-documents', {
    method: 'POST', token: adm,
    body: { kind: 'TERMS', version: 'v0.1', effective_date: kstDate(Date.now(), -1), body: '# x\n소급' }
  });
  assert.equal(back.status, 400, back.text);
  assert.equal(back.json.code, 'RETROACTIVE_EFFECTIVE_DATE');
  const dup = await g.call('/api/v1/admin/legal-documents', {
    method: 'POST', token: adm,
    body: { kind: 'TERMS', version: 'v1.1', effective_date: kstDate(Date.now(), 5), body: '# x\n중복' }
  });
  assert.equal(dup.status, 409, dup.text);
  for (const [label, body, code] of [
    ['bad kind', { kind: 'COOKIES', version: 'v1', effective_date: today, body: '# x\nb' }, 'INVALID_LEGAL_KIND'],
    ['bad date', { kind: 'TERMS', version: 'v1', effective_date: '2026-13-99', body: '# x\nb' }, 'INVALID_DATE'],
    ['empty body', { kind: 'TERMS', version: 'v1', effective_date: today, body: '  ' }, 'BODY_REQUIRED']
  ]) {
    const r = await g.call('/api/v1/admin/legal-documents', { method: 'POST', token: adm, body });
    assert.equal(r.status, 400, `${label}: ${r.text}`);
    assert.equal(r.json.code, code, `${label}: ${r.text}`);
  }
});

await t.test('6. non-SUPER_ADMIN registration and listing are forbidden', async () => {
  const g = await newGateway(kstDate(Date.now()));
  const cs = await csToken(g);
  const w = await g.call('/api/v1/admin/legal-documents', {
    method: 'POST', token: cs,
    body: { kind: 'TERMS', version: 'v2.0', effective_date: kstDate(Date.now(), 3), body: '# x\nb' }
  });
  assert.equal(w.status, 403, w.text);
  assert.equal(w.json.code, 'ADMIN_PERMISSION_DENIED');
  const l = await g.call('/api/v1/admin/legal-documents', { token: cs });
  assert.equal(l.status, 403, l.text);
  const anon = await g.call('/api/v1/admin/legal-documents', { method: 'POST', body: {} });
  assert.equal(anon.status, 401);
  assert.equal(g.db.prepare("SELECT COUNT(*) AS c FROM legal_documents WHERE version = 'v2.0'").get().c, 0, 'nothing stored');
});

await t.test('7. admin list carries statuses and the write is audited', async () => {
  const g = await newGateway(kstDate(Date.now()));
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const c = await g.call('/api/v1/admin/legal-documents', {
    method: 'POST', token: adm,
    body: { kind: 'PRIVACY', version: 'v1.1', effective_date: kstDate(Date.now(), 10), body: '# 1. 수집\n개정' }
  });
  assert.equal(c.status, 201, c.text);
  const l = await g.call('/api/v1/admin/legal-documents?kind=PRIVACY', { token: adm });
  assert.equal(l.status, 200, l.text);
  const byVer = Object.fromEntries(l.json.data.map((d) => [d.version, d.status]));
  assert.equal(byVer['v1.0'], 'CURRENT');
  assert.equal(byVer['v1.1'], 'UPCOMING');
  assert.ok(l.json.data.every((d) => typeof d.body === 'string' && d.body.length > 0), 'bodies included for preview');
  const audit = await g.call('/api/v1/admin/audit-log?action=LEGAL_DOCUMENT_CREATE', { token: adm });
  assert.equal(audit.status, 200, audit.text);
  assert.ok(audit.json.data.some((row) => row.target_type === 'legal_document'), 'registration audited');
});

await t.test('8. signup stores the agreed versions without client input', async () => {
  const g = await newGateway(kstDate(Date.now()));
  const r = await g.call('/api/v1/auth/register', {
    method: 'POST',
    body: { email: 'legal.consent@example.com', password: 'ConsentPass!2026#', full_name: '동의테', phone: '010-1111-2222', agree_terms: true, agree_privacy: true }
  });
  assert.equal(r.status, 201, r.text);
  const rows = g.db.prepare('SELECT consent_type, terms_version FROM user_consents WHERE user_id = ?').all(r.json.customer_id);
  const byType = Object.fromEntries(rows.map((x) => [x.consent_type, x.terms_version]));
  assert.equal(byType.TERMS_OF_SERVICE, 'v1.1', 'terms row carries the current terms version');
  assert.equal(byType.PRIVACY_POLICY, 'v1.0', 'privacy row carries the current privacy version');
  // Explicit client versions keep working (older apps).
  const r2 = await g.call('/api/v1/auth/register', {
    method: 'POST',
    body: { email: 'legal.legacy@example.com', password: 'ConsentPass!2026#', full_name: '동의테', phone: '010-1111-2222', agree_terms: true, agree_privacy: true, terms_version: 'terms-2026-11' }
  });
  assert.equal(r2.status, 201, r2.text);
  const rows2 = g.db.prepare('SELECT terms_version FROM user_consents WHERE user_id = ?').all(r2.json.customer_id);
  assert.ok(rows2.length > 0 && rows2.every((x) => x.terms_version === 'terms-2026-11'), 'explicit version honored on every row');
});

await t.test('9. effective-today registration is live immediately', async () => {
  const today = kstDate(Date.now());
  const g = await newGateway(today);
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const c = await g.call('/api/v1/admin/legal-documents', {
    method: 'POST', token: adm,
    body: { kind: 'REFUND', version: 'v1.1', effective_date: today, body: '# 1. 결제 전 주문\n당일 개정' }
  });
  assert.equal(c.status, 201, c.text);
  const r = await g.call('/api/v1/legal/refund');
  assert.equal(r.json.data.current.version, 'v1.1');
  assert.deepEqual(r.json.data.history.map((h) => h.version), ['v1.0']);
});

await t.test('10. unknown public kind is a client error, never a crash', async () => {
  const g = await newGateway();
  const r = await g.call('/api/v1/legal/cookies');
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'INVALID_LEGAL_KIND');
});

t.finish();
