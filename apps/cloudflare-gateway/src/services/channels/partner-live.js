// apps/cloudflare-gateway/src/services/channels/partner-live.js
// GAP-01: live delegation for partner multichannel flows (naver_smartstore /
// coupang_wing) to the real services/channels/* HTTP adapters.
//
// Design (keeps every legacy stub pin green):
//   * Legacy connector classes stay untouched (isLive false, stubs intact).
//     The router takes the live path only when the seller has a REAL
//     (non-sandbox) stored credential for a delegated platform; sandbox or
//     missing credentials keep the legacy simulated/501 behavior.
//   * Credentials are ALWAYS the seller's own decrypted platform keys merged
//     into a worker-env overlay — never operator-level env keys. Error texts
//     name missing fields only, never values.
//   * Live-wired but live-UNVERIFIED: no production keys exist yet, so
//     platform body schemas and intake field aliases below are built from the
//     adapter contracts + legacy NEW-04 rules and must be field-checked in
//     Wave I with real sandbox keys. Unknowns become explicit skips/errors,
//     never invented values.

import { bad, conflict, HttpError } from '../../lib/http.js';
import { buildNaverListingPayload } from '../connectors/naver-connector.js';
import { publish as smartstorePublish } from './smartstore-adapter.js';
import { publish as coupangPublish } from './coupang-adapter.js';
import { fetchPaidOrders as smartstoreProbe, fetchRawPaidOrders as smartstoreRaw, pushTracking as smartstoreTracking } from './smartstore-orders.js';
import { fetchPaidOrders as coupangProbe, fetchRawPaidOrders as coupangRaw, pushTracking as coupangTracking } from './coupang-orders.js';

/** Legacy platform id -> new channel adapter name. Everything else stays legacy. */
const LIVE_DELEGATED = { naver_smartstore: 'smartstore', coupang_wing: 'coupang' };

export function isLiveDelegated(platformId) {
  return Object.hasOwn(LIVE_DELEGATED, String(platformId || ''));
}

/** Live path only for stored, explicitly non-sandbox credentials. */
export function isLiveCredential(cred) {
  return !!cred && Number(cred.is_sandbox) === 0;
}

const FIELD_LABELS = {
  SMARTSTORE_CLIENT_ID: 'Client ID',
  SMARTSTORE_CLIENT_SECRET: 'Client Secret',
  COUPANG_ACCESS_KEY: 'Access Key',
  COUPANG_SECRET_KEY: 'Secret Key',
  COUPANG_VENDOR_ID: 'Vendor ID(판매자 계정 ID)'
};

/** Overlay the seller's decrypted keys onto worker env for one adapter call. */
export function sellerChannelEnv(env, platformId, creds) {
  const c = creds || {};
  if (platformId === 'naver_smartstore') {
    return { ...env, SMARTSTORE_CLIENT_ID: c.apiKey || '', SMARTSTORE_CLIENT_SECRET: c.secretKey || '' };
  }
  return {
    ...env,
    COUPANG_ACCESS_KEY: c.apiKey || '',
    COUPANG_SECRET_KEY: c.secretKey || '',
    COUPANG_VENDOR_ID: c.vendorId || c.sellerAccountId || ''
  };
}

/** Map adapter transport failures to honest HTTP errors (values never leak). */
export function toChannelHttpError(platformName, err) {
  const msg = String((err && err.message) || err || '');
  if (msg.startsWith('CHANNEL_NOT_CONFIGURED')) {
    const missing = Array.isArray(err.missing) ? err.missing : [];
    const labels = missing.map((k) => FIELD_LABELS[k] || k);
    return conflict('CREDENTIAL_INCOMPLETE',
      `[${platformName}] 인증정보 항목이 비어 있습니다${labels.length ? `: ${labels.join(', ')}` : ''}. 채널 인증정보를 보완해 주세요.`);
  }
  if (msg.startsWith('CHANNEL_AUTH')) {
    return conflict('CREDENTIAL_INVALID', `[${platformName}] 플랫폼에서 키를 거부했습니다. 키를 확인한 뒤 다시 검증해 주세요.`);
  }
  if (msg.startsWith('CHANNEL_RATELIMIT')) {
    return new HttpError(503, 'UPSTREAM_THROTTLED', `[${platformName}] 플랫폼 호출이 제한되었습니다. 잠시 후 다시 시도해 주세요.`);
  }
  if (msg.startsWith('UPSTREAM_BAD_SHAPE')) {
    return new HttpError(502, 'UPSTREAM_BAD_SHAPE', `[${platformName}] 플랫폼 응답 형식이 예상과 다릅니다.`);
  }
  if (msg.startsWith('UPSTREAM_') || /abort|timeout|timed out|fetch failed|network|econn|enotfound/i.test(msg)) {
    return new HttpError(502, 'UPSTREAM_ERROR', `[${platformName}] 플랫폼 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.`);
  }
  if (msg.startsWith('INVALID_TRACKING')) {
    return bad('TRACKING_REQUIRED', '택배사에서 발급받은 운송장 번호를 입력해 주세요.');
  }
  throw err;
}

