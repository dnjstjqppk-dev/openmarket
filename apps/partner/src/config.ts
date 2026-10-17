export const API_BASE = 'https://olmoa-api.dnjstjqppk.workers.dev';
export const PARTNER_ID = 'pt_001';
export const PARTNER_NAME = 'Global Direct Logistics Ltd.';

export function getPartnerHeaders(): Record<string, string> {
  const token = localStorage.getItem('partner_token') || 'olmoa_partner_jwt_mock_token_999';
  return {
    'X-Partner-Id': PARTNER_ID,
    'Authorization': `Bearer ${token}`
  };
}
