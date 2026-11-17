import { signal } from '@angular/core';
import {
  importSessionKey,
  isMessageTooLong,
  openUpdate,
  sealUpdate,
  type SenderLink,
} from '@slm/crypto';
import { ErrorCode } from '@slm/protocol';
import {
  FIRST_JOIN_RETRY_DELAYS_MS,
  joinSession,
  REJOIN_RETRY_DELAYS_MS,
  UNANSWERED_JOIN_RETRY_MS,
} from './join-session';
import type { LiveTransport } from './transport';

/** Typing pause before an edit is encrypted and sent. */
export const DEBOUNCE_MS = 300;

export type SenderStatus =
  | 'connecting'
  | 'ready'
  | 'sending'
  | 'sent'
  | 'too-long'
  | 'offline'
  | 'error'
  // Terminal: the controller has stopped and closed the transport.
  | 'not-found'
  | 'unauthorized'
  | 'role-taken'
  | 'unverifiable';

const TERMINAL: ReadonlySet<SenderStatus> = new Set([
  'not-found',
  'unauthorized',
  'role-taken',
  'unverifiable',
]);

export interface SenderControllerDeps {
  link: SenderLink;
  transport: LiveTransport;
  now?: () => Date;
}

const JOIN_ERROR_STATUS: Partial<Record<ErrorCode, SenderStatus>> = {
  [ErrorCode.SessionNotFound]: 'not-found',
  [ErrorCode.Unauthorized]: 'unauthorized',
  [ErrorCode.RoleTaken]: 'role-taken',
};

/**
 * Sender side of a Session. Edits are debounced, encrypted in the browser and published
 * one at a time; whatever the text is when the previous publish settles is what goes next
 * (latest wins). The server's latest Update is the source of truth for the next
 * Sequence Number, so a publish lost to a disconnect is reconciled on rejoin.
 */
export class SenderController {
  readonly status = signal<SenderStatus>('connecting');
  /** The editor contents. */
  readonly text = signal('');
  /** True once the editor holds the verified current Message and may be edited. */
  readonly editable = signal(false);
  /** When the server last acknowledged an Update from this tab (Sender's clock). */
  readonly lastSentAt = signal<Date | null>(null);
  /** Whether a Receiver is connected right now, as last reported by the server. */
  readonly receiverConnected = signal(false);

  private readonly link: SenderLink;
  private readonly transport: LiveTransport;
  private readonly now: () => Date;
  private key?: CryptoKey;
  /** Text and Sequence Number of the latest Update the server is known to hold. */
  private serverText: string | null = null;
  private nextSeq = 0;
  private joined = false;
  private hasJoined = false;
  private inFlight = false;
  /** Set after a resync with the server; a second stale/lost ack in a row is reported, not retried. */
  private resynced = false;
  private timer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  /** Bumped on every (dis)connect so a slow join or publish can tell it has been overtaken. */
  private connection = 0;

  constructor({ link, transport, now = () => new Date() }: SenderControllerDeps) {
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
    this.transport.onPresence(({ receiverConnected }) =>
      this.receiverConnected.set(receiverConnected),
    );
    this.transport.onDisconnect(() => {
      this.connection++;
      this.joined = false;
      this.receiverConnected.set(false); // Unknown until we rejoin.
      this.inFlight = false; // Abandoned; the rejoin tells us whether it landed.
      if (this.stopped() || this.status() === 'too-long') return;
      this.status.set(this.editable() ? 'offline' : 'connecting');
    });
    this.transport.connect();
  }

