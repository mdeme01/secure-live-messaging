import type { Server as SocketServer } from 'socket.io';
import {
  ErrorCode,
  SocketEvent,
  isJoinRequest,
  isSenderToken,
  validateSealedUpdate,
  type ClientToServerEvents,
  type HandshakeAuth,
  type Role,
  type ServerToClientEvents,
} from '@slm/protocol';
import type { SessionStore } from './session-store';

/** What the server remembers about a socket once it has joined. */
export interface SocketData {
  sessionId: string;
  role: Role;
}

export type LiveServer = SocketServer<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  Partial<SocketData>
>;

/** Socket.io room holding everyone joined to a Session. */
export const sessionRoom = (sessionId: string) => `session:${sessionId}`;

export function registerLiveHandlers(io: LiveServer, store: SessionStore): void {
  io.on('connection', (socket) => {
    const { senderToken } = (socket.handshake.auth ?? {}) as HandshakeAuth;

    socket.on(SocketEvent.Join, (request, ack) => {
      if (typeof ack !== 'function') return;
      if (!isJoinRequest(request)) return ack({ ok: false, error: ErrorCode.InvalidPayload });

      const session = store.get(request.sessionId);
      if (!session) return ack({ ok: false, error: ErrorCode.SessionNotFound });
      if (
        request.role === 'sender' &&
        !(isSenderToken(senderToken) && store.isSender(request.sessionId, senderToken))
      ) {
        return ack({ ok: false, error: ErrorCode.Unauthorized });
      }

      const previous = socket.data.sessionId;
      if (previous && previous !== request.sessionId) void socket.leave(sessionRoom(previous));
      socket.data = { sessionId: request.sessionId, role: request.role };
      store.touch(request.sessionId);
      void socket.join(sessionRoom(request.sessionId));
      ack({ ok: true, latest: session.latest });
    });

    socket.on(SocketEvent.Publish, (update, ack) => {
      if (typeof ack !== 'function') return;
      const { sessionId, role } = socket.data;
      if (!sessionId || role !== 'sender') return ack({ ok: false, error: ErrorCode.Unauthorized });

      const invalid = validateSealedUpdate(update);
      if (invalid) return ack({ ok: false, error: invalid });

      const result = store.publish(sessionId, update);
      if (!result.ok) {
        const error =
          result.reason === 'stale' ? ErrorCode.StaleSequence : ErrorCode.SessionNotFound;
        return ack({ ok: false, error });
      }

      // The Receiver verifies it independently; the server only relays.
      socket.to(sessionRoom(sessionId)).emit(SocketEvent.Update, result.latest);
      ack({ ok: true });
    });
  });
}
