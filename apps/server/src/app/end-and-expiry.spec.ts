import { ErrorCode, SocketEvent, sessionPath, type SessionEnded } from '@slm/protocol';
import { buildServer, type AppServer, type ServerOptions } from './server';
import { connectClient, createSession, fakeUpdate, newSessionId, type TestClient } from './testing';

describe('ending and expiry', () => {
  let server: AppServer;
  let baseUrl: string;
  const clients: TestClient[] = [];

  async function start(options: ServerOptions = {}) {
    server = buildServer(options);
    baseUrl = await server.listen(0);
  }

  async function joined(sessionId: string, role: 'sender' | 'receiver', senderToken?: string) {
    const client = await connectClient(baseUrl, senderToken ? { senderToken } : {});
    clients.push(client);
    const ack = await client.emitWithAck(SocketEvent.Join, { sessionId, role });
    expect(ack.ok).toBe(true);
    return client;
  }

  /** Resolves with the `session:ended` payload and the disconnect reason that follows it. */
  const endOf = (client: TestClient) =>
    new Promise<{ ended: SessionEnded; disconnect: string }>((resolve) =>
      client.once(SocketEvent.Ended, (ended) =>
        client.once('disconnect', (disconnect) => resolve({ ended, disconnect })),
      ),
    );

  const end = (sessionId: string, authorization?: string) =>
    fetch(`${baseUrl}${sessionPath(sessionId)}`, {
      method: 'DELETE',
      headers: authorization ? { authorization } : {},
    });

  const joinAck = async (sessionId: string) => {
    const client = await connectClient(baseUrl);
    clients.push(client);
    return client.emitWithAck(SocketEvent.Join, { sessionId, role: 'receiver' });
  };

  afterEach(async () => {
    clients.splice(0).forEach((c) => c.disconnect());
    await server.close();
  });

  describe('DELETE /api/sessions/:id', () => {
    it('ends the Session for the Sender Token holder', async () => {
      await start();
      const { sessionId, senderToken } = await createSession(baseUrl);

      const res = await end(sessionId, `Bearer ${senderToken}`);
      expect(res.status).toBe(204);
      expect(await joinAck(sessionId)).toEqual({ ok: false, error: ErrorCode.SessionNotFound });
      expect((await end(sessionId, `Bearer ${senderToken}`)).status).toBe(404);
    });

    it.each([
      ['no token', undefined],
      ['a wrong token', `Bearer ${'x'.repeat(43)}`],
      ['a malformed token', 'Bearer nope'],
      ['another scheme', 'Basic abc'],
    ])('refuses %s with 401 and keeps the Session', async (_label, authorization) => {
      await start();
      const { sessionId } = await createSession(baseUrl);

      const res = await end(sessionId, authorization);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: ErrorCode.Unauthorized });
      expect((await joinAck(sessionId)).ok).toBe(true);
    });

    it('answers 404 for an unknown or malformed Session ID', async () => {
      await start();
      const { senderToken } = await createSession(baseUrl);
      expect((await end(newSessionId(), `Bearer ${senderToken}`)).status).toBe(404);
      expect((await end('nope', `Bearer ${senderToken}`)).status).toBe(404);
    });

    it('tells both parties the Sender ended it, then disconnects them', async () => {
      await start();
      const { sessionId, senderToken } = await createSession(baseUrl);
      const sender = await joined(sessionId, 'sender', senderToken);
      const receiver = await joined(sessionId, 'receiver');
      const senderEnd = endOf(sender);
      const receiverEnd = endOf(receiver);

      await end(sessionId, `Bearer ${senderToken}`);

      const expected = { ended: { reason: 'ended-by-sender' }, disconnect: 'io server disconnect' };
      expect(await receiverEnd).toEqual(expected);
      expect(await senderEnd).toEqual(expected);
    });
  });

  describe('idle expiry', () => {
    const IDLE_MS = 1_000;

    it('deletes a Session idle for the timeout and tells whoever is connected', async () => {
      let clock = 0;
      await start({ now: () => clock, idleTimeoutMs: IDLE_MS });
      const { sessionId } = await createSession(baseUrl);
      const receiver = await joined(sessionId, 'receiver'); // activity at 0
      const receiverEnd = endOf(receiver);

      clock = IDLE_MS - 1;
      server.expireIdleSessions();
      // Still there (the slot is held, so this refused join is not activity either).
      expect(await joinAck(sessionId)).toEqual({ ok: false, error: ErrorCode.RoleTaken });

      clock = IDLE_MS;
      server.expireIdleSessions();
      expect(await receiverEnd).toEqual({
        ended: { reason: 'expired' },
        disconnect: 'io server disconnect',
      });
      expect(await joinAck(sessionId)).toEqual({ ok: false, error: ErrorCode.SessionNotFound });
    });

    it('counts a join as activity', async () => {
      let clock = 0;
      await start({ now: () => clock, idleTimeoutMs: IDLE_MS });
      const { sessionId } = await createSession(baseUrl);

      clock = 900;
      await joined(sessionId, 'receiver');
      clock = 1_800; // idle for 1_800 since creation, but only 900 since the join
      server.expireIdleSessions();
      expect(await joinAck(sessionId)).toEqual({ ok: false, error: ErrorCode.RoleTaken });
    });

    it('counts a publish as activity', async () => {
      let clock = 0;
      await start({ now: () => clock, idleTimeoutMs: IDLE_MS });
      const { sessionId, senderToken } = await createSession(baseUrl);
      const sender = await joined(sessionId, 'sender', senderToken); // activity at 0

      clock = 900;
      expect(await sender.emitWithAck(SocketEvent.Publish, fakeUpdate(1))).toEqual({ ok: true });
      clock = 1_800;
      server.expireIdleSessions();
      expect(
        await sender.emitWithAck(SocketEvent.Join, { sessionId, role: 'sender' }),
      ).toMatchObject({ ok: true });
    });

    it('frees capacity when a Session expires', async () => {
      let clock = 0;
      await start({ now: () => clock, idleTimeoutMs: IDLE_MS, maxSessions: 1 });
      await createSession(baseUrl);
      await expect(createSession(baseUrl)).rejects.toThrow('503');

      clock = IDLE_MS;
      server.expireIdleSessions();
      await expect(createSession(baseUrl)).resolves.toBeDefined();
    });
  });
});
