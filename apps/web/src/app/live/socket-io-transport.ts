import { io, type Socket } from 'socket.io-client';
import {
  SOCKET_PATH,
  SocketEvent,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@slm/protocol';
import type { LiveTransport, TransportAuth } from './transport';

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
    join: (request) => socket.emitWithAck(SocketEvent.Join, request),
    connect: () => socket.connect(),
    close: () => socket.disconnect(),
  };
}
