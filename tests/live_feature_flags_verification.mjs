// Live verification of Feature Flags and Remote API
import assert from 'node:assert';

const API_BASE = 'https://olmoa-api.dnjstjqppk.workers.dev';

async function main() {
  console.log('--- Verifying Live Remote APIs on ' + API_BASE + ' ---');

  // 1. Health check
  const healthRes = await fetch(`${API_BASE}/health`);
  const healthData = await healthRes.json();
  console.log('[PASS] 1. /health:', healthData.status, 'DB:', healthData.databaseStatus);
  assert.strictEqual(healthData.status, 'UP');
  assert.strictEqual(healthData.databaseStatus, 'CONNECTED_D1');

  // 2. Public Feature Flags
  const pubFlagsRes = await fetch(`${API_BASE}/api/v1/feature-flags/public`);
  const pubFlagsData = await pubFlagsRes.json();
  const flagKeys = Object.keys(pubFlagsData.features || {});
  console.log('[PASS] 2. /api/v1/feature-flags/public features count:', flagKeys.length);
  assert(flagKeys.length >= 9, 'Expected at least 9 flags');
  for (const k of flagKeys) {
    const f = pubFlagsData.features[k];
    console.log(` - Flag [${k.padEnd(18)}]: ${f.is_enabled ? 'ON ' : 'OFF'} | Name: ${f.name}`);
  }
  assert.strictEqual(pubFlagsData.features.url_crawler.is_enabled, true);
  assert.strictEqual(pubFlagsData.features.auto_supplier_po.is_enabled, false);

  // 3. Partner login and check single URL crawl
  const partnerLoginRes = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'seller@temu-supply.com', password: 'DevPass!2026#', role: 'PARTNER' })
  });
  const partnerLoginData = await partnerLoginRes.json();
  assert(partnerLoginData.token, 'Partner login failed: ' + JSON.stringify(partnerLoginData));
  console.log('[PASS] 3. Partner login succeeded, token length:', partnerLoginData.token.length);

  const crawlRes = await fetch(`${API_BASE}/api/v1/imports/crawl`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${partnerLoginData.token}`
    },
    body: JSON.stringify({
      url: 'https://demo-activewear.myshopify.com/products/core-seamless-leggings',
      html_override: `<!DOCTYPE html><html><head>
        <meta property="og:title" content="테스트 스포츠 레깅스" />
        <meta property="og:description" content="고탄력 고기능성 요가 레깅스" />
        <meta property="og:image" content="https://images.unsplash.com/photo-1506629082955-511b1aa562c8" />
        <script>var meta = {"product":{"id":78921,"variants":[{"id":101,"title":"Black / S","price":39000,"compare_at_price":49000,"sku":"LEG-BLK-S","available":true}]}};</` + `script>
      </head></html>`,
      pricing_rule: { margin_bps: 2500, min_margin_krw: 3000, rounding_unit: 100 }
    })
  });
  const crawlData = await crawlRes.json();
  console.log('[PASS] 4. Live Crawl Response: success =', crawlData.success, 'job_id =', crawlData.job_id, 'quality =', crawlData.data?.quality_score);
  assert.strictEqual(crawlData.success, true);
  assert(crawlData.job_id);

  // 4. Feature Flag Guard Enforcement: bulk_crawler is currently OFF in production
  const bulkRes = await fetch(`${API_BASE}/api/v1/imports/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${partnerLoginData.token}`
    },
    body: JSON.stringify({
      urls: ['https://example.com/p1', 'https://example.com/p2']
    })
  });
  const bulkData = await bulkRes.json();
  console.log('[PASS] 5. Feature Flag Guard on bulk_crawler: status =', bulkRes.status, 'code =', bulkData.code);
  assert.strictEqual(bulkRes.status, 403);
  assert.strictEqual(bulkData.code, 'FEATURE_DISABLED');

  // 5. Admin Security Policy (O11): Admin requires 2FA in production
  const adminLoginRes = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@openmarket.com', password: 'DevPass!2026#', role: 'ADMIN' })
  });
  const adminLoginData = await adminLoginRes.json();
  assert(adminLoginData.token, 'Admin login failed');

  const adminFlagsRes = await fetch(`${API_BASE}/api/v1/admin/feature-flags`, {
    headers: { 'Authorization': `Bearer ${adminLoginData.token}` }
  });
  const adminFlagsData = await adminFlagsRes.json();
  console.log('[PASS] 6. Admin 2FA Protection: status =', adminFlagsRes.status, 'code =', adminFlagsData.code);
  assert.strictEqual(adminFlagsRes.status, 403);
  assert.strictEqual(adminFlagsData.code, 'ADMIN_2FA_SETUP_REQUIRED');

  console.log('=== ALL REMOTE LIVE VERIFICATIONS PASSED 100% ===');
}

main().catch(err => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
