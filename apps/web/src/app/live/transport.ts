import { InjectionToken } from '@angular/core';
import type { JoinAck, JoinRequest, PublishAck, SealedUpdate } from '@slm/protocol';
import { socketIoTransport } from './socket-io-transport';

/**
 * The live channel as the controllers see it. Keeps socket.io out of the controllers
 * so they can be tested against a fake.
 */
export interface LiveTransport {
  /** Fires on every (re)connection; the controller (re)joins here. */
  onConnect(handler: () => void): void;
  onDisconnect(handler: () => void): void;
  onUpdate(handler: (update: SealedUpdate) => void): void;
  join(request: JoinRequest): Promise<JoinAck>;
  /** Rejects if the server does not acknowledge in time or the connection drops. */
  publish(update: SealedUpdate): Promise<PublishAck>;
  /** Starts connecting (and reconnecting automatically). Register handlers first. */
  connect(): void;
  /** Disconnects for good. */
  close(): void;
}

export interface TransportAuth {
  senderToken?: string;
}

export type LiveTransportFactory = (auth?: TransportAuth) => LiveTransport;

export const LIVE_TRANSPORT = new InjectionToken<LiveTransportFactory>('LIVE_TRANSPORT', {
  providedIn: 'root',
  factory: () => socketIoTransport,
});
