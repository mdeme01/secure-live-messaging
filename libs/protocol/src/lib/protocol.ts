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

/** Create (POST) and end (DELETE `/{id}`) Sessions. */
export const SESSIONS_PATH = `${API_PREFIX}/sessions`;

export const LIMITS = {
  /** Largest accepted ciphertext (decoded bytes, including the GCM tag). */
  maxCiphertextBytes: 64 * 1024,
  /** Plaintext is padded to a multiple of this many bytes to hide its exact length. */
  paddingBlockBytes: 256,
} as const;

export const ErrorCode = {
  SessionNotFound: 'SESSION_NOT_FOUND',
  RoleTaken: 'ROLE_TAKEN',
  Unauthorized: 'UNAUTHORIZED',
  InvalidPayload: 'INVALID_PAYLOAD',
  PayloadTooLarge: 'PAYLOAD_TOO_LARGE',
  StaleSequence: 'STALE_SEQUENCE',
  CapacityReached: 'CAPACITY_REACHED',
  SessionExists: 'SESSION_EXISTS',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** An encrypted Update as it travels over the wire. Binary fields are base64url (no padding). */
export interface SealedUpdate {
  seq: number;
  iv: string;
  ciphertext: string;
}

export interface CreateSessionRequest {
  sessionId: string;
  update: SealedUpdate;
}

export interface CreateSessionResponse {
  senderToken: string;
}

export interface ErrorResponse {
  error: ErrorCode;
}

/** Encoded lengths (base64url, unpadded) of the fixed-size secrets and identifiers. */
export const ENCODED_LENGTH = {
  sessionId: 22, // 128 bits
  sessionKey: 43, // 256 bits
  senderToken: 43, // 256 bits
  iv: 16, // 96 bits
} as const;

const BASE64URL = /^[A-Za-z0-9_-]*$/;

function isBase64Url(value: unknown, length?: number): value is string {
  return (
    typeof value === 'string' &&
    BASE64URL.test(value) &&
    value.length % 4 !== 1 &&
    (length === undefined || value.length === length)
  );
}

export const isSessionId = (v: unknown): v is string => isBase64Url(v, ENCODED_LENGTH.sessionId);
export const isSessionKey = (v: unknown): v is string => isBase64Url(v, ENCODED_LENGTH.sessionKey);
export const isSenderToken = (v: unknown): v is string =>
  isBase64Url(v, ENCODED_LENGTH.senderToken);

/**
 * Checks the shape and size of a Sealed Update. Says nothing about authenticity:
 * only the Receiver, holding the Session Key, can verify that.
 * Returns null when valid, otherwise the error code to reply with.
 */
export function validateSealedUpdate(
  v: unknown,
): typeof ErrorCode.InvalidPayload | typeof ErrorCode.PayloadTooLarge | null {
  if (typeof v !== 'object' || v === null) return ErrorCode.InvalidPayload;
  const { seq, iv, ciphertext } = v as Record<string, unknown>;
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) {
    return ErrorCode.InvalidPayload;
  }
  if (!isBase64Url(iv, ENCODED_LENGTH.iv)) return ErrorCode.InvalidPayload;
  if (!isBase64Url(ciphertext) || ciphertext.length === 0) return ErrorCode.InvalidPayload;
  if (Math.floor((ciphertext.length * 3) / 4) > LIMITS.maxCiphertextBytes) {
    return ErrorCode.PayloadTooLarge;
  }
  return null;
}