/**
 * Verify seller keys with a side-effect-free live read. Only a platform
 * rejection marks keys invalid; anything inconclusive throws (never marks).
 */
export async function verifyLiveCredential(env, platformId, creds, platformName) {
  const liveEnv = sellerChannelEnv(env, platformId, creds);
  const probe = platformId === 'naver_smartstore' ? smartstoreProbe : coupangProbe;
  try {
    await probe(liveEnv, {});
    return { verified: true, message: `[${platformName}] 플랫폼 읽기 검증에 성공했습니다.` };
  } catch (e) {
    if (String((e && e.message) || '').startsWith('CHANNEL_AUTH')) {
      return { verified: false, message: `[${platformName}] 플랫폼에서 키를 거부했습니다. 키를 확인해 주세요.` };
    }
    throw toChannelHttpError(platformName, e);
  }
}

// Coupang honest listing builder (NEW-04 rules; the legacy stub builder
// invents category/brand/prices and must never feed a live call).
function buildCoupangListingPayload(input, vendorId) {
  const missing = [];
  const title = String(input.title || '').trim();
  if (!title) missing.push('title');
  const salePrice = Number(input.sale_price ?? input.channel_sale_price);
  if (!Number.isSafeInteger(salePrice) || salePrice <= 0) missing.push('sale_price');
  // No strikethrough when the seller gives no original price (explicit, not invented).
  const origRaw = Number(input.channel_original_price ?? input.original_price);
  const originalPrice = Number.isSafeInteger(origRaw) && origRaw > 0 ? origRaw : salePrice;
  const stockQuantity = Number(input.stock_quantity);
  if (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0) missing.push('stock_quantity');
  const brand = String(input.brand || '').trim();
  if (!brand) missing.push('brand');
  const categoryRaw = String(input.external_category_id || '').trim();
  if (!/^\d{1,10}$/.test(categoryRaw)) missing.push('external_category_id');
  const deliveryCompany = String(input.delivery_company || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,20}$/.test(deliveryCompany)) missing.push('delivery_company');
  const feeTypeRaw = String(input.delivery_fee_type || '').trim().toUpperCase();
  const feeType = { FREE: 'FREE', CHARGE: 'CHARGE', CONDITIONAL_FREE: 'CONDITIONAL_FREE', CONDITIONAL: 'CONDITIONAL_FREE' }[feeTypeRaw] || null;
  if (!feeType) missing.push('delivery_fee_type');
  const deliveryFee = Number(input.delivery_fee ?? 0);
  if (feeType === 'CHARGE' && (!Number.isSafeInteger(deliveryFee) || deliveryFee <= 0)) missing.push('delivery_fee');
  const freeThreshold = Number(input.free_shipping_threshold ?? 0);
  if (feeType === 'CONDITIONAL_FREE' && (!Number.isSafeInteger(freeThreshold) || freeThreshold <= 0)) missing.push('free_shipping_threshold');
  if (!vendorId) missing.push('vendor_id');

  if (missing.length > 0) return { ok: false, missing };

  const now = new Date().toISOString();
  const payload = {
    displayCategoryCode: Number(categoryRaw),
    sellerProductName: title.slice(0, 100),
    vendorId,
    // Publish click means "sell now"; platform convention expresses open-ended sale.
    saleStartedAt: now,
    saleEndedAt: '2099-12-31T23:59:59',
    brand,
    // Seller-direct fulfillment is this business model (not per-product data).
    deliveryMethod: 'AGENT_BUY',
    deliveryCompanyCode: deliveryCompany,
    deliveryChargeType: feeType,
    ...(feeType === 'CHARGE' ? { deliveryCharge: deliveryFee } : {}),
    ...(feeType === 'CONDITIONAL_FREE' ? { deliveryCharge: deliveryFee, freeConditionalAmount: freeThreshold } : {}),
    // Single-item mapping (Wave I: per-SKU variant expansion with live validation).
    items: [{
      itemName: title.slice(0, 100),
      originalPrice,
      salePrice,
      externalVendorSku: String(input.product_id || '').slice(0, 50)
    }]
  };
  return { ok: true, payload };
}

/**
 * Live publish. Throws mapped HttpError on validation/auth/upstream failure
 * (the route persists nothing then); returns the legacy-compatible success
 * shape otherwise. Listings start PENDING_REVIEW: the seller confirms the
 * live state on the platform.
 */
