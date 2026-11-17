import type { JoinAck, JoinRequest, SealedUpdate } from '@slm/protocol';
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

  private connectHandlers: Array<() => void> = [];
  private disconnectHandlers: Array<() => void> = [];
  private updateHandlers: Array<(update: SealedUpdate) => void> = [];

  onConnect(handler: () => void): void {
    this.connectHandlers.push(handler);
  }
  onDisconnect(handler: () => void): void {
    this.disconnectHandlers.push(handler);
  }
  onUpdate(handler: (update: SealedUpdate) => void): void {
    this.updateHandlers.push(handler);
  }
  async join(request: JoinRequest): Promise<JoinAck> {
    this.joins.push(request);
    return this.joinResponse(request);
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
}
