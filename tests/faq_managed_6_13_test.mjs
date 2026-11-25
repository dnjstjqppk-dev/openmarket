// tests/faq_managed_6_13_test.mjs
// Phase 6 task 6-13 (decision-21): admin-managed FAQ — the four hardcoded
// wordings move to D1 unchanged, operators own the rest.

import assert from 'node:assert/strict';
import { createGateway, createRunner } from './lib/harness.mjs';
import { FAQ_CATEGORIES } from '../apps/cloudflare-gateway/src/routes/features.js';

const t = createRunner('Managed FAQ (6-13)');

async function newGateway() {
  return createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox'
    }
  });
}

const PW = 'DevPass!2026#';
async function login(g, email, role) {
  const r = await g.call('/api/v1/auth/login', { method: 'POST', body: { email, password: PW, role } });
  assert.equal(r.status, 200, `login ${email}: ${r.text}`);
  return r.json.token;
}

// The retired hardcoded wordings, byte for byte (migration must not repaint them).
const SEED = [
  ['faq_ship_001', '배송', '배송비와 배송 기간은 어떻게 되나요?',
    '배송비와 무료배송 기준은 판매자(직영/입점)별로 다르며 주문서에서 판매자별로 확인할 수 있습니다. 배송 예정일을 넘긴 경우 주문 상세에서 지연 보상을 신청할 수 있습니다.'],
  ['faq_return_001', '반품/교환', '반품은 어떻게 하나요?',
    '상품 수령 후 7일 이내 주문 상세에서 반품을 신청할 수 있습니다. 판매자가 회수·확인하면 결제 금액은 원결제수단으로, 사용한 적립금은 적립금으로 환불됩니다. 단순 변심 반품은 반품 배송비가 부과될 수 있습니다.'],
  ['faq_pay_001', '주문/결제', '결제 대금은 언제 판매자에게 지급되나요?',
    '입점 판매자의 판매대금은 구매확정(또는 배송완료 후 7일 자동 확정) 이후 정산되며, 정산 후 환불이 발생하면 다음 정산에서 차감됩니다.'],
  ['faq_seller_001', '판매자 입점', '올모아 글로벌 셀러로 입점하려면 어떻게 해야 하나요?',
    '상단 [셀러 입점] 메뉴를 통해 사업자등록증 및 정산 계좌를 제출하시면 운영 관리자 심사 완료 후 전용 파트너 센터에서 상품 등록 및 대량 CSV 업로드가 가능합니다.']
];

// 1. Seed rows land unchanged with remapped categories.
await t.test('1. migration moves the four wordings unchanged', async () => {
  const g = await newGateway();
  assert.deepEqual(FAQ_CATEGORIES, ['주문/결제', '배송', '취소/환불', '반품/교환', '회원', '판매자 입점']);
  assert.ok(g.db.prepare("SELECT version FROM schema_migrations WHERE version = 'd1_76_faqs.sql'").get());
  for (const [id, category, q, a] of SEED) {
    const row = g.db.prepare('SELECT category, question, answer, is_published FROM faqs WHERE id = ?').get(id);
    assert.ok(row, `seed row ${id} exists`);
    assert.equal(row.category, category);
    assert.equal(row.question, q, `${id} question byte-identical`);
    assert.equal(row.answer, a, `${id} answer byte-identical`);
    assert.equal(row.is_published, 1);
  }
});

// 2. Public API serves published rows with category + search.
await t.test('2. public FAQ lists, filters and searches', async () => {
  const g = await newGateway();
  const all = await g.call('/api/v1/support/faq');
  assert.equal(all.status, 200, all.text);
  assert.equal(all.json.data.length, 4);
  assert.deepEqual(all.json.categories, FAQ_CATEGORIES);
  assert.ok(all.json.data.every((r) => r.q && r.a && r.category), 'q/a/category shape kept');
  const cats = all.json.data.map((r) => r.category);
  assert.deepEqual(cats, ['주문/결제', '배송', '반품/교환', '판매자 입점'], 'fixed category order');
  const ship = await g.call('/api/v1/support/faq?category=' + encodeURIComponent('배송'));
  assert.equal(ship.json.data.length, 1);
  assert.equal(ship.json.data[0].id, 'faq_ship_001');
  const empty = await g.call('/api/v1/support/faq?category=' + encodeURIComponent('회원'));
  assert.equal(empty.json.data.length, 0, 'empty category, not an error');
  const bad = await g.call('/api/v1/support/faq?category=' + encodeURIComponent('없는분류'));
  assert.equal(bad.status, 400);
  const found = await g.call('/api/v1/support/faq?q=' + encodeURIComponent('적립금'));
  assert.equal(found.json.data.length, 1);
  assert.equal(found.json.data[0].id, 'faq_return_001');
});

// 3. Unpublished rows stay hidden from the public.
await t.test('3. unpublished rows are operator-only', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const hide = await g.call('/api/v1/admin/faqs/faq_ship_001', { method: 'PUT', token: adm, body: { is_published: false } });
  assert.equal(hide.status, 200, hide.text);
  const pub = await g.call('/api/v1/support/faq');
  assert.equal(pub.json.data.length, 3);
  assert.ok(pub.json.data.every((r) => r.id !== 'faq_ship_001'));
  const admList = await g.call('/api/v1/admin/faqs', { token: adm });
  assert.equal(admList.json.data.length, 4, 'operators still see it');
  const show = await g.call('/api/v1/admin/faqs/faq_ship_001', { method: 'PUT', token: adm, body: { is_published: true } });
  assert.equal(show.status, 200);
});

