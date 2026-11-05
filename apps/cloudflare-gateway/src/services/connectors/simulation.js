// apps/cloudflare-gateway/src/services/connectors/simulation.js
// None of the marketplace / supplier / 3PL connectors calls a real external API yet (they return canned data).
// A connector declares `isLive = true` only once it performs the real, contract-backed call. Until then:
//   * production (and any env without CONNECTOR_SIMULATION=true) -> 501 CONNECTOR_NOT_INTEGRATED, nothing persisted;
//   * development with CONNECTOR_SIMULATION=true -> runs the canned flow, every response says `simulated: true`.

import { HttpError } from '../../lib/http.js';

export function connectorSimulationAllowed(env) {
  return String(env.CONNECTOR_SIMULATION || '').toLowerCase() === 'true' && env.ENVIRONMENT !== 'production';
}

/** Returns { simulated } or throws 501. `connector.isLive` must be explicitly true for a real integration. */
export function assertConnectorUsable(env, connector, action) {
  if (connector && connector.isLive === true) return { simulated: false };
  if (connectorSimulationAllowed(env)) return { simulated: true };
  const name = (connector && connector.platformName) || '외부 플랫폼';
  throw new HttpError(501, 'CONNECTOR_NOT_INTEGRATED',
    `[${name}] ${action}: 외부 API 연동이 아직 구현되지 않았습니다. 플랫폼 API 계약과 실연동 전에는 사용할 수 없습니다.`);
}
