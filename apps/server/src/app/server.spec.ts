import { io as connect, type Socket } from 'socket.io-client';
import { PROTOCOL_VERSION, SOCKET_PATH } from '@slm/protocol';
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
    const res = await fetch(`${baseUrl}/api/health`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      protocol: PROTOCOL_VERSION,
    });
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
