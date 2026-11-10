// apps/cloudflare-gateway/src/services/crawler/ai-translator.js
// Rule-based title localization for imported products.
//
// Honesty contract (NEW-02): this module NEVER invents product claims.
// It only translates the seller-supplied title with a fixed term dictionary.
// External LLM enhancement is NOT wired (no fetch exists here on purpose):
// callers always observe live_external_api_status = 'SKIPPED', and the seller
// must write the detail description themselves.

const TERM_DICTIONARY = {
  // Electronics & Gadgets
  'wireless': '무선',
  'bluetooth': '블루투스',
  'earbuds': '이어폰',
  'headphones': '헤드폰',
  'noise cancelling': '노이즈 캔슬링',
  'fast charging': '고속 충전',
  'vacuum cleaner': '진공 청소기',
  'portable': '휴대용',
  'waterproof': '방수',
  'rechargeable': '충전식',

  // Fashion & Apparel
  'seamless': '씸리스(무봉제)',
  'leggings': '레깅스',
  'high waist': '하이웨이스트',
  'running shoes': '러닝화',
  'sneakers': '스니커즈',
  'hoodie': '후드티',
  't-shirt': '티셔츠',
  'breathable': '통기성',
  'compression': '컴프레션(압박)',
  'quick dry': '속건성',

  // Colors
  'black': '블랙(검정)',
  'white': '화이트(화이트)',
  'navy': '네이비',
  'gray': '그레이',
  'grey': '그레이',
  'beige': '베이지',
  'red': '레드',
  'blue': '블루',
  'green': '그린',

  // Quality & Grades
  'pro': '프로',
  'plus': '플러스',
  'ultra': '울트라',
  'premium': '프리미엄'
};

export async function enhanceProductWithAi(product, { targetLang = 'KO', env = {} } = {}) {
  void env; // No external call exists: keys are never consulted, nothing is "completed" externally.
  const originalTitle = String(product.title || '').trim();
  const originalDesc = String(product.description_html || '').trim();

  // 1. Title Translation & Localization (fixed dictionary only)
  let localizedTitle = originalTitle;
  for (const [en, ko] of Object.entries(TERM_DICTIONARY)) {
    const regex = new RegExp(`\\b${en}\\b`, 'gi');
    localizedTitle = localizedTitle.replace(regex, ko);
  }

  // 2. No synthesized claims. Bullets stay empty and the description is
  // returned exactly as the seller supplied it ('' when missing) so the
  // seller writes it. Nothing here may imply verification, quality
  // inspection, or performance the product was never measured for.
  const highlights = [];
  const enhancedSummary = originalDesc;

  // 3. External AI status. No external call is ever made, so external
  // completion is never reported and no uncalled provider is ever named.
  return {
    success: true,
    source_language: 'EN',
    target_language: targetLang,
    original_title: originalTitle,
    translated_title: localizedTitle,
    enhanced_summary: enhancedSummary,
    bullets: highlights,
    provider: 'RULE_BASED_LOCALIZER',
    live_external_api_status: 'SKIPPED',
    note: '외부 GenAI 연동 없음: 타이틀 사전식 번역만 수행했고 상세설명은 원문 그대로 반환(SKIPPED). 상세설명은 판매자가 직접 입력해야 합니다.'
  };
}
