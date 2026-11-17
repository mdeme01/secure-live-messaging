import Fastify, { type FastifyInstance } from 'fastify';
import { Server as SocketServer } from 'socket.io';
import {
  ErrorCode,
  HEALTH_PATH,
  HEARTBEAT,
  LIMITS,
  PROTOCOL_VERSION,
  SOCKET_PATH,
  type HealthResponse,
} from '@slm/protocol';
import { sendError } from './http-errors';
import { registerLiveHandlers, type LiveServer } from './live.handlers';
import { SessionStore } from './session-store';
import { registerSessionRoutes } from './sessions.routes';

export interface ServerOptions {
  /** Enable Fastify's request logger. Off by default so tests stay quiet. */
  logger?: boolean;
  /** Maximum number of live Sessions. */
  maxSessions?: number;
}

const DEFAULT_MAX_SESSIONS = 1000;

/** Room for the largest base64url ciphertext plus JSON overhead. */
const BODY_LIMIT_BYTES = 2 * LIMITS.maxCiphertextBytes;

export interface AppServer {
  http: FastifyInstance;
  io: LiveServer;
  /** Start listening; resolves with the bound address (use port 0 for a random port). */
  listen(port: number, host?: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * Builds a fully wired, not-yet-listening server instance.
 * Every test gets its own isolated instance; `main.ts` builds the real one.
 */
export function buildServer(options: ServerOptions = {}): AppServer {
  const http = Fastify({ logger: options.logger ?? false, bodyLimit: BODY_LIMIT_BYTES });
  const store = new SessionStore({ maxSessions: options.maxSessions ?? DEFAULT_MAX_SESSIONS });

  // Uniform error bodies for anything Fastify rejects before our handlers run.
  http.setErrorHandler<{ statusCode?: number }>((error, _request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      reply.log.error(error);
      return reply.code(500).send();
    }
    return sendError(reply, status === 413 ? ErrorCode.PayloadTooLarge : ErrorCode.InvalidPayload);
  });

  // Single-origin deployment (the web dev server proxies to us), so CORS stays disabled.
  const io: LiveServer = new SocketServer(http.server, {
    path: SOCKET_PATH,
    serveClient: false,
    pingInterval: HEARTBEAT.pingIntervalMs,
    pingTimeout: HEARTBEAT.pingTimeoutMs,
  });

  http.get(HEALTH_PATH, async (): Promise<HealthResponse> => ({
    status: 'ok',
    protocol: PROTOCOL_VERSION,
  }));
  registerSessionRoutes(http, store);
  registerLiveHandlers(io, store);

  return {
    http,
    io,
    async listen(port, host = 'localhost') {
      return http.listen({ port, host });
    },
    async close() {
      await io.close();
      await http.close();
    },
  };
}
