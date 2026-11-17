import { ErrorCode, SocketEvent } from '@slm/protocol';
import { buildServer, type AppServer } from './server';
import { connectClient, createSession, fakeUpdate, newSessionId, type TestClient } from './testing';

describe('live channel', () => {
  let server: AppServer;
  let baseUrl: string;
  const clients: TestClient[] = [];

  async function client(auth: Record<string, unknown> = {}) {
    const c = await connectClient(baseUrl, auth);
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

  describe('sender', () => {
    async function joinedSender() {
      const session = await createSession(baseUrl);
      const sender = await client({ senderToken: session.senderToken });
      const ack = await sender.emitWithAck(SocketEvent.Join, {
        sessionId: session.sessionId,
        role: 'sender',
      });
      expect(ack).toEqual({ ok: true, latest: session.update0 });
      return { ...session, sender };
    }

    async function joinedReceiver(sessionId: string) {
      const receiver = await client();
      await receiver.emitWithAck(SocketEvent.Join, { sessionId, role: 'receiver' });
      return receiver;
    }

    it.each([
      ['no Sender Token', {}],
      ['a wrong Sender Token', { senderToken: 'x'.repeat(43) }],
      ['a malformed Sender Token', { senderToken: 'short' }],
    ])('refuses a sender join with %s', async (_label, auth) => {
      const { sessionId } = await createSession(baseUrl);
      const ack = await (
        await client(auth)
      ).emitWithAck(SocketEvent.Join, {
        sessionId,
        role: 'sender',
      });
      expect(ack).toEqual({ ok: false, error: ErrorCode.Unauthorized });
    });

    it('refuses another Session’s Sender Token', async () => {
      const a = await createSession(baseUrl);
      const b = await createSession(baseUrl);
      const ack = await (
        await client({ senderToken: a.senderToken })
      ).emitWithAck(SocketEvent.Join, { sessionId: b.sessionId, role: 'sender' });
      expect(ack).toEqual({ ok: false, error: ErrorCode.Unauthorized });
    });

    it('relays a published Update to the Receiver and keeps it for late joiners', async () => {
      const { sessionId, sender } = await joinedSender();
      const receiver = await joinedReceiver(sessionId);
      const received = new Promise((resolve) => receiver.once(SocketEvent.Update, resolve));

      const update = fakeUpdate(1, 'C');
      expect(await sender.emitWithAck(SocketEvent.Publish, update)).toEqual({ ok: true });
      expect(await received).toEqual(update);

      const lateAck = await (
        await client()
      ).emitWithAck(SocketEvent.Join, {
        sessionId,
        role: 'receiver',
      });
      expect(lateAck).toEqual({ ok: true, latest: update });
    });

    it('relays only the wire fields of an Update', async () => {
      const { sessionId, sender } = await joinedSender();
      const receiver = await joinedReceiver(sessionId);
      const received = new Promise((resolve) => receiver.once(SocketEvent.Update, resolve));

      await sender.emitWithAck(SocketEvent.Publish, { ...fakeUpdate(1), extra: 'x' } as never);
      expect(await received).toEqual(fakeUpdate(1));
    });

    it.each([
      ['equal', 1],
      ['lower', 0],
    ])('rejects an %s Sequence Number with STALE_SEQUENCE', async (_label, seq) => {
      const { sender } = await joinedSender();
      await sender.emitWithAck(SocketEvent.Publish, fakeUpdate(1));
      expect(await sender.emitWithAck(SocketEvent.Publish, fakeUpdate(seq, 'D'))).toEqual({
        ok: false,
        error: ErrorCode.StaleSequence,
      });
    });

    it('refuses to publish from a socket that has not joined as sender', async () => {
      const { sessionId } = await createSession(baseUrl);
      const receiver = await joinedReceiver(sessionId);
      expect(await receiver.emitWithAck(SocketEvent.Publish, fakeUpdate(1))).toEqual({
        ok: false,
        error: ErrorCode.Unauthorized,
      });
      expect(await (await client()).emitWithAck(SocketEvent.Publish, fakeUpdate(1))).toEqual({
        ok: false,
        error: ErrorCode.Unauthorized,
      });
    });

    it('rejects malformed and oversized Updates', async () => {
      const { sender } = await joinedSender();
      expect(await sender.emitWithAck(SocketEvent.Publish, { ...fakeUpdate(1), iv: '!' })).toEqual({
        ok: false,
        error: ErrorCode.InvalidPayload,
      });
      expect(
        await sender.emitWithAck(SocketEvent.Publish, {
          ...fakeUpdate(1),
          ciphertext: 'A'.repeat(90_000),
        }),
      ).toEqual({ ok: false, error: ErrorCode.PayloadTooLarge });
    });
  });
});
