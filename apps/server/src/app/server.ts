import Fastify, { type FastifyInstance } from 'fastify';
import { Server as SocketServer } from 'socket.io';
import {
  ErrorCode,
  HEALTH_PATH,
  HEARTBEAT,
  LIMITS,
  PROTOCOL_VERSION,
  SOCKET_PATH,
  type EndReason,
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
  /** Idle time after which a Session is deleted (default IDLE_TIMEOUT_MS). */
  idleTimeoutMs?: number;
  /** Clock in ms since epoch; injectable so tests can expire Sessions. */
  now?: () => number;
}

const DEFAULT_MAX_SESSIONS = 1000;

/** How often idle Sessions are swept; one may outlive the timeout by up to this much. */
const EXPIRY_SWEEP_INTERVAL_MS = 60_000;

/** Room for the largest base64url ciphertext plus JSON overhead (REST bodies and socket frames). */
const BODY_LIMIT_BYTES = 2 * LIMITS.maxCiphertextBytes;

/** On every HTTP response: nothing is cached, sniffed, or leaked through the Referer. */
const DEFENSIVE_HEADERS = {
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
} as const;

export interface AppServer {
  http: FastifyInstance;
  io: LiveServer;
  /** Start listening; resolves with the bound address (use port 0 for a random port). */
  listen(port: number, host?: string): Promise<string>;
  /** Runs the idle-expiry sweep now; it also runs on a timer. Exposed for tests. */
  expireIdleSessions(): void;
  close(): Promise<void>;
}

/**
 * Builds a fully wired, not-yet-listening server instance.
 * Every test gets its own isolated instance; `main.ts` builds the real one.
 */
export function buildServer(options: ServerOptions = {}): AppServer {
  const http = Fastify({ logger: options.logger ?? false, bodyLimit: BODY_LIMIT_BYTES });
  const store = new SessionStore({
    maxSessions: options.maxSessions ?? DEFAULT_MAX_SESSIONS,
    idleTimeoutMs: options.idleTimeoutMs,
    now: options.now,
  });

  // Set first thing, so error and not-found responses carry them too.
  http.addHook('onRequest', async (_request, reply) => {
    reply.headers(DEFENSIVE_HEADERS);
  });

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
    // The web client only uses WebSocket; refusing long-polling keeps every HTTP response
    // under the defensive headers above and shrinks the surface.
    transports: ['websocket'],
    pingInterval: HEARTBEAT.pingIntervalMs,
    pingTimeout: HEARTBEAT.pingTimeoutMs,
    // A frame larger than any valid Update closes the connection before it is parsed.
    maxHttpBufferSize: BODY_LIMIT_BYTES,
  });

  http.get(HEALTH_PATH, async (): Promise<HealthResponse> => ({
    status: 'ok',
    protocol: PROTOCOL_VERSION,
  }));
  const live = registerLiveHandlers(io, store);
  /** Every way a Session ends goes through here, so its parties are always told. */
  const endSession = (sessionId: string, reason: EndReason) => {
    store.delete(sessionId); // A no-op for expired ones, which expireIdle already removed.
    live.endSession(sessionId, reason);
  };
  registerSessionRoutes(http, store, endSession);

  const expireIdleSessions = () => {
    for (const sessionId of store.expireIdle()) endSession(sessionId, 'expired');
  };
  const sweep = setInterval(expireIdleSessions, EXPIRY_SWEEP_INTERVAL_MS);
  sweep.unref();

  return {
    http,
    io,
    expireIdleSessions,
    async listen(port, host = 'localhost') {
      return http.listen({ port, host });
    },
    async close() {
      clearInterval(sweep);
      await io.close();
      await http.close();
    },
  };
}
