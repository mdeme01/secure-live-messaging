import { request } from 'node:http';
import { ErrorCode, LIMITS, SESSIONS_PATH, isSenderToken } from '@slm/protocol';
import { buildServer, type AppServer, type ServerOptions } from './server';

import { fakeUpdate, newSessionId } from './testing';

const update0 = fakeUpdate(0);

describe('POST /api/sessions', () => {
  let server: AppServer;
  let baseUrl: string;

  async function start(options: ServerOptions = {}) {
    server = buildServer(options);
    baseUrl = await server.listen(0);
  }

  function post(body: unknown, rawBody?: string) {
    return fetch(`${baseUrl}${SESSIONS_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rawBody ?? JSON.stringify(body),
    });
  }

  afterEach(async () => {
    await server?.close();
  });

  it('creates a Session and returns a fresh Sender Token', async () => {
    await start();
    const res = await post({ sessionId: newSessionId(), update: update0 });

    expect(res.status).toBe(201);
    const { senderToken } = await res.json();
    expect(isSenderToken(senderToken)).toBe(true);
  });

  it('issues a different Sender Token for every Session', async () => {
    await start();
    const a = await (await post({ sessionId: newSessionId(), update: update0 })).json();
    const b = await (await post({ sessionId: newSessionId(), update: update0 })).json();
    expect(a.senderToken).not.toEqual(b.senderToken);
  });

  it.each([
    ['missing Session ID', { update: update0 }],
    ['malformed Session ID', { sessionId: 'nope', update: update0 }],
    ['missing Update 0', { sessionId: 'x'.repeat(22) }],
    ['Update 0 with a non-zero seq', { sessionId: 'x'.repeat(22), update: { ...update0, seq: 1 } }],
    ['malformed IV', { sessionId: 'x'.repeat(22), update: { ...update0, iv: '!' } }],
    ['null body', null],
  ])('rejects a %s with 400', async (_label, body) => {
    await start();
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: ErrorCode.InvalidPayload });
  });

  it('rejects invalid JSON with 400', async () => {
    await start();
    const res = await post(undefined, '{not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: ErrorCode.InvalidPayload });
  });

  it('rejects ciphertext over the limit with 413', async () => {
    await start();
    const ciphertext = 'A'.repeat(Math.ceil((LIMITS.maxCiphertextBytes * 4) / 3) + 4);
    const res = await post({ sessionId: newSessionId(), update: { ...update0, ciphertext } });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: ErrorCode.PayloadTooLarge });
  });

  it('rejects a body far over the limit with 413 before reading it', async () => {
    await start();
    // Only the headers are sent: the server must answer from the declared length alone.
    // (Streaming the body too races the server closing the connection: ECONNRESET.)
    const { status, body } = await new Promise<{ status?: number; body: string }>(
      (resolve, reject) => {
        const req = request(`${baseUrl}${SESSIONS_PATH}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': 1024 * 1024 },
        });
        req.on('error', reject);
        req.on('response', (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.flushHeaders();
      },
    );
    expect(status).toBe(413);
    expect(JSON.parse(body)).toEqual({ error: ErrorCode.PayloadTooLarge });
  });

  it('rejects a Session ID that already exists with 409', async () => {
    await start();
    const sessionId = newSessionId();
    expect((await post({ sessionId, update: update0 })).status).toBe(201);

    const res = await post({ sessionId, update: fakeUpdate(0, 'C') });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: ErrorCode.SessionExists });
  });

  it('rejects new Sessions with 503 once the capacity is reached', async () => {
    await start({ maxSessions: 2 });
    expect((await post({ sessionId: newSessionId(), update: update0 })).status).toBe(201);
    expect((await post({ sessionId: newSessionId(), update: update0 })).status).toBe(201);

    const res = await post({ sessionId: newSessionId(), update: update0 });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: ErrorCode.CapacityReached });
  });
});
