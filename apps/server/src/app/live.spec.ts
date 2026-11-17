import { ErrorCode, SocketEvent } from '@slm/protocol';
import { buildServer, type AppServer } from './server';
import { connectClient, createSession, fakeUpdate, newSessionId, type TestClient } from './testing';

describe('live channel: session:join', () => {
  let server: AppServer;
  let baseUrl: string;
  const clients: TestClient[] = [];

  async function client() {
    const c = await connectClient(baseUrl);
    clients.push(c);
    return c;
  }

  beforeEach(async () => {
    server = buildServer();
    baseUrl = await server.listen(0);
  });

  afterEach(async () => {
    clients.splice(0).forEach((c) => c.disconnect());
    await server.close();
  });

  it('gives a receiver the Session’s latest Update, exactly as stored', async () => {
    const update0 = fakeUpdate(0, 'Z');
    const { sessionId } = await createSession(baseUrl, newSessionId(), update0);

    const ack = await (
      await client()
    ).emitWithAck(SocketEvent.Join, { sessionId, role: 'receiver' });
    expect(ack).toEqual({ ok: true, latest: update0 });
  });

  it('answers SESSION_NOT_FOUND for an unknown Session', async () => {
    const ack = await (
      await client()
    ).emitWithAck(SocketEvent.Join, {
      sessionId: newSessionId(),
      role: 'receiver',
    });
    expect(ack).toEqual({ ok: false, error: ErrorCode.SessionNotFound });
  });

  it.each([
    ['malformed Session ID', { sessionId: 'nope', role: 'receiver' }],
    ['unknown role', { sessionId: newSessionId(), role: 'admin' }],
    ['missing body', null],
  ])('answers INVALID_PAYLOAD for a %s', async (_label, request) => {
    const c = await client();
    // Deliberately bypass the typed contract to send garbage.
    const ack = await (c.emitWithAck as (...args: unknown[]) => Promise<unknown>)(
      SocketEvent.Join,
      request,
    );
    expect(ack).toEqual({ ok: false, error: ErrorCode.InvalidPayload });
  });
});
