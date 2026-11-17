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
import type { SessionStore } from './session-store';

export function registerSessionRoutes(http: FastifyInstance, store: SessionStore): void {
  http.post<{ Body: CreateSessionRequest; Reply: CreateSessionResponse | ErrorResponse }>(
    SESSIONS_PATH,
    async (request, reply) => {
      const body = request.body as Partial<CreateSessionRequest> | null;
      if (!isSessionId(body?.sessionId)) {
        return reply.code(400).send({ error: ErrorCode.InvalidPayload });
      }
      const invalid = validateSealedUpdate(body.update);
      if (invalid === ErrorCode.PayloadTooLarge) return reply.code(413).send({ error: invalid });
      if (invalid !== null || body.update?.seq !== 0) {
        return reply.code(400).send({ error: ErrorCode.InvalidPayload });
      }

      const created = store.create(body.sessionId, body.update);
      if (!created.ok) {
        return created.reason === 'exists'
          ? reply.code(409).send({ error: ErrorCode.SessionExists })
          : reply.code(503).send({ error: ErrorCode.CapacityReached });
      }
      return reply.code(201).send({ senderToken: created.senderToken });
    },
  );
}
