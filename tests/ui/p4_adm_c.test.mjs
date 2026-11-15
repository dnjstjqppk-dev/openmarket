// tests/ui/p4_adm_c.test.mjs
// Work order 4-20..4-23: admin members, inquiries, penalties and the
// remaining console shells plus the seller-app parity.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('Admin C (4-20..4-23)');
const read = (p) => readFileSync(p, 'utf8');

await t.test('F1 member console searches, filters and reason-logs exports', async () => {
  const v = read('apps/admin/src/views/UsersView.vue');
  assert.ok(v.includes("params.set('q'") && v.includes("params.set('status'"), 'search and status sent');
  assert.ok(v.includes('WITHDRAWN') && v.includes('탈퇴'), 'withdrawal history shown');
  assert.ok(v.includes('내려받기 사유') && v.includes('reason='), 'export reason required');
  assert.ok(v.includes('reset-password'), 'password reset wired');
});

await t.test('F2 inquiry console flags overdue, assigns and templates answers', async () => {
  const v = read('apps/admin/src/views/InquiriesView.vue');
  assert.ok(v.includes('기한 경과') && v.includes('SLA_HOURS'), 'overdue flagged');
  assert.ok(v.includes('assignee_admin_id'), 'assignee stored');
  assert.ok(v.includes('ANSWER_TEMPLATES'), 'answer templates offered');
  assert.ok(v.includes('/reply'), 'reply endpoint kept');
});

await t.test('F3 review console queues reports and blinds', async () => {
  const v = read('apps/admin/src/views/ReviewsView.vue');
  assert.ok(v.includes('/review-reports'), 'report queue read');
  assert.ok(v.includes('/visibility'), 'blind wired');
  assert.ok(v.includes('selectedReview'), 'full text before action');
});

await t.test('F4 penalty console covers rules, appeals and grades', async () => {
  const r = read('apps/admin/src/router/index.ts');
  assert.ok(r.includes("path: '/partners/penalties-grades'"), 'screen routed');
  const v = read('apps/admin/src/views/partners/PenaltyGradeView.vue');
  assert.ok(v.includes('/penalty-rules'), 'rules managed');
  assert.ok(v.includes('꺼진 규칙으로는 부과 불가') || v.includes('꺼진 규칙'), 'disabled gate disclosed');
  assert.ok(v.includes('appealed=true'), 'appeal queue read');
  assert.ok(v.includes('/grade-policies') && v.includes('/grades/compute') && v.includes('/admin/grades?month='), 'grade policies and results wired');
});

await t.test('F5 remaining shells converted; audit log pages by period to CSV', async () => {
  const a = read('apps/admin/src/views/AuditLogView.vue');
  assert.ok(a.includes("q.set('from'") || a.includes('filters.from'), 'period filter sent');
  assert.ok(a.includes("q.set('format', 'csv')") && a.includes('admin_audit_log.csv'), 'csv export wired');
  for (const f of ['BusinessEntitiesView', 'SuppliersView', 'SupplierIntegrationView', 'ShippingZonesView', 'SecurityView', 'LoginView', 'LedgerAuditView']) {
    const src = read(`apps/admin/src/views/${f}.vue`);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), `${f} has no hex literals`);
    assert.ok(!/\b(?:alert|prompt)\s*\(/.test(src) && !/\bwindow\.confirm\s*\(/.test(src), `${f} has no native dialogs`);
  }
});

await t.test('F6 seller app matches web pipeline cards and confirm-then-ship', async () => {
  const d = read('mobile/partner_app/lib/views/dashboard_view.dart');
  assert.ok(d.includes('/api/v1/partner/dashboard/pipeline') || d.includes('fetchPipeline'), 'pipeline sourced');
  for (const s of ['신규 주문', '발송 대기', '배송 중', '취소 요청', '반품 요청', '교환 요청', '미답변 문의', '정산 예정금']) {
    assert.ok(d.includes(s), `card ${s} present`);
  }
  const s = read('mobile/partner_app/lib/views/shipment_view.dart');
  const api = read('mobile/partner_app/lib/services/partner_api_service.dart');
  assert.ok(s.includes('발주확인') && api.includes('/prepare'), 'confirm step present');
  assert.ok(s.includes('운송장 입력 및 출고'), 'ship step kept');
});

t.finish();
