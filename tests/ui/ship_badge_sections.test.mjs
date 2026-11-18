// tests/ui/ship_badge_sections.test.mjs
// Ship-badge console: route/menu wiring, API contracts and dialog/token rules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRunner } from '../lib/harness.mjs';

const t = createRunner('Ship badge sections (admin console)');
const read = (p) => readFileSync(p, 'utf8');

await t.test('F1 console screen is routed and reachable from the menu', async () => {
  const r = read('apps/admin/src/router/index.ts');
  assert.ok(r.includes("path: '/shipping/badges'"), 'screen routed');
  assert.ok(r.includes('ShipBadgePolicyView'), 'view wired');
  assert.ok(r.includes("'SUPER_ADMIN', 'FINANCE', 'OPERATIONS'"), 'ops + finance roles see it');
  const m = read('apps/admin/src/App.vue');
  assert.ok(m.includes("to: \"/shipping/badges\"") && m.includes('출고 뱃지 정책'), 'menu entry present');
});

await t.test('F2 screen reads policies, board and history; edits cutoffs', async () => {
  const v = read('apps/admin/src/views/shipping/ShipBadgePolicyView.vue');
  assert.ok(v.includes('/api/v1/admin/platform-policies'), 'policy list reused');
  assert.ok(v.includes('/api/v1/admin/ship-badges/sellers'), 'board read');
  assert.ok(v.includes('platform-policies/history'), 'history read');
  assert.ok(v.includes('/shipping-cutoff'), 'cutoff edit wired');
  assert.ok(v.includes("params.set('q'") && v.includes('per_page'), 'search and paging sent');
  assert.ok(v.includes('badge.today_ship_min_rate_bps') && v.includes('badge.tomorrow_ship_enabled'), 'both keys managed');
});

await t.test('F3 edits validate ranges, clocks and forward-only dates', async () => {
  const v = read('apps/admin/src/views/shipping/ShipBadgePolicyView.vue');
  assert.ok(v.includes('0~10000') && v.includes('10000'), 'bps range guarded');
  assert.ok(v.includes('([01]\\d|2[0-3]):[0-5]\\d'), 'cutoff clock validated');
  assert.ok(v.includes('오늘 이후'), 'no-backdate guarded');
  assert.ok(v.includes('useConfirm') && v.includes('askConfirm'), 'confirm before save');
});

await t.test('F4 screen keeps dialog, icon and token rules', async () => {
  const v = read('apps/admin/src/views/shipping/ShipBadgePolicyView.vue');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(v), 'no hex literals');
  assert.ok(!/\b(?:alert|prompt)\s*\(/.test(v) && !/\bwindow\.confirm\s*\(/.test(v), 'no native dialogs');
  assert.ok(!/fa-(solid|regular|brands)/.test(v), 'no font-awesome');
  assert.ok(v.includes('useToast') && v.includes('OmModal') && v.includes('OmSkeleton'), 'shared dialog/loading primitives');
  assert.ok(v.includes('OmEmptyState'), 'empty state present');
});

t.finish();
