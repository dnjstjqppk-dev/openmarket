// scripts/phase6-rehearsal-probe.mjs — 6-9 운영 반영 리허설 전후 비교표.
// Serves nothing; probes two already-running stacks (base worktree vs work
// branch: local API + vite preview each) and prints a before/after Markdown
// table for the 6-2~6-8 surface plus the 6-1 byte-identity contract.
//   BASE_API=http://127.0.0.1:8788 BASE_SF=http://127.0.0.1:4283 \
//   WORK_API=http://127.0.0.1:8787 WORK_SF=http://127.0.0.1:4183 \
//   node scripts/phase6-rehearsal-probe.mjs [--out <file.md>]
// Exit 0 always: this is a comparison, not a gate. Client-rendered heads
// (titles/robots/canonical) are covered by unit tests, not by this probe.
import fs from 'node:fs';

const BASE_API = process.env.BASE_API || 'http://127.0.0.1:8788';
const BASE_SF = process.env.BASE_SF || 'http://127.0.0.1:4283';
const WORK_API = process.env.WORK_API || 'http://127.0.0.1:8787';
const WORK_SF = process.env.WORK_SF || 'http://127.0.0.1:4183';

async function get(url, ms = 10000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    const text = await r.text();
    return { status: r.status, text, type: r.headers.get('content-type') || '' };
  } catch (e) {
    return { status: 0, text: `FETCH_FAIL:${String((e && e.message) || e).slice(0, 60)}`, type: '' };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveProduct(api) {
  try {
    const r = await get(`${api}/api/v1/products?limit=10`);
    const items = (JSON.parse(r.text).data || []);
    for (const it of items) {
      const id = it.slug || it.product_id || it.id;
      if (!id) continue;
      const c = await get(`${api}/api/crawl/product/${id}`);
      if (c.status === 200 && c.text.length > 100) return { id, crawl: c };
    }
    return { id: items[0] ? (items[0].slug || items[0].id) : null, crawl: null };
  } catch {
    return { id: null, crawl: null };
  }
}

async function resolveCategory(api) {
  try {
    const r = await get(`${api}/api/v1/categories`);
    const cats = (JSON.parse(r.text).data || []);
    return (cats[0] && (cats[0].slug || cats[0].id)) || null;
  } catch {
    return null;
  }
}

const kb = (s) => `${(Buffer.byteLength(s, 'utf8') / 1024).toFixed(1)}KB`;
const has = (s, sub) => String(s).includes(sub);

async function probeStack(api, sf) {
  const out = {};
  const health = await get(`${api}/health`);
  try {
    const j = JSON.parse(health.text);
    out.health = `${health.status} schema=${j.schemaVersion || j.schema_version || '?'}`;
  } catch { out.health = `${health.status} (본문 파싱 실패)`; }

  const { id, crawl } = await resolveProduct(api);
  out.productId = id || '(없음)';
  if (id && crawl) {
    const detail = await get(`${api}/api/v1/products/${id}`);
    let brief = null;
    try { brief = JSON.parse(detail.text).data?.brief_text ?? null; } catch { brief = null; }
    out.briefIdentity = brief === null ? '크롤 200, brief_text 없음' : (crawl.text === brief ? '바이트 동일 O' : '크롤≠brief_text X');
    out.crawl404 = (await get(`${api}/api/crawl/product/prod_missing_nope`)).status === 404 ? '404 O' : '404 아님 X';
    out.keyFacts = (() => {
      try {
        const kf = JSON.parse(detail.text).data?.key_facts_html;
        return typeof kf === 'string' && kf.includes('<') ? '있음 O' : '없음';
      } catch { return 'detail 파싱 실패'; }
    })();
    out.detailPrice = (() => {
      try {
        const d = JSON.parse(detail.text).data || {};
        return Number(d.lowest_sale_price ?? d.sale_price ?? NaN);
      } catch { return NaN; }
    })();
  } else if (id) {
    out.briefIdentity = '크롤 미제공(404)';
    out.crawl404 = (await get(`${api}/api/crawl/product/prod_missing_nope`)).status === 404 ? '404 O' : '404 아님 X';
    out.keyFacts = '크롤 미제공';
    out.detailPrice = NaN;
  } else {
    out.briefIdentity = '상품 목록 조회 실패'; out.crawl404 = '?'; out.keyFacts = '?'; out.detailPrice = NaN;
  }

  const slug = await resolveCategory(api);
  out.catSlug = slug || '(없음)';

  const llms = await get(`${api}/llms.txt`);
  out.llms = llms.status === 200
    ? `${llms.status} ${kb(llms.text)}${has(llms.text, '## 판매 정책') ? ' 정책O' : ''}${has(llms.text, '/llms/product/') ? ' 문서링크O' : ''}`
    : `${llms.status}`;
  const full = await get(`${api}/llms-full.txt`);
  out.llmsFull = full.status === 200
    ? `${full.status} ${kb(full.text)}${has(full.text, '## 정책 전문') ? ' 전문O' : ''}${has(full.text, '## 분류별 상품 요약') ? ' 요약O' : ''}`
    : `${full.status}`;
  if (id) {
    const md = await get(`${api}/llms/product/${id}.md`);
    let priceOk = '?';
    if (md.status === 200 && Number.isFinite(out.detailPrice)) {
      priceOk = has(md.text, Number(out.detailPrice).toLocaleString('ko-KR')) ? '가격일치 O' : '가격불일치 X';
    }
    out.prodMd = md.status === 200 ? `${md.status} ${kb(md.text)} ${priceOk}` : `${md.status}`;
  } else out.prodMd = '상품 없음';
  out.catMd = slug ? `${(await get(`${api}/llms/category/${slug}.md`)).status}` : '분류 없음';

  const robots = await get(`${api}/robots.txt`);
  if (robots.status === 200) {
    const groups = ['# SEARCH', '# AI_ANSWER', '# AI_TRAIN'].filter((g) => has(robots.text, g)).length;
    out.robots = `${groups}/3 묶음${has(robots.text, 'Content-Signal: search=yes, ai-input=yes, ai-train=yes') ? ' 신호O' : ' 신호X'}${has(robots.text, 'User-agent: GPTBot') ? ' 학습허용O' : ''}`;
  } else out.robots = `${robots.status}`;

  const keyFile = await get(`${api}/0f26d5e892544f74b806ec5c5522e6a1.txt`);
  out.keyFile = `${keyFile.status}${keyFile.status === 404 ? ' (키 없음, 정상)' : ''}`;
  const idx = await get(`${api}/sitemap-index.xml`);
  out.sitemap = idx.status === 200 ? `${idx.status} 항목 ${(idx.text.match(/<loc>/g) || []).length}개` : `${idx.status}`;

  const home = await get(`${sf}/`);
  out.shell = home.status === 200
    ? `${home.status}${has(home.text, '<html lang="ko">') ? ' langO' : ''}${has(home.text, 'hreflang="ko-KR"') ? ' ko-KR' : has(home.text, 'hreflang="ko"') ? ' ko(구)' : ''}${has(home.text, 'hreflang="x-default"') ? ' x-d' : ''}${has(home.text, '무료배송') || has(home.text, '가장 합리적인 가격') ? ' 마케팅문구X' : ''}`
    : `${home.status}`;
  const descOk = (() => {
    const m = home.text.match(/<meta name="description" content="([^"]*)"/);
    const t = home.text.match(/<meta property="twitter:description" content="([^"]*)"/);
    if (!m || !t) return '설명없음';
    return m[1] === t[1] ? '3종동일 O' : 'twitter상이';
  })();
  out.shellDesc = descOk;
  out.en = `${(await get(`${sf}/en`)).status}`;
  out.ja = `${(await get(`${sf}/ja`)).status}`;
  out.search = `${(await get(`${sf}/search?q=%EC%9D%B4%EC%96%B4%ED%8F%B0`)).status} (폴백 셸)`;
  return out;
}

