import type { FastifyInstance } from 'fastify';
import {
  ErrorCode,
  SESSIONS_PATH,
  isSessionId,
  validateSealedUpdate,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type ErrorResponse,
} from '@slm/protocol';
import { sendError } from './http-errors';
import type { SessionStore } from './session-store';

export function registerSessionRoutes(http: FastifyInstance, store: SessionStore): void {
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
}
