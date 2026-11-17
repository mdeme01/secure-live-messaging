import { generateSessionKey, sealUpdate } from '@slm/crypto';
import { ErrorCode, type JoinAck, type SealedUpdate } from '@slm/protocol';
import { ReceiverController } from './receiver-controller';
import { FIRST_JOIN_RETRY_DELAYS_MS, UNANSWERED_JOIN_RETRY_MS } from './join-session';
import { FakeTransport } from './testing/fake-transport';

const SESSION_ID = 'abcDEF0123456789_-xyzA';
const OTHER_SESSION_ID = 'zzzDEF0123456789_-xyzA';
const NOW = new Date('2026-01-01T10:00:00Z');

/** Changes the first encoded character, i.e. flips bits of the first ciphertext byte. */
const flipFirstChar = (encoded: string) => (encoded[0] === 'A' ? 'B' : 'A') + encoded.slice(1);

async function setup(latestText = '') {
  const { encoded, key } = await generateSessionKey();
  const seal = (seq: number, text: string, sessionId = SESSION_ID) =>
    sealUpdate(key, sessionId, seq, text);
  let latest: SealedUpdate = await seal(0, latestText);

  const transport = new FakeTransport();
  transport.joinResponse = () => ({ ok: true, latest });
  const controller = new ReceiverController({
    link: { sessionId: SESSION_ID, sessionKey: encoded },
    transport,
    now: () => NOW,
  });
  await controller.start();
  await vi.waitFor(() => expect(controller.status()).toBe('live'));

  return {
    controller,
    transport,
    seal,
    setLatest: (u: SealedUpdate) => (latest = u),
  };
}

