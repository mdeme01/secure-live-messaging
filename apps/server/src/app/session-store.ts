import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SealedUpdate } from '@slm/protocol';

/**
 * In-memory Sessions. Holds only what the server is allowed to know:
 * Session IDs, opaque ciphertext and a hash of the Sender Token.
 */
export interface StoredSession {
  senderTokenHash: Buffer;
  latest: SealedUpdate;
  /** Last create, join or publish (ms since epoch); idle expiry is measured from here. */
  lastActivityAt: number;
}

export type CreateResult =
  { ok: true; senderToken: string } | { ok: false; reason: 'exists' | 'full' };

export type PublishResult =
  { ok: true; latest: SealedUpdate } | { ok: false; reason: 'not-found' | 'stale' };

export interface SessionStoreOptions {
  maxSessions: number;
  now?: () => number;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest();

/** Keep only the wire fields, so nothing extra a client sent is ever stored or relayed. */
const toWireUpdate = ({ seq, iv, ciphertext }: SealedUpdate): SealedUpdate => ({
  seq,
  iv,
  ciphertext,
});

export class SessionStore {
  private readonly sessions = new Map<string, StoredSession>();

  private readonly maxSessions: number;
  private readonly now: () => number;

  constructor({ maxSessions, now = Date.now }: SessionStoreOptions) {
    this.maxSessions = maxSessions;
    this.now = now;
  }

  /** Creates a Session with its Update 0 and returns the freshly generated Sender Token. */
  create(sessionId: string, update0: SealedUpdate): CreateResult {
    if (this.sessions.has(sessionId)) return { ok: false, reason: 'exists' };
    if (this.sessions.size >= this.maxSessions) return { ok: false, reason: 'full' };
    const senderToken = randomBytes(32).toString('base64url');
    this.sessions.set(sessionId, {
      senderTokenHash: hashToken(senderToken),
      latest: toWireUpdate(update0),
      lastActivityAt: this.now(),
    });
    return { ok: true, senderToken };
  }

  /** Replaces the latest Update if this one is newer. */
  publish(sessionId: string, update: SealedUpdate): PublishResult {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: 'not-found' };
    if (update.seq <= session.latest.seq) return { ok: false, reason: 'stale' };
    session.latest = toWireUpdate(update);
    session.lastActivityAt = this.now();
    return { ok: true, latest: session.latest };
  }

  /** Records activity (e.g. a join) so the Session isn't considered idle. */
  touch(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.lastActivityAt = this.now();
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
