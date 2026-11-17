import type { FastifyReply } from 'fastify';
import { ErrorCode, type ErrorResponse } from '@slm/protocol';

/** The one place protocol error codes map to HTTP statuses. */
const HTTP_STATUS: Partial<Record<ErrorCode, number>> = {
  [ErrorCode.InvalidPayload]: 400,
  [ErrorCode.Unauthorized]: 401,
  [ErrorCode.SessionNotFound]: 404,
  [ErrorCode.SessionExists]: 409,
  [ErrorCode.PayloadTooLarge]: 413,
  [ErrorCode.CapacityReached]: 503,
};

export function sendError(reply: FastifyReply, error: ErrorCode): FastifyReply {
  const body: ErrorResponse = { error };
  return reply.code(HTTP_STATUS[error] ?? 400).send(body);
}
