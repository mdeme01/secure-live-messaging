import { generateSessionKey, sealUpdate } from '@slm/crypto';
import { ErrorCode, type JoinAck, type SealedUpdate } from '@slm/protocol';
import { ReceiverController } from './receiver-controller';
import { FakeTransport } from './testing/fake-transport';

const SESSION_ID = 'abcDEF0123456789_-xyzA';
const OTHER_SESSION_ID = 'zzzDEF0123456789_-xyzA';
const NOW = new Date('2026-01-01T10:00:00Z');

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
});