// 4. Admin CRUD + reorder, audited.
await t.test('4. admin creates, edits and reorders with audit trail', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const badCat = await g.call('/api/v1/admin/faqs', {
    method: 'POST', token: adm, body: { category: '없는분류', question: 'q', answer: 'a' }
  });
  assert.equal(badCat.status, 400);
  const created = await g.call('/api/v1/admin/faqs', {
    method: 'POST', token: adm,
    body: { category: '회원', question: '탈퇴는 어떻게 하나요?', answer: '<p>마이페이지에서 탈퇴할 수 있습니다.</p>', sort_order: 5 }
  });
  assert.equal(created.status, 201, created.text);
  const id = created.json.faq_id;
  assert.deepEqual(created.json.warnings, [], 'no drift, no warnings');
  const upd = await g.call(`/api/v1/admin/faqs/${id}`, { method: 'PUT', token: adm, body: { question: '회원 탈퇴는 어떻게 하나요?' } });
  assert.equal(upd.status, 200, upd.text);
  assert.equal(g.db.prepare('SELECT question FROM faqs WHERE id = ?').get(id).question, '회원 탈퇴는 어떻게 하나요?');
  const re = await g.call('/api/v1/admin/faqs/reorder', {
    method: 'PUT', token: adm, body: { orders: [{ id, sort_order: 1 }, { id: 'faq_ship_001', sort_order: 99 }] }
  });
  assert.equal(re.status, 200, re.text);
  assert.equal(g.db.prepare('SELECT sort_order FROM faqs WHERE id = ?').get(id).sort_order, 1);
  const badRe = await g.call('/api/v1/admin/faqs/reorder', { method: 'PUT', token: adm, body: { orders: [{ id: 'faq_nope', sort_order: 1 }] } });
  assert.equal(badRe.status, 404);
  const trail = g.db.prepare("SELECT action FROM admin_audit_log WHERE target_type = 'faq' AND target_id = ? ORDER BY rowid").all(id).map((r) => r.action);
  assert.ok(trail.includes('FAQ_CREATE') && trail.includes('FAQ_UPDATE'), `audited: ${trail.join(',')}`);
  assert.ok(g.db.prepare("SELECT 1 FROM admin_audit_log WHERE action = 'FAQ_REORDER'").get(), 'reorder audited');
});

// 5. Non-operators are refused.
await t.test('5. member and partner tokens cannot touch FAQ admin', async () => {
  const g = await newGateway();
  const cust = await login(g, 'customer@example.com', 'CUSTOMER');
  const pt = await login(g, 'seller@temu-supply.com', 'PARTNER');
  for (const token of [cust, pt]) {
    const list = await g.call('/api/v1/admin/faqs', { token });
    assert.equal(list.status, 403, 'reads refused');
    const write = await g.call('/api/v1/admin/faqs', { method: 'POST', token, body: { category: '회원', question: 'q', answer: 'a' } });
    assert.equal(write.status, 403, 'writes refused');
  }
  const anon = await g.call('/api/v1/admin/faqs');
  assert.equal(anon.status, 401);
});

// 6. Answers sanitize on save.
await t.test('6. stored answers keep allowed tags only', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const evil = '<p>안내</p><script>alert(1)</script><img src=x onerror=alert(2)><a href="javascript:alert(3)">x</a><a href="/support">ok</a>';
  const created = await g.call('/api/v1/admin/faqs', {
    method: 'POST', token: adm, body: { category: '회원', question: 'XSS?', answer: evil }
  });
  assert.equal(created.status, 201, created.text);
  const stored = g.db.prepare('SELECT answer FROM faqs WHERE id = ?').get(created.json.faq_id).answer;
  assert.ok(!/script|onerror|javascript:/i.test(stored), `sanitized: ${stored.slice(0, 120)}`);
  assert.ok(stored.includes('안내') && stored.includes('/support'), 'content and safe links survive');
  const pub = await g.call('/api/v1/support/faq?category=' + encodeURIComponent('회원'));
  assert.ok(!/script|onerror|javascript:/i.test(JSON.stringify(pub.json.data)));
});

// 7. Policy numbers in answers match the effective settings.
await t.test('7. day windows in answers match the return window', async () => {
  const g = await newGateway();
  const adm = await login(g, 'admin@openmarket.com', 'ADMIN');
  const rows = g.db.prepare('SELECT id, answer FROM faqs').all();
  assert.ok(rows.length >= 4);
  for (const r of rows) {
    const mentions = [...String(r.answer).matchAll(/후\s*(\d+)\s*일/g)].map((m) => Number(m[1]));
    for (const n of mentions) assert.equal(n, 7, `${r.id} window matches RETURN_WINDOW_DAYS_DEFAULT`);
  }
  const drift = await g.call('/api/v1/admin/faqs', {
    method: 'POST', token: adm,
    body: { category: '반품/교환', question: '기간?', answer: '수령 후 14일 이내에 신청하세요.' }
  });
  assert.equal(drift.status, 201, 'drift warns, never blocks');
  assert.ok((drift.json.warnings || []).some((w) => w.code === 'POLICY_NUMBER_MISMATCH'), 'mismatch warned');
  const plain = await g.call('/api/v1/admin/faqs', {
    method: 'POST', token: adm,
    body: { category: '배송', question: '기간?', answer: '2-4일 소요되며 3일 이내에 환불됩니다.' }
  });
  assert.deepEqual(plain.json.warnings, [], 'plain durations stay quiet');
});

t.finish();
