import {
  LIMITS,
  PROTOCOL_VERSION,
  isSessionKey,
  validateSealedUpdate,
  type SealedUpdate,
} from '@slm/protocol';
import { base64UrlDecode, base64UrlEncode } from './base64url';

const ALGORITHM = 'AES-GCM';
const KEY_BYTES = 32;
const SESSION_ID_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const LENGTH_PREFIX_BYTES = 4;

/** Longest Message (UTF-8 bytes) whose framed, padded, sealed form fits the ciphertext limit. */
export const MAX_MESSAGE_BYTES =
  Math.floor((LIMITS.maxCiphertextBytes - TAG_BYTES) / LIMITS.paddingBlockBytes) *
    LIMITS.paddingBlockBytes -
  LENGTH_PREFIX_BYTES;

export class MessageTooLongError extends Error {
  constructor(readonly bytes: number) {
    super(`Message is ${bytes} bytes; the limit is ${MAX_MESSAGE_BYTES}`);
    this.name = 'MessageTooLongError';
  }
}

export interface GeneratedSessionKey {
  /** base64url form, for the link fragment only. Never store it. */
  encoded: string;
  /** Non-extractable key used for sealing and opening. */
  key: CryptoKey;
}

export type IntegrityFailureReason = 'authentication-failed' | 'stale' | 'malformed';

export type OpenResult =
  { ok: true; seq: number; text: string } | { ok: false; reason: IntegrityFailureReason };

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function importRawKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, ALGORITHM, false, ['encrypt', 'decrypt']);
}

export async function generateSessionKey(): Promise<GeneratedSessionKey> {
  const raw = randomBytes(KEY_BYTES);
  const key = await importRawKey(raw);
  const encoded = base64UrlEncode(raw);
  raw.fill(0);
  return { encoded, key };
}

/** Imports a Session Key taken from a link fragment. Throws if it is malformed. */
export async function importSessionKey(encoded: string): Promise<CryptoKey> {
  if (!isSessionKey(encoded)) throw new TypeError('Malformed Session Key');
  return importRawKey(base64UrlDecode(encoded));
}

export function generateSessionId(): string {
  return base64UrlEncode(randomBytes(SESSION_ID_BYTES));
}

/** Binds a ciphertext to its Session and position, so it can't be spliced or reordered. */
function associatedData(sessionId: string, seq: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${PROTOCOL_VERSION}|${sessionId}|${seq}`);
}

/** 4-byte big-endian length + UTF-8 + zero padding to a whole number of blocks. */
function frame(text: string): Uint8Array<ArrayBuffer> {
  const utf8 = new TextEncoder().encode(text);
  if (utf8.length > MAX_MESSAGE_BYTES) throw new MessageTooLongError(utf8.length);
  const block = LIMITS.paddingBlockBytes;
  const size = Math.ceil((LENGTH_PREFIX_BYTES + utf8.length) / block) * block;
  const framed = new Uint8Array(size);
  new DataView(framed.buffer).setUint32(0, utf8.length);
  framed.set(utf8, LENGTH_PREFIX_BYTES);
  return framed;
}

/** Returns null if the authenticated plaintext doesn't follow the framing. */
function unframe(framed: Uint8Array<ArrayBuffer>): string | null {
  if (framed.length < LENGTH_PREFIX_BYTES) return null;
  const length = new DataView(framed.buffer).getUint32(0);
  if (length > framed.length - LENGTH_PREFIX_BYTES) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      framed.subarray(LENGTH_PREFIX_BYTES, LENGTH_PREFIX_BYTES + length),
    );
  } catch {
    return null;
  }
}

export async function sealUpdate(
  key: CryptoKey,
  sessionId: string,
  seq: number,
  text: string,
): Promise<SealedUpdate> {
  const plaintext = frame(text);
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, additionalData: associatedData(sessionId, seq) },
    key,
    plaintext,
  );
  return { seq, iv: base64UrlEncode(iv), ciphertext: base64UrlEncode(new Uint8Array(ciphertext)) };
}

/**
 * Verifies and decrypts an Update. Anything that is not an authentic Update for this Session
 * with a Sequence Number above `lastAcceptedSeq` is an Integrity Failure, never text.
 */
export async function openUpdate(
  key: CryptoKey,
  sessionId: string,
  lastAcceptedSeq: number | null,
  update: SealedUpdate,
): Promise<OpenResult> {
  if (validateSealedUpdate(update) !== null) return { ok: false, reason: 'malformed' };
  if (lastAcceptedSeq !== null && update.seq <= lastAcceptedSeq) {
    return { ok: false, reason: 'stale' };
  }

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: ALGORITHM,
        iv: base64UrlDecode(update.iv),
        additionalData: associatedData(sessionId, update.seq),
      },
      key,
      base64UrlDecode(update.ciphertext),
    );
  } catch {
    return { ok: false, reason: 'authentication-failed' };
  }

  const text = unframe(new Uint8Array(plaintext));
  return text === null ? { ok: false, reason: 'malformed' } : { ok: true, seq: update.seq, text };
}