const rows = [
  ['/health', 'health', ''],
  ['6-1 크롤 brief 바이트 동일', 'briefIdentity', ''],
  ['6-1 크롤 404', 'crawl404', ''],
  ['6-4 key_facts_html', 'keyFacts', ''],
  ['6-5 /llms.txt', 'llms', ''],
  ['6-5 /llms-full.txt', 'llmsFull', ''],
  ['6-5 /llms/product/:id.md', 'prodMd', ''],
  ['6-5 /llms/category/:slug.md', 'catMd', ''],
  ['6-6 /robots.txt', 'robots', ''],
  ['6-7 /<key>.txt (키 없음)', 'keyFile', ''],
  ['사이트맵 색인', 'sitemap', ''],
  ['6-8 셸 로케일', 'shell', ''],
  ['6-8 셸 설명 3종', 'shellDesc', ''],
  ['6-2 /en · /ja', null, ''],
  ['6-8 /search', 'search', '']
];

const before = await probeStack(BASE_API, BASE_SF);
const after = await probeStack(WORK_API, WORK_SF);
const line = (c) => `| ${c} | ${before[c] ?? ''} | ${after[c] ?? ''} |`;
let md = `# 6-9 리허설 전후 비교표

- 일시: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z / 원격 0건(로컬 스택 2개)
- 전(베이스): API ${BASE_API} + 스토어프론트 ${BASE_SF} (커밋 89bbf03 빌드)
- 후(작업): API ${WORK_API} + 스토어프론트 ${WORK_SF} (\`work-order/phase6\` 미커밋 빌드)
- 표본: 전 상품 \`${before.productId}\` / 분류 \`${before.catSlug}\`, 후 상품 \`${after.productId}\` / 분류 \`${after.catSlug}\` (각 스택 실측 첫 건)
- 클라이언트 렌더 헤드(제목·robots·canonical)는 단위 테스트 영역이라 본 표에서 제외

| 확인 | 전(89bbf03) | 후(phase6) |
|---|---|---|
`;
for (const [label, key] of rows) {
  if (key === null) {
    md += `| ${label} | ${before.en} · ${before.ja} (폴백 셸) | ${after.en} · ${after.ja} (미러 라우트, 단위핀 H05·H06) |\n`;
  } else {
    md += `| ${label} | ${before[key] ?? '?'} | ${after[key] ?? '?'} |\n`;
  }
}
md += `
로컬 apex 합성 안내: vite preview는 정적 셸만 내주므로 크롤 경로(/robots.txt·/sitemap*·/llms*)는
위 표에서 API에 직접 조회했다. 운영 apex 워커는 같은 경로를 API로 전달한다(A01·A02 핀).
`;
const outIdx = process.argv.indexOf('--out');
if (outIdx > 0 && process.argv[outIdx + 1]) {
  fs.writeFileSync(process.argv[outIdx + 1], md);
  console.log(`wrote ${process.argv[outIdx + 1]}`);
} else {
  console.log(md);
}
