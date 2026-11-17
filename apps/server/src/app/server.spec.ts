import { io as connect, type Socket } from 'socket.io-client';
import {
  HEALTH_PATH,
  LIMITS,
  PROTOCOL_VERSION,
  SESSIONS_PATH,
  SOCKET_PATH,
  SocketEvent,
  sessionPath,
} from '@slm/protocol';
import { connectClient, fakeUpdate, newSessionId } from './testing';
import { buildServer, type AppServer } from './server';

describe('server', () => {
  let server: AppServer;
  let baseUrl: string;

  beforeEach(async () => {
    server = buildServer();
    baseUrl = await server.listen(0);
  });

  afterEach(async () => {
    await server.close();
  });

  it('reports health over real HTTP', async () => {
    const res = await fetch(`${baseUrl}${HEALTH_PATH}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      protocol: PROTOCOL_VERSION,
    });
  });

  it.each([
    ['a success', () => fetch(`${baseUrl}${HEALTH_PATH}`), 200],
    [
      'a rejected body',
      () =>
        fetch(`${baseUrl}${SESSIONS_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{',
        }),
      400,
    ],
    [
      'an unknown Session',
      () => fetch(`${baseUrl}${sessionPath(newSessionId())}`, { method: 'DELETE' }),
      404,
    ],
    ['an unknown route', () => fetch(`${baseUrl}/api/nope`), 404],
  ])('sets defensive headers on %s', async (_label, request, status) => {
    const res = await request();
    expect(res.status).toBe(status);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('drops a socket that sends a frame far larger than any valid Update', async () => {
    const socket = await connectClient(baseUrl);
    const dropped = new Promise((resolve) => socket.once('disconnect', resolve));
    const ciphertext = 'A'.repeat(4 * LIMITS.maxCiphertextBytes);
    socket.emit(SocketEvent.Publish, { ...fakeUpdate(1), ciphertext });
    expect(await dropped).toBe('transport close');
  });

  it('accepts socket.io connections on the shared socket path', async () => {
    const socket: Socket = connect(baseUrl, {
      path: SOCKET_PATH,
      transports: ['websocket'],
    });

    await new Promise<void>((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
    });

    expect(socket.connected).toBe(true);
    socket.disconnect();
  });
});
