import type { Server as SocketServer } from 'socket.io';
import {
  ErrorCode,
  SocketEvent,
  isJoinRequest,
  type ClientToServerEvents,
  type JoinAck,
  type ServerToClientEvents,
} from '@slm/protocol';
import type { SessionStore } from './session-store';

export type LiveServer = SocketServer<ClientToServerEvents, ServerToClientEvents>;

/** Socket.io room holding everyone joined to a Session. */
export const sessionRoom = (sessionId: string) => `session:${sessionId}`;

export function registerLiveHandlers(io: LiveServer, store: SessionStore): void {
  io.on('connection', (socket) => {
    socket.on(SocketEvent.Join, (request, ack) => {
      if (typeof ack !== 'function') return;
      const reply = (response: JoinAck) => ack(response);

      if (!isJoinRequest(request) || request.role !== 'receiver') {
        return reply({ ok: false, error: ErrorCode.InvalidPayload });
      }
      const session = store.get(request.sessionId);
      if (!session) return reply({ ok: false, error: ErrorCode.SessionNotFound });

      void socket.join(sessionRoom(request.sessionId));
      reply({ ok: true, latest: session.latest });
    });
  });
}
