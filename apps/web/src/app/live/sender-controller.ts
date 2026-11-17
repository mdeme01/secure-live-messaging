import { signal } from '@angular/core';
import {
  importSessionKey,
  MAX_MESSAGE_BYTES,
  MessageTooLongError,
  openUpdate,
  sealUpdate,
  type SenderLink,
} from '@slm/crypto';
import { ErrorCode } from '@slm/protocol';
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
  | 'unverifiable';

const TERMINAL: ReadonlySet<SenderStatus> = new Set(['not-found', 'unauthorized', 'unverifiable']);

export interface SenderControllerDeps {
  link: SenderLink;
  transport: LiveTransport;
  now?: () => Date;
}

const encoder = new TextEncoder();
const isTooLong = (text: string) => encoder.encode(text).length > MAX_MESSAGE_BYTES;

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

  private readonly link: SenderLink;
  private readonly transport: LiveTransport;
  private readonly now: () => Date;
  private key?: CryptoKey;
  /** Text and Sequence Number of the latest Update the server is known to hold. */
  private serverText: string | null = null;
  private nextSeq = 0;
  private joined = false;
  private inFlight = false;
  private timer?: ReturnType<typeof setTimeout>;
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
    this.transport.onDisconnect(() => {
      this.connection++;
      this.joined = false;
      this.inFlight = false; // Abandoned; the rejoin tells us whether it landed.
      if (!this.stopped()) this.status.set(this.editable() ? 'offline' : 'connecting');
    });
    this.transport.connect();
  }

  setText(text: string): void {
    this.text.set(text);
    if (!this.editable() || this.stopped()) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (isTooLong(text)) {
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
    this.transport.close();
  }

  private async join(connection: number): Promise<void> {
    if (!this.key) return;
    let ack;
    try {
      ack = await this.transport.join({ sessionId: this.link.sessionId, role: 'sender' });
    } catch {
      return; // The next reconnect joins again.
    }
    if (connection !== this.connection) return;
    if (!ack.ok) {
      const status =
        ack.error === ErrorCode.SessionNotFound
          ? 'not-found'
          : ack.error === ErrorCode.Unauthorized
            ? 'unauthorized'
            : 'error';
      return this.stop(status);
    }

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
    if (isTooLong(this.text())) this.status.set('too-long');
    else if (this.text() !== this.serverText) void this.flush();
    else this.status.set(this.idleStatus());
  }

  private async flush(): Promise<void> {
    if (!this.key || !this.joined || this.inFlight || this.stopped()) return;
    const text = this.text();
    if (isTooLong(text)) return;
    if (text === this.serverText) {
      this.status.set(this.idleStatus());
      return;
    }

    const connection = this.connection;
    const seq = this.nextSeq;
    this.inFlight = true;
    this.status.set('sending');
    let sent = false;
    try {
      const ack = await this.transport.publish(
        await sealUpdate(this.key, this.link.sessionId, seq, text),
      );
      if (connection !== this.connection) return;
      if (ack.ok) {
        this.serverText = text;
        this.nextSeq = seq + 1;
        this.lastSentAt.set(this.now());
        this.status.set('sent');
        sent = true;
      } else {
        this.status.set('error');
      }
    } catch (error) {
      if (connection !== this.connection) return;
      this.status.set(error instanceof MessageTooLongError ? 'too-long' : 'error');
    } finally {
      if (connection === this.connection) this.inFlight = false;
    }
    // Edits made while this was in flight go now, unless the user is still typing.
    if (sent && this.timer === undefined && this.text() !== this.serverText) void this.flush();
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