describe('ReceiverController', () => {
  it('joins as receiver and shows the verified empty Message of a new Session', async () => {
    const { controller, transport } = await setup('');

    expect(transport.joins).toEqual([{ sessionId: SESSION_ID, role: 'receiver' }]);
    expect(controller.message()).toBe('');
    expect(controller.lastUpdatedAt()).toEqual(NOW);
    expect(controller.integrityFailure()).toBeNull();
  });

  it('shows the current Message to a late joiner', async () => {
    const { controller } = await setup('written before you arrived');
    expect(controller.message()).toBe('written before you arrived');
  });

  it('accepts newer live Updates in order, even when they arrive back to back', async () => {
    const { controller, transport, seal } = await setup();
    const first = await seal(1, 'first');
    const second = await seal(2, 'second');

    transport.simulateUpdate(first);
    transport.simulateUpdate(second);

    await vi.waitFor(() => expect(controller.message()).toBe('second'));
    expect(controller.integrityFailure()).toBeNull();
  });

  it('silently ignores an Update it has already shown', async () => {
    const { controller, transport, seal } = await setup();
    const update = await seal(1, 'once');
    transport.simulateUpdate(update);
    await vi.waitFor(() => expect(controller.message()).toBe('once'));

    transport.simulateUpdate(update);
    await new Promise((r) => setTimeout(r, 10));
    expect(controller.integrityFailure()).toBeNull();
    expect(controller.message()).toBe('once');
  });

  it('silently drops a forged Update that reuses the current Sequence Number', async () => {
    const { controller, transport, seal } = await setup();
    transport.simulateUpdate(await seal(1, 'genuine'));
    await vi.waitFor(() => expect(controller.message()).toBe('genuine'));

    const forged = await seal(1, 'forged');
    transport.simulateUpdate({ ...forged, ciphertext: flipFirstChar(forged.ciphertext) });
    transport.simulateUpdate(await seal(2, 'after'));

    // Equal seq counts as already shown: never decrypted, never displayed.
    await vi.waitFor(() => expect(controller.message()).toBe('after'));
    expect(controller.integrityFailure()).toBeNull();
  });

  it('rejects a byte-identical replay of an earlier Update', async () => {
    const { controller, transport, seal } = await setup();
    const first = await seal(1, 'first');
    transport.simulateUpdate(first);
    transport.simulateUpdate(await seal(2, 'second'));
    await vi.waitFor(() => expect(controller.message()).toBe('second'));

    transport.simulateUpdate(first);

    await vi.waitFor(() => expect(controller.integrityFailure()).toBe('stale'));
    expect(controller.message()).toBe('second');
  });

  it('treats an older Update in the join after a reconnect as an Integrity Failure', async () => {
    const { controller, transport, seal, setLatest } = await setup();
    const old = await seal(1, 'old');
    transport.simulateUpdate(old);
    transport.simulateUpdate(await seal(2, 'newer'));
    await vi.waitFor(() => expect(controller.message()).toBe('newer'));

    // A server that rolls the Session back to an older Update.
    setLatest(old);
    transport.simulateDisconnect();
    transport.simulateConnect();

    await vi.waitFor(() => expect(controller.integrityFailure()).toBe('stale'));
    expect(controller.message()).toBe('newer');
  });

  type Seal = (seq: number, text: string, sessionId?: string) => Promise<SealedUpdate>;
  it.each<[string, string, (seal: Seal) => Promise<SealedUpdate>]>([
    ['an older (replayed) Update', 'stale', (seal) => seal(1, 'old')],
    [
      'a tampered Update',
      'authentication-failed',
      async (seal) => ({ ...(await seal(3, 'evil')), iv: 'A'.repeat(16) }),
    ],
    [
      'an Update with one ciphertext byte flipped',
      'authentication-failed',
      async (seal) => {
        const update = await seal(3, 'evil');
        return { ...update, ciphertext: flipFirstChar(update.ciphertext) };
      },
    ],
    [
      'an Update whose ciphertext is not even base64url',
      'malformed',
      async (seal) => ({ ...(await seal(3, 'evil')), ciphertext: '!!not-base64!!' }),
    ],
    [
      'an Update from another Session',
      'authentication-failed',
      (seal) => seal(3, 'spliced', OTHER_SESSION_ID),
    ],
  ])('rejects %s and keeps the last verified Message', async (_label, reason, makeBad) => {
    const { controller, transport, seal } = await setup();
    transport.simulateUpdate(await seal(2, 'verified'));
    await vi.waitFor(() => expect(controller.message()).toBe('verified'));

    transport.simulateUpdate(await makeBad(seal));

    await vi.waitFor(() => expect(controller.integrityFailure()).toBe(reason));
    expect(controller.message()).toBe('verified');
  });

  it('clears the Integrity Failure when the next valid Update arrives', async () => {
    const { controller, transport, seal } = await setup();
    transport.simulateUpdate(await seal(1, 'verified'));
    const forged = await seal(2, 'forged');
    transport.simulateUpdate({ ...forged, ciphertext: flipFirstChar(forged.ciphertext) });
    await vi.waitFor(() => expect(controller.integrityFailure()).toBe('authentication-failed'));
    expect(controller.message()).toBe('verified');

    transport.simulateUpdate(await seal(2, 'genuine'));

    await vi.waitFor(() => expect(controller.message()).toBe('genuine'));
    expect(controller.integrityFailure()).toBeNull();
  });

  it('does not let a forged Update advance the Sequence Number', async () => {
    const { controller, transport, seal } = await setup();
    const forged = await seal(50, 'forged');
    transport.simulateUpdate({ ...forged, ciphertext: flipFirstChar(forged.ciphertext) });
    await vi.waitFor(() => expect(controller.integrityFailure()).not.toBeNull());

    // A genuine Update with a lower seq than the forged one is still accepted.
    transport.simulateUpdate(await seal(1, 'genuine'));
    await vi.waitFor(() => expect(controller.message()).toBe('genuine'));
  });

  it('shows Reconnecting while disconnected and rejoins without a false alarm', async () => {
    const { controller, transport, seal, setLatest } = await setup();
    const update = await seal(1, 'kept');
    transport.simulateUpdate(update);
    await vi.waitFor(() => expect(controller.message()).toBe('kept'));
    setLatest(update);

    transport.simulateDisconnect();
    expect(controller.status()).toBe('reconnecting');

    transport.simulateConnect();
    await vi.waitFor(() => expect(controller.status()).toBe('live'));
    expect(transport.joins).toHaveLength(2);
    expect(controller.message()).toBe('kept');
    expect(controller.integrityFailure()).toBeNull();
  });

  it('retries a join that got no answer while the connection stayed up', async () => {
    const { controller, transport } = await setup();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const answer = transport.joinResponse;
      let unanswered = true;
      transport.joinResponse = (request) => {
        if (!unanswered) return answer(request);
        unanswered = false;
        throw new Error('operation has timed out');
      };
      transport.simulateDisconnect();
      transport.simulateConnect();
      await vi.advanceTimersByTimeAsync(UNANSWERED_JOIN_RETRY_MS);
      await vi.waitFor(() => expect(controller.status()).toBe('live'));
      expect(transport.joins).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a Session that does not exist and stops reconnecting', async () => {
    const { encoded } = await generateSessionKey();
    const transport = new FakeTransport();
    transport.joinResponse = () => ({ ok: false, error: ErrorCode.SessionNotFound });
    const controller = new ReceiverController({
      link: { sessionId: SESSION_ID, sessionKey: encoded },
      transport,
    });

    await controller.start();

    await vi.waitFor(() => expect(controller.status()).toBe('not-found'));
    expect(transport.closed).toBe(true);
    expect(controller.message()).toBeNull();
  });

  it('does not connect if disposed while still starting', async () => {
    const { encoded } = await generateSessionKey();
    const transport = new FakeTransport();
    const controller = new ReceiverController({
      link: { sessionId: SESSION_ID, sessionKey: encoded },
      transport,
    });

    const starting = controller.start();
    controller.dispose();
    await starting;

    expect(transport.joins).toHaveLength(0);
    expect(transport.connected).toBe(false);
  });

  it('does not report Live for a join that completes after the connection dropped', async () => {
    const { encoded, key } = await generateSessionKey();
    const latest = await sealUpdate(key, SESSION_ID, 0, '');
    const transport = new FakeTransport();
    let answer!: (ack: JoinAck) => void;
    transport.join = (request) => {
      transport.joins.push(request);
      return new Promise((resolve) => (answer = resolve));
    };
    const controller = new ReceiverController({
      link: { sessionId: SESSION_ID, sessionKey: encoded },
      transport,
    });
    await controller.start();

    transport.simulateDisconnect();
    answer({ ok: true, latest });
    await new Promise((r) => setTimeout(r, 10));

    expect(controller.status()).toBe('connecting');
  });

  describe('when the Receiver role is taken', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
    afterEach(() => vi.useRealTimers());

    it('retries once, then explains that the Session already has a Receiver', async () => {
      const { encoded } = await generateSessionKey();
      const transport = new FakeTransport();
      transport.joinResponse = () => ({ ok: false, error: ErrorCode.RoleTaken });
      const controller = new ReceiverController({
        link: { sessionId: SESSION_ID, sessionKey: encoded },
        transport,
      });
      await controller.start();
      await vi.waitFor(() => expect(transport.joins).toHaveLength(1));
      expect(controller.status()).toBe('connecting');

      await vi.advanceTimersByTimeAsync(FIRST_JOIN_RETRY_DELAYS_MS[0]);

      await vi.waitFor(() => expect(controller.status()).toBe('role-taken'));
      expect(transport.joins).toHaveLength(2);
      expect(transport.closed).toBe(true);
      expect(controller.message()).toBeNull();
    });

    it('joins once a refreshed Receiver’s old connection has gone', async () => {
      const { encoded, key } = await generateSessionKey();
      const latest = await sealUpdate(key, SESSION_ID, 0, 'hello');
      const transport = new FakeTransport();
      let refusals = 1;
      transport.joinResponse = () =>
        refusals-- > 0 ? { ok: false, error: ErrorCode.RoleTaken } : { ok: true, latest };
      const controller = new ReceiverController({
        link: { sessionId: SESSION_ID, sessionKey: encoded },
        transport,
      });
      await controller.start();
      await vi.advanceTimersByTimeAsync(FIRST_JOIN_RETRY_DELAYS_MS[0]);

      await vi.waitFor(() => expect(controller.status()).toBe('live'));
      expect(controller.message()).toBe('hello');
    });

    it('stops retrying when disposed', async () => {
      const { encoded } = await generateSessionKey();
      const transport = new FakeTransport();
      transport.joinResponse = () => ({ ok: false, error: ErrorCode.RoleTaken });
      const controller = new ReceiverController({
        link: { sessionId: SESSION_ID, sessionKey: encoded },
        transport,
      });
      await controller.start();
      await vi.waitFor(() => expect(transport.joins).toHaveLength(1));
      controller.dispose();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(transport.joins).toHaveLength(1);
    });
  });
});
