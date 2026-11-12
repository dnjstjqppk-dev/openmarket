// apps/cloudflare-gateway/src/lib/remote-zones.js
// NEW-20: remote/island delivery zones by longest postal prefix (2-5 digits).
// Rows live in shipping_remote_zones (operator-managed); an unknown postal
// simply has no zone, never an error.

import { HttpError } from './http.js';

export async function resolveRemoteZone(env, postal) {
  const digits = String(postal || '').replace(/\D/g, '');
  if (digits.length < 2) return null;
  for (let len = Math.min(5, digits.length); len >= 2; len--) {
    const row = await env.DB.prepare(
      'SELECT postal_prefix, zone_name, surcharge_amount FROM shipping_remote_zones WHERE postal_prefix = ?'
    ).bind(digits.slice(0, len)).first();
    if (row) return row;
  }
  return null;
}

export function validateZoneInput(body) {
  const prefix = String(body.postal_prefix || '').trim();
  const name = String(body.zone_name || '').trim();
  const amount = body.surcharge_amount;
  if (!/^\d{2,5}$/.test(prefix)) throw new HttpError(400, 'INVALID_PREFIX', '우편번호 앞자리는 숫자 2-5자리여야 합니다.');
  if (!name || name.length > 40) throw new HttpError(400, 'INVALID_ZONE_NAME', '지역명을 40자 이내로 입력해 주세요.');
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100000) {
    throw new HttpError(400, 'INVALID_SURCHARGE', '추가배송비는 0-100,000원으로 입력해 주세요.');
  }
  return { prefix, name, amount };
}
