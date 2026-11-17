/**
 * Single source of truth for the wire contract between the web app and the server.
 * Every REST shape, socket event and limit is defined here so both sides stay in sync.
 */

/** Version of the wire contract. */
export const PROTOCOL_VERSION = 'slm/v1';

/** Prefix for all REST endpoints (proxied by the web dev server). */
export const API_PREFIX = '/api';

/** Path the socket.io endpoint is served on (proxied by the web dev server). */
export const SOCKET_PATH = '/socket.io';

/** Liveness endpoint. */
export const HEALTH_PATH = `${API_PREFIX}/health`;

export interface HealthResponse {
  status: 'ok';
  protocol: typeof PROTOCOL_VERSION;
}