export async function publishLive({ env, platformId, platformName, creds, input, skuCount }) {
  const liveEnv = sellerChannelEnv(env, platformId, creds);
  if (platformId === 'naver_smartstore') {
    const built = buildNaverListingPayload(input);
    if (!built.ok) {
      throw bad('VALIDATION_ERROR', `네이버 상품 등록 필수값 누락: ${built.missing.join(', ')}. 누락된 값을 입력해야 외부 마켓에 등록할 수 있습니다.`);
    }
    try {
      const { externalId } = await smartstorePublish(liveEnv, built.payload);
      return {
        success: true, status: 'PENDING_REVIEW', external_product_id: externalId, channel_url: null,
        message: multiSkuNote(skuCount) || `[${platformName}] 등록 접수되었습니다. 플랫폼에서 노출 상태를 확인해 주세요.`
      };
    } catch (e) {
      throw toChannelHttpError(platformName, e);
    }
  }
  const vendorId = String(creds?.vendorId || creds?.sellerAccountId || '').trim();
  const built = buildCoupangListingPayload(input, vendorId);
  if (!built.ok) {
    throw bad('VALIDATION_ERROR', `쿠팡 상품 등록 필수값 누락: ${built.missing.join(', ')}. 누락된 값을 입력해야 외부 마켓에 등록할 수 있습니다.`);
  }
  try {
    const { externalId } = await coupangPublish(liveEnv, built.payload);
    return {
      success: true, status: 'PENDING_REVIEW', external_product_id: externalId, channel_url: null,
      message: multiSkuNote(skuCount) || `[${platformName}] 등록 접수되었습니다. 플랫폼에서 노출 상태를 확인해 주세요.`
    };
  } catch (e) {
    throw toChannelHttpError(platformName, e);
  }
}

function multiSkuNote(skuCount) {
  if (Number(skuCount) > 1) {
    return `옵션 ${skuCount}종이 단일 상품으로 등록됩니다. 옵션별 등록은 Wave I에서 지원됩니다.`;
  }
  return null;
}

const pick = (o, keys) => {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
};

// Map one raw platform row to the channel_orders insert shape. Rows missing a
// NOT NULL column are skipped with an explicit reason — never padded.
function mapLiveOrder(o) {
  const externalOrderId = String(pick(o, ['orderId', 'external_order_id']) || '').trim();
  if (!externalOrderId) return { skipped: true, reason: 'missing order id' };
  const missing = [];
  const no = pick(o, ['orderNo', 'orderNumber', 'external_order_no']);
  const buyer = pick(o, ['buyerName', 'ordererName', 'buyer']);
  const recipient = pick(o, ['recipientName', 'receiverName']);
  const address = pick(o, ['shippingAddress', 'address', 'receiverAddress']);
  if (buyer === undefined) missing.push('buyer_name');
  if (recipient === undefined) missing.push('recipient_name');
  if (address === undefined) missing.push('shipping_address');
  if (missing.length > 0) return { skipped: true, id: externalOrderId, reason: `incomplete platform row: ${missing.join(', ')}` };
  const items = (Array.isArray(o?.items) ? o.items : []).map((it) => ({
    external_sku_code: pick(it, ['external_sku_code', 'skuCode', 'sku']) ?? null,
    product_title: pick(it, ['product_title', 'productTitle', 'title', 'name', 'productName']) ?? null,
    quantity: Math.max(1, Math.round(Number(it?.quantity) || 1)),
    unit_price: Math.round(Number(it?.unit_price ?? it?.unitPrice ?? it?.price) || 0)
  })).filter((it) => it.product_title !== null);
  return {
    skipped: false,
    row: {
      external_order_id: externalOrderId,
      external_order_no: no !== undefined ? String(no) : externalOrderId,
      buyer_name: String(buyer),
      recipient_name: String(recipient),
      recipient_phone: pick(o, ['recipientPhone', 'receiverPhone', 'receiverMobile', 'ordererPhone']) ?? null,
      shipping_address: String(address),
      customs_id_pccc: pick(o, ['customsIdPccc', 'pccc', 'customs_id_pccc']) ?? null,
      total_order_amount: Number(o?.totalAmount ?? o?.total_order_amount),
      currency: pick(o, ['currency']) ?? 'KRW',
      items
    }
  };
}

/** Live order poll. Returns clean rows plus explicit skips (route inserts rows). */
export async function syncLiveOrders(env, platformId, platformName, creds) {
  const liveEnv = sellerChannelEnv(env, platformId, creds);
  const fetchRaw = platformId === 'naver_smartstore' ? smartstoreRaw : coupangRaw;
  let list;
  try {
    list = await fetchRaw(liveEnv, {});
  } catch (e) {
    throw toChannelHttpError(platformName, e);
  }
  const orders = [];
  const skipped = [];
  for (const o of list) {
    const m = mapLiveOrder(o);
    if (m.skipped) skipped.push({ id: m.id || null, reason: m.reason });
    else orders.push(m.row);
  }
  return { orders, skipped };
}

/** Live tracking push (route pre-validates carrier + tracking format). */
export async function fulfillLiveOrder(env, platformId, platformName, creds, { external_order_id, tracking_number, carrier_code }) {
  const liveEnv = sellerChannelEnv(env, platformId, creds);
  const push = platformId === 'naver_smartstore' ? smartstoreTracking : coupangTracking;
  try {
    await push(liveEnv, external_order_id, { carrier: carrier_code, trackingNo: tracking_number });
    return { success: true };
  } catch (e) {
    throw toChannelHttpError(platformName, e);
  }
}
