import { io, type Socket } from 'socket.io-client';
import {
  SOCKET_PATH,
  SocketEvent,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@slm/protocol';
import type { LiveTransport, TransportAuth } from './transport';

const ACK_TIMEOUT_MS = 10_000;

/** Same-origin socket.io connection. The Sender Token travels in the handshake `auth`, never the URL. */
export function socketIoTransport(auth: TransportAuth = {}): LiveTransport {
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
    path: SOCKET_PATH,
    transports: ['websocket'],
    auth: { ...auth },
    autoConnect: false,
  });

  return {
    onConnect: (handler) => socket.on('connect', handler),
    onDisconnect: (handler) => socket.on('disconnect', () => handler()),
    onUpdate: (handler) => socket.on(SocketEvent.Update, handler),
    onPresence: (handler) => socket.on(SocketEvent.Presence, handler),
    onEnded: (handler) => socket.on(SocketEvent.Ended, handler),
    join: (request) => socket.timeout(ACK_TIMEOUT_MS).emitWithAck(SocketEvent.Join, request),
    publish: (update) => socket.timeout(ACK_TIMEOUT_MS).emitWithAck(SocketEvent.Publish, update),
    connect: () => socket.connect(),
    close: () => socket.disconnect(),
  };
}
