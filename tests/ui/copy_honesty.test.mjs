// Marketing-copy honesty guard (P2R-02). The d1_12 seed once advertised rules
// the platform does not honour; d1_37 rewrote those rows and this test pins the
// fix across the live tables, locale dictionaries and rendered view text.
// Code comments may discuss the removed claims (they are stripped first).
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner, createGateway } from '../lib/harness.mjs'

const t = createRunner('Copy honesty')
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const BANNED = [
  '90일 무료반품',
  '90-Day Free Return',
  '90-Day Free Returns',
  '90日間無料返品',
  '무조건 무료배송',
  '최대 85%',
  '100,000원 웰컴',
  '100,000원 쿠폰팩',
  '첫 구매 20%',
  '최저가 도전',
  '공장직발송 최저가',
  '50% 이상 할인',
  '30-Day Price-Match',
  '최저가 차액보상',
  // P0 honesty wave: fabricated tracking/identity fallbacks and unverified SLA promises.
  '68492019342',
  '010-8282-5959',
  '올모아 타워',
  '관세청 검증',
  '올모아 무료직배송',
  'within 2 hours',
  '평균 24시간 이내',
  '24/7 Buyer Protection',
  // P2-S06: unmeasurable speed/fulfilment claims in OrdersView.
  '1초 원클릭',
  '공장 직발송',
  // P2-S16: the privacy-officer contact must come from /business-info, never hardcoded.
  'privacy@olmoa.com',
  // Work order 1-11: removed dummy copy, fake sample addresses and leftover 'example' markers.
  '홈으로 돌아가서',
  '선택된 상품이 없습니다',
  '선택된 상품들',
  '오늘의 특가',
  '공식 상품 영상이 없습니다',
  '메뉴를 불러오는 중입니다',
  '매출 통계를 불러오는 중',
  '예시',
  'example-supplier.com'
]

function checkClean(label, text) {
  for (const phrase of BANNED) {
    assert.ok(!text.includes(phrase), `${label} must not claim "${phrase}"`)
  }
}