  setText(text: string): void {
    this.text.set(text);
    this.resynced = false;
    if (!this.editable() || this.stopped()) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (isMessageTooLong(text)) {
      this.status.set('too-long');
      return;
    }
    if (this.status() === 'too-long') this.status.set(this.idleStatus());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, DEBOUNCE_MS);
  }

  dispose(): void {
    this.disposed = true;
    this.connection++;
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    this.transport.close();
  }

  private async join(connection: number): Promise<void> {
    if (!this.key) return;
    let ack;
    try {
      ack = await joinSession(
        this.transport,
        { sessionId: this.link.sessionId, role: 'sender' },
        this.hasJoined ? REJOIN_RETRY_DELAYS_MS : FIRST_JOIN_RETRY_DELAYS_MS,
        () => connection === this.connection && !this.stopped(),
      );
    } catch {
      if (connection !== this.connection || this.stopped()) return; // The next connect rejoins.
      if (this.resynced) {
        // A resync that got no answer: let the next edit try again.
        this.joined = true;
        this.status.set('error');
        return;
      }
      this.retryTimer = setTimeout(() => void this.join(connection), UNANSWERED_JOIN_RETRY_MS);
      return;
    }
    if (!ack) return;
    if (!ack.ok) return this.stop(JOIN_ERROR_STATUS[ack.error] ?? 'error');
    this.hasJoined = true;
    if (ack.presence) this.receiverConnected.set(ack.presence.receiverConnected);

    const result = await openUpdate(this.key, this.link.sessionId, null, ack.latest);
    if (connection !== this.connection) return;
    if (!result.ok) {
      // Never overwrite a Message we cannot read: that would destroy it.
      return this.stop('unverifiable');
    }
    this.serverText = result.text;
    this.nextSeq = result.seq + 1;
    if (!this.editable()) {
      this.text.set(result.text);
      this.editable.set(true);
    }
    this.joined = true;
    if (isMessageTooLong(this.text())) this.status.set('too-long');
    else if (this.text() !== this.serverText) void this.flush();
    else this.status.set(this.idleStatus());
  }

  private async flush(): Promise<void> {
    if (!this.key || !this.joined || this.inFlight || this.stopped()) return;
    const text = this.text();
    if (isMessageTooLong(text)) return;
    if (text === this.serverText) {
      this.status.set(this.idleStatus());
      return;
    }

    const connection = this.connection;
    const seq = this.nextSeq;
    this.inFlight = true;
    this.status.set('sending');
    let outcome: 'sent' | 'failed' | 'out-of-sync';
    try {
      const update = await sealUpdate(this.key, this.link.sessionId, seq, text);
      try {
        const ack = await this.transport.publish(update);
        outcome = ack.ok
          ? 'sent'
          : ack.error === ErrorCode.StaleSequence
            ? 'out-of-sync'
            : 'failed';
      } catch {
        outcome = 'out-of-sync'; // No ack in time: the server may or may not have stored it.
      }
    } catch {
      outcome = 'failed';
    }
    if (connection !== this.connection || this.stopped()) return; // Abandoned by a disconnect.
    this.inFlight = false;

    if (outcome === 'out-of-sync') {
      if (!this.resynced) {
        // The server's latest Update is the source of truth: rejoin to learn it, then carry on.
        this.resynced = true;
        this.joined = false;
        return this.join(connection);
      }
      outcome = 'failed';
    }
    if (outcome === 'sent') {
      this.serverText = text;
      this.nextSeq = seq + 1;
      this.resynced = false;
      this.lastSentAt.set(this.now());
    }
    if (isMessageTooLong(this.text())) this.status.set('too-long');
    else this.status.set(outcome === 'sent' ? 'sent' : 'error');

    // Edits made meanwhile go now (latest wins), unless the user is still typing.
    if (this.timer === undefined && this.text() !== text) void this.flush();
  }

  private stop(status: SenderStatus): void {
    clearTimeout(this.timer);
    this.status.set(status);
    this.editable.set(false);
    this.transport.close();
  }

  private stopped(): boolean {
    return this.disposed || TERMINAL.has(this.status());
  }

  private idleStatus(): SenderStatus {
    if (!this.joined) return 'offline';
    return this.lastSentAt() ? 'sent' : 'ready';
  }
}
