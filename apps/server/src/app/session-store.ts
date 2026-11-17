import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SealedUpdate } from '@slm/protocol';

/**
 * In-memory Sessions. Holds only what the server is allowed to know:
 * Session IDs, opaque ciphertext and a hash of the Sender Token.
 */
export interface StoredSession {
  senderTokenHash: Buffer;
  latest: SealedUpdate;
}

export type CreateResult =
  { ok: true; senderToken: string } | { ok: false; reason: 'exists' | 'full' };

const hashToken = (token: string) => createHash('sha256').update(token).digest();

export class SessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  constructor(private readonly maxSessions: number) {}

  /** Creates a Session with its Update 0 and returns the freshly generated Sender Token. */
  create(sessionId: string, update0: SealedUpdate): CreateResult {
    if (this.sessions.has(sessionId)) return { ok: false, reason: 'exists' };
    if (this.sessions.size >= this.maxSessions) return { ok: false, reason: 'full' };
    const senderToken = randomBytes(32).toString('base64url');
    this.sessions.set(sessionId, { senderTokenHash: hashToken(senderToken), latest: update0 });
    return { ok: true, senderToken };
  }

  get(sessionId: string): StoredSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Constant-time check of a presented Sender Token against the stored hash. */
  isSender(sessionId: string, senderToken: string): boolean {
    const session = this.sessions.get(sessionId);
    return (
      session !== undefined && timingSafeEqual(session.senderTokenHash, hashToken(senderToken))
    );
  }
}
