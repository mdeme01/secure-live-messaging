import Fastify, { type FastifyInstance } from 'fastify';
import { Server as SocketServer } from 'socket.io';
import { API_PREFIX, PROTOCOL_VERSION, SOCKET_PATH, type HealthResponse } from '@slm/protocol';

export interface ServerOptions {
  /** Enable Fastify's request logger. Off by default so tests stay quiet. */
  logger?: boolean;
  /** Clock used for anything time-based; injectable so tests can control time. */
  now?: () => number;
}

export interface AppServer {
  http: FastifyInstance;
  io: SocketServer;
  /** Start listening; resolves with the bound address (use port 0 for a random port). */
  listen(port: number, host?: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * Builds a fully wired, not-yet-listening server instance.
 * Every test gets its own isolated instance; `main.ts` builds the real one.
 */
export function buildServer(options: ServerOptions = {}): AppServer {
  const http = Fastify({ logger: options.logger ?? false });

  // Single-origin deployment (the web dev server proxies to us), so CORS stays disabled.
  const io = new SocketServer(http.server, {
    path: SOCKET_PATH,
    serveClient: false,
  });

  http.get(`${API_PREFIX}/health`, async (): Promise<HealthResponse> => ({
    status: 'ok',
    protocol: PROTOCOL_VERSION,
  }));

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
