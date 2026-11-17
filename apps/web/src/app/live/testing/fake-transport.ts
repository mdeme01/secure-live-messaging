import type {
  JoinAck,
  JoinRequest,
  Presence,
  PublishAck,
  SealedUpdate,
  SessionEnded,
} from '@slm/protocol';
import type { LiveTransport } from '../transport';

/** In-memory LiveTransport for controller tests. Drive it with the simulate* methods. */
export class FakeTransport implements LiveTransport {
  readonly joins: JoinRequest[] = [];
  connected = false;
  closed = false;
  /** What the "server" answers to session:join. */
  joinResponse: (request: JoinRequest) => JoinAck = () => {
    throw new Error('FakeTransport: set joinResponse before connecting');
  };

  readonly published: SealedUpdate[] = [];
  /** What the "server" answers to update:publish; return a pending promise to hold the ack. */
  publishResponse: (update: SealedUpdate) => PublishAck | Promise<PublishAck> = () => ({
    ok: true,
  });

  private connectHandlers: Array<() => void> = [];
  private disconnectHandlers: Array<() => void> = [];
  private updateHandlers: Array<(update: SealedUpdate) => void> = [];
  private presenceHandlers: Array<(presence: Presence) => void> = [];
  private endedHandlers: Array<(ended: SessionEnded) => void> = [];

  onConnect(handler: () => void): void {
    this.connectHandlers.push(handler);
  }
  onDisconnect(handler: () => void): void {
    this.disconnectHandlers.push(handler);
  }
  onUpdate(handler: (update: SealedUpdate) => void): void {
    this.updateHandlers.push(handler);
  }
  onPresence(handler: (presence: Presence) => void): void {
    this.presenceHandlers.push(handler);
  }
  onEnded(handler: (ended: SessionEnded) => void): void {
    this.endedHandlers.push(handler);
  }
  async join(request: JoinRequest): Promise<JoinAck> {
    this.joins.push(request);
    return this.joinResponse(request);
  }
  async publish(update: SealedUpdate): Promise<PublishAck> {
    this.published.push(update);
    return this.publishResponse(update);
  }
  connect(): void {
    this.simulateConnect();
  }
  close(): void {
    this.closed = true;
    this.connected = false;
  }

  simulateConnect(): void {
    this.connected = true;
    this.connectHandlers.forEach((h) => h());
  }
  simulateDisconnect(): void {
    this.connected = false;
    this.disconnectHandlers.forEach((h) => h());
  }
  simulateUpdate(update: SealedUpdate): void {
    this.updateHandlers.forEach((h) => h(update));
  }
  simulatePresence(presence: Presence): void {
    this.presenceHandlers.forEach((h) => h(presence));
  }
  /** The server ends the Session: the event, then a server-side disconnect. */
  simulateEnded(ended: SessionEnded): void {
    this.endedHandlers.forEach((h) => h(ended));
    this.simulateDisconnect();
  }
}