// Rendered text only: strip HTML comments, JS line comments and block comments.
function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/(?![^"]*"(?:[^"]*"[^"]*")*[^"]*$).*/, ''))
    .join('\n')
}

function walk(dir, exts, out = []) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) walk(rel, exts, out)
    else if (exts.some((x) => e.name.endsWith(x))) out.push(rel)
  }
  return out
}

await t.test('C01 live banner/notification rows carry no unverified claims', async () => {
  const g = await createGateway({
    seedFiles: ['migrations/dev/seed_local_dev.sql'],
    env: {
      JWT_SECRET: 'e2e-secret-0123456789abcdefghijklmnopqrstu',
      ENVIRONMENT: 'development',
      CONNECTOR_SIMULATION: 'true',
      PAYMENT_MODE: 'sandbox'
    }
  })
  const rows = g.db
    .prepare("SELECT title || ' ' || subtitle AS t FROM banners WHERE is_active = 1")
    .all()
    .map((r) => r.t)
    .join('\n')
  const noti = g.db
    .prepare("SELECT title || ' ' || message AS t FROM notifications")
    .all()
    .map((r) => r.t)
    .join('\n')
  assert.ok(rows.length > 0, 'seed banners must exist to guard')
  checkClean('banners', rows)
  checkClean('notifications', noti)
  assert.ok(rows.includes('10,000원'), 'welcome banner keeps the real 10,000 credit')
})

await t.test('C02 locale dictionaries carry no unverified claims', async () => {
  for (const f of [
    'apps/storefront/src/locales/ko-KR.json',
    'apps/storefront/src/locales/en-US.json',
    'apps/storefront/src/locales/ja-JP.json',
    'packages/i18n/index.ts'
  ]) {
    checkClean(f, read(f))
  }
})

await t.test('C03 rendered view text carries no unverified claims', async () => {
  const files = [
    ...walk('apps/storefront/src', ['.vue']),
    ...walk('apps/admin/src', ['.vue']),
    ...walk('apps/partner/src', ['.vue']),
    ...walk('mobile/customer_app/lib', ['.dart']),
    ...walk('mobile/partner_app/lib', ['.dart'])
  ]
  assert.ok(files.length > 50, `expected dozens of view files, got ${files.length}`)
  for (const f of files) checkClean(f, stripComments(read(f)))
})

await t.test('C04 gateway FAQ source carries no unverified SLA promises', async () => {
  checkClean('features.js FAQ', read('apps/cloudflare-gateway/src/routes/features.js'))
})

await t.test('C05 privacy policy renders the officer contact from business-info', async () => {
  const v = read('apps/storefront/src/views/LegalPrivacyView.vue')
  assert.ok(!stripComments(v).includes('보호책임자: CPO'), 'officer name must not be hardcoded')
  assert.ok(v.includes('useBusinessStore') || v.includes('business-info'), 'officer contact must come from /business-info')
})

// ---- Work order 1-11: honest replacements ----
await t.test('H11-01 not-found names the requested page', async () => {
  const v = read('apps/storefront/src/views/NotFoundView.vue')
  assert.ok(v.includes('title="요청한 페이지를 찾을 수 없습니다"'), 'honest 404 title present')
  assert.ok(v.includes('data-empty'), 'empty marker present')
})

await t.test('H11-02 admin order empty names the selected filters', async () => {
  const v = read('apps/admin/src/views/orders/OrderListView.vue')
  assert.ok(v.includes('title="선택한 조건에 맞는 주문이 없습니다."'), 'filter-aware empty title present')
  assert.ok(v.includes('data-empty'), 'empty marker present')
})

await t.test('H11-03 seller product table marks loading, rows and empty', async () => {
  const v = read('apps/partner/src/views/products/ProductListView.vue')
  assert.ok(v.includes('상품을 불러오는 중입니다...'), 'honest loading copy present')
  assert.ok(v.includes('data-loading'), 'loading marker present')
  assert.ok(v.includes('data-row'), 'row marker present')
  assert.ok(v.includes('data-empty'), 'empty marker present')
})

await t.test('H11-04 placeholders show formats, never fake addresses', async () => {
  const u = read('apps/partner/src/views/UrlImportView.vue')
  assert.ok(!u.includes('example-supplier.com'), 'fake sample URLs gone from the import form')
  assert.ok(!u.includes('another-shop.com'), 'second fake sample URL gone')
  const p = read('apps/partner/src/views/ProfileManageView.vue')
  assert.ok(p.includes('placeholder="example@olmoa.com"'), 'seller email shows the standard format')
  // ProfileView keeps 010-1234-5678: S05 bans the 010-0000-0000 mask in that file.
  const a = read('apps/storefront/src/views/AddressesView.vue')
  assert.ok(a.includes('placeholder="010-0000-0000"'), 'AddressesView phone shows the format mask')
  assert.ok(!a.includes('010-1234-5678'), 'AddressesView realistic sample number gone')
})

await t.test('H11-05 search empty never prompts the buyer to register products', async () => {
  const v = read('apps/storefront/src/views/SearchView.vue')
  const block = v.split('<OmEmptyState')[1].split('</OmEmptyState>')[0]
  assert.ok(!block.includes('등록'), 'no registration prompt in the buyer empty state')
})

await t.test('H11-06 dev fixtures stay behind the DEV gate', async () => {
  for (const f of ['apps/storefront/src/views/LoginView.vue', 'apps/admin/src/views/LoginView.vue', 'apps/partner/src/views/LoginView.vue']) {
    assert.ok(read(f).includes('import.meta.env.DEV'), `${f} dev fill is DEV-gated`)
  }
  const u = read('apps/partner/src/views/UrlImportView.vue')
  assert.ok(u.includes('v-if="isDev"') && u.includes('env?.DEV'), 'sample presets are DEV-gated')
})

t.finish()
