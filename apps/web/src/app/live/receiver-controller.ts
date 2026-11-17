import { signal } from '@angular/core';
import {
  importSessionKey,
  openUpdate,
  type IntegrityFailureReason,
  type ReceiverLink,
} from '@slm/crypto';
import { ErrorCode, type SealedUpdate } from '@slm/protocol';
import {
  FIRST_JOIN_RETRY_DELAYS_MS,
  joinSession,
  REJOIN_RETRY_DELAYS_MS,
  UNANSWERED_JOIN_RETRY_MS,
} from './join-session';
import type { LiveTransport } from './transport';

export type ReceiverStatus =
  'connecting' | 'live' | 'reconnecting' | 'not-found' | 'role-taken' | 'error';

const JOIN_ERROR_STATUS: Partial<Record<ErrorCode, ReceiverStatus>> = {
  [ErrorCode.SessionNotFound]: 'not-found',
  [ErrorCode.RoleTaken]: 'role-taken',
};

export interface ReceiverControllerDeps {
  link: ReceiverLink;
  transport: LiveTransport;
  now?: () => Date;
}

/**
 * Receiver side of a Session. Every Update, whether from the join ack or pushed live,
 * goes through one verify path; only authentic, newer Updates ever become the Message.
 */
export class ReceiverController {
  readonly status = signal<ReceiverStatus>('connecting');
  /** Last verified Message; null until the first one is verified. */
  readonly message = signal<string | null>(null);
  /** When the Receiver accepted the current Message (Receiver's clock). */
  readonly lastUpdatedAt = signal<Date | null>(null);
  /** Why the most recent Update was rejected; cleared by the next verified Update. */
  readonly integrityFailure = signal<IntegrityFailureReason | null>(null);

  private readonly link: ReceiverLink;
  private readonly transport: LiveTransport;
  private readonly now: () => Date;
  private key?: CryptoKey;
  private lastAcceptedSeq: number | null = null;
  private disposed = false;
  private hasJoined = false;
  /** Bumped on every (dis)connect so a slow join can tell it has been overtaken. */
  private connection = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  /** Opening is async; chaining keeps Updates verified in arrival order. */
  private queue: Promise<void> = Promise.resolve();

  constructor({ link, transport, now = () => new Date() }: ReceiverControllerDeps) {
    this.link = link;
    this.transport = transport;
    this.now = now;
  }

  async start(): Promise<void> {
    try {
      this.key = await importSessionKey(this.link.sessionKey);
    } catch {
      this.status.set('error');
      return;
    }
    if (this.disposed) return;
    this.transport.onConnect(() => void this.join(++this.connection));
    this.transport.onDisconnect(() => {
      this.connection++;
      if (this.status() === 'live' || this.status() === 'connecting') {
        this.status.set(this.status() === 'live' ? 'reconnecting' : 'connecting');
      }
    });
    this.transport.onUpdate((update) => void this.enqueue(update));
    this.transport.connect();
  }

  dispose(): void {
    this.disposed = true;
    this.connection++;
    clearTimeout(this.retryTimer);
    this.transport.close();
  }

  private async join(connection: number): Promise<void> {
    let ack;
    try {
      ack = await joinSession(
        this.transport,
        { sessionId: this.link.sessionId, role: 'receiver' },
        this.hasJoined ? REJOIN_RETRY_DELAYS_MS : FIRST_JOIN_RETRY_DELAYS_MS,
        () => connection === this.connection && !this.disposed,
      );
    } catch {
      if (connection !== this.connection || this.disposed) return; // The next connect rejoins.
      this.retryTimer = setTimeout(() => void this.join(connection), UNANSWERED_JOIN_RETRY_MS);
      return;
    }
    if (!ack) return;
    if (!ack.ok) {
      this.status.set(JOIN_ERROR_STATUS[ack.error] ?? 'error');
      this.transport.close();
      return;
    }
    this.hasJoined = true;
    await this.enqueue(ack.latest);
    if (connection === this.connection) this.status.set('live');
  }

  private enqueue(update: SealedUpdate): Promise<void> {
    // accept() never throws today; the catch keeps one bad Update from stalling all later ones.
    this.queue = this.queue.then(() => this.accept(update)).catch(() => undefined);
    return this.queue;
  }

  private async accept(update: SealedUpdate): Promise<void> {
    if (!this.key) return;
    const result = await openUpdate(this.key, this.link.sessionId, this.lastAcceptedSeq, update);
    if (result.ok) {
      this.lastAcceptedSeq = result.seq;
      this.message.set(result.text);
      this.lastUpdatedAt.set(this.now());
      this.integrityFailure.set(null);
    } else if (result.reason !== 'already-seen') {
      this.integrityFailure.set(result.reason);
    }
  }
}
