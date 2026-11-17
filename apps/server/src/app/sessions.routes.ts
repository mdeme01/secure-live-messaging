import type { FastifyInstance } from 'fastify';
import {
  ErrorCode,
  SESSIONS_PATH,
  isSenderToken,
  isSessionId,
  validateSealedUpdate,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type ErrorResponse,
} from '@slm/protocol';
import { sendError } from './http-errors';
import type { LiveChannel } from './live.handlers';
import type { SessionStore } from './session-store';

const BEARER = /^Bearer (\S+)$/;

export function registerSessionRoutes(
  http: FastifyInstance,
  store: SessionStore,
  live: LiveChannel,
): void {
  http.post<{ Body: CreateSessionRequest; Reply: CreateSessionResponse | ErrorResponse }>(
    SESSIONS_PATH,
    async (request, reply) => {
      const body = request.body as Partial<CreateSessionRequest> | null;
      if (!isSessionId(body?.sessionId)) return sendError(reply, ErrorCode.InvalidPayload);
      const invalid = validateSealedUpdate(body.update);
      if (invalid !== null) return sendError(reply, invalid);
      if (body.update?.seq !== 0) return sendError(reply, ErrorCode.InvalidPayload);

      const created = store.create(body.sessionId, body.update);
      if (!created.ok) {
        return sendError(
          reply,
          created.reason === 'exists' ? ErrorCode.SessionExists : ErrorCode.CapacityReached,
        );
      }
      return reply.code(201).send({ senderToken: created.senderToken });
    },
  );

  http.delete<{ Params: { id: string } }>(`${SESSIONS_PATH}/:id`, async (request, reply) => {
    const { id } = request.params;
    if (!isSessionId(id) || !store.get(id)) return sendError(reply, ErrorCode.SessionNotFound);
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!isSenderToken(token) || !store.isSender(id, token)) {
      return sendError(reply, ErrorCode.Unauthorized);
    }
    store.delete(id);
    live.endSession(id, 'ended-by-sender');
    return reply.code(204).send();
  });
}
