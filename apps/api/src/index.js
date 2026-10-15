// apps/api/src/index.js
// OpenMarket Unified Edge API Worker

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Idempotency-Key',
  'Content-Type': 'application/json; charset=utf-8'
};

const CATEGORIES_33 = [
  { id: 'cat-01', name: '여성 패션', slug: 'womens-clothing', depth: 0 },
  { id: 'cat-02', name: '남성 패션', slug: 'mens-clothing', depth: 0 },
  { id: 'cat-03', name: '신발 & 슈즈', slug: 'shoes-footwear', depth: 0 },
  { id: 'cat-04', name: '가방 & 캐리어', slug: 'bags-luggage', depth: 0 },
  { id: 'cat-05', name: '주얼리 & 액세서리', slug: 'jewelry-accessories', depth: 0 },
  { id: 'cat-06', name: '뷰티 & 스킨케어', slug: 'beauty-personal-care', depth: 0 },
  { id: 'cat-07', name: '홈 & 리빙', slug: 'home-kitchen', depth: 0 },
  { id: 'cat-08', name: '침구 & 패브릭', slug: 'bedding-bath', depth: 0 },
  { id: 'cat-09', name: '가구 & 인테리어', slug: 'furniture-interior', depth: 0 },
  { id: 'cat-10', name: '가전 & 생활전자기기', slug: 'home-appliances', depth: 0 },
  { id: 'cat-11', name: '디지털 & 컴퓨터', slug: 'electronics-computers', depth: 0 },
  { id: 'cat-12', name: '모바일 & 스마트기기', slug: 'cellphones-accessories', depth: 0 },
  { id: 'cat-13', name: '스마트홈 & IoT', slug: 'smart-home-iot', depth: 0 },
  { id: 'cat-14', name: '자동차 & 모빌리티', slug: 'automotive-motorcycle', depth: 0 },
  { id: 'cat-15', name: '스포츠 & 아웃도어', slug: 'sports-outdoors', depth: 0 },
  { id: 'cat-16', name: '헬스 & 피트니스', slug: 'health-fitness', depth: 0 },
  { id: 'cat-17', name: '완구 & 취미용품', slug: 'toys-hobbies', depth: 0 },
  { id: 'cat-18', name: '유아 & 출산육아', slug: 'baby-maternity', depth: 0 },
  { id: 'cat-19', name: '반려동물 용품', slug: 'pet-supplies', depth: 0 },
  { id: 'cat-20', name: '문구 & 오피스용품', slug: 'office-stationery', depth: 0 },
  { id: 'cat-21', name: '도서 & 미디어', slug: 'books-media', depth: 0 },
  { id: 'cat-22', name: '수예 & DIY 공예', slug: 'arts-crafts-sewing', depth: 0 },
  { id: 'cat-23', name: '공구 & 인테리어자재', slug: 'tools-home-improvement', depth: 0 },
  { id: 'cat-24', name: '가드닝 & 야외정원', slug: 'patio-lawn-garden', depth: 0 },
  { id: 'cat-25', name: '식음료 & 가공식품', slug: 'food-beverages', depth: 0 },
  { id: 'cat-26', name: '게이밍 & 콘솔', slug: 'video-games-gaming', depth: 0 },
  { id: 'cat-27', name: '음악 & 악기', slug: 'musical-instruments', depth: 0 },
  { id: 'cat-28', name: '보안 & 스마트감시', slug: 'security-surveillance', depth: 0 },
  { id: 'cat-29', name: '여행 & 아웃도어기어', slug: 'travel-outdoor-gear', depth: 0 },
  { id: 'cat-30', name: '시계 & 워치웨어', slug: 'watches-wearables', depth: 0 },
  { id: 'cat-31', name: '파티 & 시즌페스티벌', slug: 'holiday-party-supplies', depth: 0 },
  { id: 'cat-32', name: '산업 & 연구장비', slug: 'industrial-scientific', depth: 0 },
  { id: 'cat-33', name: '기프트 & e쿠폰', slug: 'giftcards-digital', depth: 0 }
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return new Response(JSON.stringify({
        status: 'UP',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        platform: 'Cloudflare Workers Edge',
        database: 'PostgreSQL 16 (BigInt Currency Engine)',
        cache: 'Redis 7 Lua Stock Deductor Active'
      }), { headers: corsHeaders });
    }

    // Auth Login
    if (url.pathname === '/api/v1/auth/login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const role = body.email?.includes('admin') ? 'ROLE_ADMIN' : body.email?.includes('seller') ? 'ROLE_PARTNER' : 'ROLE_CUSTOMER';
      return new Response(JSON.stringify({
        token: 'ey-mock-edge-jwt-' + crypto.randomUUID(),
        role,
        email: body.email,
        expiresIn: 86400
      }), { headers: corsHeaders });
    }

    // Categories
    if (url.pathname === '/api/v1/categories') {
      return new Response(JSON.stringify({
        total: CATEGORIES_33.length,
        items: CATEGORIES_33
      }), { headers: corsHeaders });
    }

    // Products catalog
    if (url.pathname === '/api/v1/products') {
      return new Response(JSON.stringify({
        items: [
          { id: 'p-1', brand: 'Anker Official', name: 'Soundcore Space Q45 ANC 헤드폰', price: 49900, stock: 120, category: 'electronics' },
          { id: 'p-2', brand: 'Baseus Korea', name: '블레이드 100W 초고속 보조배터리', price: 28900, stock: 85, category: 'electronics' },
          { id: 'p-3', brand: 'Urban Fit', name: '헤비웨이트 기모 오버핏 후드 집업', price: 19800, stock: 240, category: 'fashion' },
          { id: 'p-4', brand: 'Nordic Home', name: '호텔식 순면 베개커버 2P 세트', price: 9900, stock: 500, category: 'home' }
        ],
        total: 4
      }), { headers: corsHeaders });
    }

    // Orders Checkout (Split-Order Transaction)
    if (url.pathname === '/api/v1/orders/checkout' && request.method === 'POST') {
      const idempotencyKey = request.headers.get('X-Idempotency-Key') || crypto.randomUUID();
      return new Response(JSON.stringify({
        orderId: crypto.randomUUID(),
        idempotencyKey,
        paymentStatus: 'PAID',
        currency: 'KRW',
        totalItemAmount: 48800,
        totalShippingFee: 3000,
        totalPayAmount: 51800,
        subOrders: [
          { subOrderId: crypto.randomUUID(), partnerId: 'partner-anker', subTotal: 49900, shippingFee: 0, status: 'PAID' },
          { subOrderId: crypto.randomUUID(), partnerId: 'partner-baseus', subTotal: 28900, shippingFee: 2500, status: 'PAID' }
        ],
        createdAt: new Date().toISOString()
      }), { status: 201, headers: corsHeaders });
    }

    // Partner Sub-orders
    if (url.pathname === '/api/v1/partner/sub-orders') {
      return new Response(JSON.stringify({
        orders: [
          { id: 'SUB-ORD-9021', item: 'Space Q45 ANC 헤드폰', status: 'PREPARING', amount: 49900 },
          { id: 'SUB-ORD-8814', item: 'Nano Pro 30W 충전기 2개', status: 'SHIPPED', amount: 31800, tracking: '6891024819' }
        ]
      }), { headers: corsHeaders });
    }

    // Admin Ledger
    if (url.pathname === '/api/v1/admin/ledger') {
      return new Response(JSON.stringify({
        pgReceivable: 250000000,
        platformEscrow: 189400000,
        partnerPayable: 54540000,
        platformRevenue: 6060000,
        balanced: true
      }), { headers: corsHeaders });
    }

    // Admin SDUI layout
    if (url.pathname === '/api/v1/admin/sdui/layouts' || url.pathname === '/api/v1/home/sdui') {
      return new Response(JSON.stringify({
        targetPlatform: 'ALL',
        version: 5,
        blocks: [
          { type: 'LIGHTNING_FLASH_SALE', count: 12, timerSeconds: 15500 },
          { type: 'CATEGORY_CHIPS', count: 33 },
          { type: 'CURATED_PRODUCT_FEED', algorithm: 'temu-deep-recs' }
        ]
      }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: 'Not Found', path: url.pathname }), { status: 404, headers: corsHeaders });
  }
};
