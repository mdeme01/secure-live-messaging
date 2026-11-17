import type { Server as SocketServer } from 'socket.io';
import {
  ErrorCode,
  SocketEvent,
  isJoinRequest,
  isSenderToken,
  validateSealedUpdate,
  type ClientToServerEvents,
  type EndReason,
  type HandshakeAuth,
  type Role,
  type ServerToClientEvents,
} from '@slm/protocol';
import { RoleSlots } from './role-slots';
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

export interface LiveChannel {
  /** Tells everyone in a deleted Session why it ended, then disconnects them. */
  endSession(sessionId: string, reason: EndReason): void;
}

export function registerLiveHandlers(io: LiveServer, store: SessionStore): LiveChannel {
  const slots = new RoleSlots();

  const notifySender = (sessionId: string) => {
    const sender = slots.holder(sessionId, 'sender');
    if (sender) io.to(sender).emit(SocketEvent.Presence, presenceOf(sessionId));
  };
  const presenceOf = (sessionId: string) => ({
    receiverConnected: slots.holder(sessionId, 'receiver') !== undefined,
  });

  io.on('connection', (socket) => {
    const { senderToken } = (socket.handshake.auth ?? {}) as HandshakeAuth;

    /** Gives up whatever role this socket held, telling the Sender if a Receiver left. */
    const leaveCurrent = () => {
      const { sessionId, role } = socket.data;
      if (!sessionId || !role) return;
      void socket.leave(sessionRoom(sessionId));
      socket.data = {};
      if (slots.release(sessionId, role, socket.id) && role === 'receiver') notifySender(sessionId);
    };

    socket.on(SocketEvent.Join, (request, ack) => {
      if (typeof ack !== 'function') return;
      if (!isJoinRequest(request)) return ack({ ok: false, error: ErrorCode.InvalidPayload });

      const { sessionId, role } = request;
      const session = store.get(sessionId);
      if (!session) return ack({ ok: false, error: ErrorCode.SessionNotFound });
      if (
        role === 'sender' &&
        !(isSenderToken(senderToken) && store.isSender(sessionId, senderToken))
      ) {
        return ack({ ok: false, error: ErrorCode.Unauthorized });
      }

      const rejoin = socket.data.sessionId === sessionId && socket.data.role === role;
      if (!rejoin && slots.holder(sessionId, role) !== undefined) {
        return ack({ ok: false, error: ErrorCode.RoleTaken });
      }
      if (!rejoin) {
        leaveCurrent();
        slots.claim(sessionId, role, socket.id);
        socket.data = { sessionId, role };
        void socket.join(sessionRoom(sessionId));
      }
      store.touch(sessionId);

      if (role === 'sender') {
        ack({ ok: true, latest: session.latest, presence: presenceOf(sessionId) });
      } else {
        ack({ ok: true, latest: session.latest });
        if (!rejoin) notifySender(sessionId);
      }
    });

    socket.on('disconnect', leaveCurrent);

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

  return {
    endSession(sessionId, reason) {
      const room = sessionRoom(sessionId);
      slots.forget(sessionId);
      io.to(room).emit(SocketEvent.Ended, { reason });
      // Same connection, so this arrives after the event; the clients don't auto-reconnect.
      io.in(room).disconnectSockets();
    },
  };
}
