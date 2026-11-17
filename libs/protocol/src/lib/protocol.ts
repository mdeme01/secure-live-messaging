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

/** Session collection: `POST` creates a Session. */
export const SESSIONS_PATH = `${API_PREFIX}/sessions`;

/** One Session: `DELETE` ends it, authorized by `Authorization: Bearer {senderToken}`. */
export const sessionPath = (sessionId: string) => `${SESSIONS_PATH}/${sessionId}`;

/** A Session with no create, join or publish for this long is deleted. */
export const IDLE_TIMEOUT_MS = 60 * 60 * 1000;

export const LIMITS = {
  /** Largest accepted ciphertext (decoded bytes, including the GCM tag). */
  maxCiphertextBytes: 64 * 1024,
  /** Plaintext is padded to a multiple of this many bytes to hide its exact length. */
  paddingBlockBytes: 256,
  /** Smallest possible ciphertext: one padding block plus the 16-byte GCM tag. */
  minCiphertextBytes: 256 + 16,
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

/** Unpadded base64url, optionally of an exact encoded length. */
export function isBase64Url(value: unknown, length?: number): value is string {
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
  if (!isBase64Url(ciphertext)) return ErrorCode.InvalidPayload;
  const bytes = Math.floor((ciphertext.length * 3) / 4);
  if (bytes > LIMITS.maxCiphertextBytes) return ErrorCode.PayloadTooLarge;
  if (bytes < LIMITS.minCiphertextBytes) return ErrorCode.InvalidPayload;
  return null;
}

// ---------------------------------------------------------------------------
// Live channel (socket.io, default namespace)
// ---------------------------------------------------------------------------

export const SocketEvent = {
  /** client → server, with ack: join a Session in a role. */
  Join: 'session:join',
  /** client → server, with ack: the Sender publishes a new Update. */
  Publish: 'update:publish',
  /** server → client: a new latest Update. */
  Update: 'update',
  /** server → Sender: whether a Receiver is connected. */
  Presence: 'presence',
  /** server → both: the Session was deleted; the server disconnects right after. */
  Ended: 'session:ended',
} as const;

/**
 * Server heartbeat. A connection that vanished without closing is noticed (and its role
 * slot freed) within pingIntervalMs + pingTimeoutMs; clients size their retries on it.
 */
export const HEARTBEAT = { pingIntervalMs: 10_000, pingTimeoutMs: 5_000 } as const;

export type Role = 'sender' | 'receiver';

export interface JoinRequest {
  sessionId: string;
  role: Role;
}

export interface Presence {
  receiverConnected: boolean;
}

export type EndReason = 'ended-by-sender' | 'expired';

export interface SessionEnded {
  reason: EndReason;
}

/** `presence` is included for the Sender only. */
export type JoinAck =
  { ok: true; latest: SealedUpdate; presence?: Presence } | { ok: false; error: ErrorCode };

export type PublishAck = { ok: true } | { ok: false; error: ErrorCode };

/** socket.io handshake `auth` payload. The Sender Token never goes in the URL. */
export interface HandshakeAuth {
  senderToken?: string;
}

/** Typed event maps for socket.io on both sides. */
export interface ClientToServerEvents {
  [SocketEvent.Join]: (request: JoinRequest, ack: (response: JoinAck) => void) => void;
  [SocketEvent.Publish]: (update: SealedUpdate, ack: (response: PublishAck) => void) => void;
}

export interface ServerToClientEvents {
  [SocketEvent.Update]: (update: SealedUpdate) => void;
  [SocketEvent.Presence]: (presence: Presence) => void;
  [SocketEvent.Ended]: (ended: SessionEnded) => void;
}

export function isJoinRequest(v: unknown): v is JoinRequest {
  if (typeof v !== 'object' || v === null) return false;
  const { sessionId, role } = v as Record<string, unknown>;
  return isSessionId(sessionId) && (role === 'sender' || role === 'receiver');
}
