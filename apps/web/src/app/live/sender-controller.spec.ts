import { generateSessionKey, MAX_MESSAGE_BYTES, openUpdate, sealUpdate } from '@slm/crypto';
import { ErrorCode, type PublishAck, type SealedUpdate } from '@slm/protocol';
import { SenderController, DEBOUNCE_MS, type EndSessionResult } from './sender-controller';
import { FIRST_JOIN_RETRY_DELAYS_MS, UNANSWERED_JOIN_RETRY_MS } from './join-session';
import { FakeTransport } from './testing/fake-transport';

const SESSION_ID = 'abcDEF0123456789_-xyzA';
const TOKEN = 'T'.repeat(43);
const NOW = new Date('2026-01-01T10:00:00Z');
const endedOk = async (): Promise<EndSessionResult> => 'ended';

async function setup({ latestText = '', latestSeq = 0, endSession = endedOk } = {}) {
  const { encoded, key } = await generateSessionKey();
  let latest: SealedUpdate = await sealUpdate(key, SESSION_ID, latestSeq, latestText);

  const transport = new FakeTransport();
  transport.joinResponse = () => ({ ok: true, latest });
  // Behaves like the server: accepts only newer Sequence Numbers and remembers the latest.
  transport.publishResponse = (update) => {
    if (update.seq <= latest.seq) return { ok: false, error: ErrorCode.StaleSequence };
    latest = update;
    return { ok: true };
  };
  const controller = new SenderController({
    link: { sessionId: SESSION_ID, sessionKey: encoded, senderToken: TOKEN },
    transport,
    now: () => NOW,
    endSession,
  });
  await controller.start();
  await vi.waitFor(() => expect(controller.status()).toBe('ready'));

  const decrypt = async (update: SealedUpdate) => {
    const result = await openUpdate(key, SESSION_ID, null, update);
    if (!result.ok) throw new Error(`could not open: ${result.reason}`);
    return result.text;
  };
  const texts = () => Promise.all(transport.published.map(decrypt));

  return { controller, transport, key, texts, setLatest: (u: SealedUpdate) => (latest = u) };
}

describe('SenderController', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('joins as sender and rehydrates the editor from the latest Update', async () => {
    const { controller, transport } = await setup({ latestText: 'draft so far', latestSeq: 4 });

    expect(transport.joins).toEqual([{ sessionId: SESSION_ID, role: 'sender' }]);
    expect(controller.text()).toBe('draft so far');
    expect(transport.published).toEqual([]);
  });

  it('debounces typing into one encrypted Update with the next Sequence Number', async () => {
    const { controller, transport, texts } = await setup({ latestSeq: 4 });

    controller.setText('h');
    controller.setText('he');
    controller.setText('hey');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(transport.published).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(controller.status()).toBe('sent'));
    expect(transport.published.map((u) => u.seq)).toEqual([5]);
    expect(await texts()).toEqual(['hey']);
    expect(controller.lastSentAt()).toEqual(NOW);
  });

  it('never sends the plaintext over the transport', async () => {
    const { controller, transport } = await setup();
    controller.setText('top secret');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.waitFor(() => expect(controller.status()).toBe('sent'));
    expect(JSON.stringify(transport.published)).not.toContain('top secret');
  });

  it('sends consecutive edits as increasing Sequence Numbers', async () => {
    const { controller, transport, texts } = await setup();

    controller.setText('first');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.waitFor(() => expect(controller.status()).toBe('sent'));
    controller.setText('second');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.waitFor(() => expect(transport.published).toHaveLength(2));
    await vi.waitFor(() => expect(controller.status()).toBe('sent'));

    expect(transport.published.map((u) => u.seq)).toEqual([1, 2]);
    expect(await texts()).toEqual(['first', 'second']);
  });

  it('keeps one publish in flight and then sends only the latest text', async () => {
    const { controller, transport, texts } = await setup();
    let releaseFirst!: (ack: PublishAck) => void;
    const respond = transport.publishResponse;
    transport.publishResponse = (update) => {
      if (update.seq === 1) {
        return new Promise<PublishAck>((resolve) => (releaseFirst = resolve)).then(() =>
          respond(update),
        );
      }
      return respond(update);
    };

    controller.setText('a');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.waitFor(() => expect(transport.published).toHaveLength(1));
    controller.setText('ab');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    controller.setText('abc');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(transport.published).toHaveLength(1);

    releaseFirst({ ok: true });
    await vi.waitFor(() => expect(transport.published).toHaveLength(2));
    await vi.waitFor(() => expect(controller.status()).toBe('sent'));
    expect(await texts()).toEqual(['a', 'abc']);
    expect(transport.published.map((u) => u.seq)).toEqual([1, 2]);
  });

  it('does not send when the text is back to what was last sent', async () => {
    const { controller, transport } = await setup({ latestText: 'same' });
    controller.setText('samex');
    controller.setText('same');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(transport.published).toEqual([]);
    expect(controller.status()).toBe('ready');
  });

  it('refuses text over the size limit instead of sending it', async () => {
    const { controller, transport } = await setup();
    controller.setText('x'.repeat(MAX_MESSAGE_BYTES + 1));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(controller.status()).toBe('too-long');
    expect(transport.published).toEqual([]);

    controller.setText('x'.repeat(MAX_MESSAGE_BYTES));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.waitFor(() => expect(controller.status()).toBe('sent'));
  });

  it('counts the limit in UTF-8 bytes, not characters', async () => {
    const { controller } = await setup();
    controller.setText('é'.repeat(MAX_MESSAGE_BYTES / 2 + 1));
    expect(controller.status()).toBe('too-long');
  });

  it('goes offline on disconnect and sends unsent edits after rejoining', async () => {
    const { controller, transport, texts } = await setup();
    transport.simulateDisconnect();
    expect(controller.status()).toBe('offline');

    controller.setText('typed while offline');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(transport.published).toEqual([]);

    transport.simulateConnect();
    await vi.waitFor(() => expect(controller.status()).toBe('sent'));
    expect(await texts()).toEqual(['typed while offline']);
    expect(controller.text()).toBe('typed while offline');
  });

  it('retries a join that got no answer while the connection stayed up', async () => {
    const { controller, transport, texts } = await setup();
    const answer = transport.joinResponse;
    let unanswered = true;
    transport.joinResponse = (request) => {
      if (!unanswered) return answer(request);
      unanswered = false;
      throw new Error('operation has timed out');
    };
    transport.simulateDisconnect();
    controller.setText('typed while offline');
    transport.simulateConnect();
    await vi.advanceTimersByTimeAsync(UNANSWERED_JOIN_RETRY_MS);
    await vi.waitFor(() => expect(controller.status()).toBe('sent'));
    expect(transport.joins).toHaveLength(3);
    expect(await texts()).toEqual(['typed while offline']);
  });

  it('keeps the too-long warning while offline', async () => {
    const { controller, transport } = await setup();
    controller.setText('é'.repeat(MAX_MESSAGE_BYTES / 2 + 1));
    transport.simulateDisconnect();
    expect(controller.status()).toBe('too-long');
  });

  it('ends the Session on request and stops', async () => {
    const endSession = vi.fn(endedOk);
    const { controller, transport } = await setup({ endSession });

    await controller.end();

    expect(endSession).toHaveBeenCalledTimes(1);
    expect(controller.status()).toBe('ended');
    expect(controller.endedReason()).toBe('ended-by-sender');
    expect(controller.editable()).toBe(false);
    expect(transport.closed).toBe(true);
  });

  it('cannot end the Session before this tab has joined as the Sender', async () => {
    // E.g. a second tab with the Sender Link, while its join is refused and retried.
    const endSession = vi.fn(endedOk);
    const { encoded } = await generateSessionKey();
    const transport = new FakeTransport();
    transport.joinResponse = () => ({ ok: false, error: ErrorCode.RoleTaken });
    const controller = new SenderController({
      link: { sessionId: SESSION_ID, sessionKey: encoded, senderToken: TOKEN },
      transport,
      endSession,
    });
    await controller.start();
    await vi.waitFor(() => expect(transport.joins).toHaveLength(1));

    expect(controller.canEnd()).toBe(false);
    await controller.end();
    expect(endSession).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(FIRST_JOIN_RETRY_DELAYS_MS[0]);
    await vi.waitFor(() => expect(controller.status()).toBe('role-taken'));
    expect(controller.canEnd()).toBe(false);
    expect(endSession).not.toHaveBeenCalled();
  });

  it('can still end the Session while offline once it has joined', async () => {
    const endSession = vi.fn(endedOk);
    const { controller, transport } = await setup({ endSession });
    transport.simulateDisconnect();
    expect(controller.status()).toBe('offline');

    expect(controller.canEnd()).toBe(true);
    await controller.end();
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(controller.status()).toBe('ended');
  });

  it('freezes the editor while ending, so nothing typed meanwhile is lost unseen', async () => {
    let finish!: (result: EndSessionResult) => void;
    const { controller } = await setup({
      endSession: () => new Promise<EndSessionResult>((resolve) => (finish = resolve)),
    });
    const ending = controller.end();
    expect(controller.editable()).toBe(false);
    finish('ended');
    await ending;
    expect(controller.status()).toBe('ended');
  });

  it('shows the Session as gone when it had already expired before being ended', async () => {
    const { controller } = await setup({ endSession: async () => 'not-found' });
    await controller.end();
    expect(controller.status()).toBe('not-found');
    expect(controller.endedReason()).toBeNull();
  });

  it('stays usable and reports it when ending the Session fails', async () => {
    const { controller } = await setup({
      endSession: async () => {
        throw new Error('offline');
      },
    });

    await controller.end();

    expect(controller.endFailed()).toBe(true);
    expect(controller.status()).toBe('ready');
    expect(controller.editable()).toBe(true);
  });

  it('stops when the server says the Session expired', async () => {
    const { controller, transport } = await setup();
    controller.setText('unsent');
    transport.simulateEnded({ reason: 'expired' });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(controller.status()).toBe('ended');
    expect(controller.endedReason()).toBe('expired');
    expect(transport.published).toEqual([]);
  });

  it('abandons a publish cut off by a disconnect and continues from the server’s state', async () => {
    const { controller, transport, texts, key, setLatest } = await setup();
    transport.publishResponse = () => new Promise<PublishAck>(() => undefined); // never acked

    controller.setText('lost?');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.waitFor(() => expect(controller.status()).toBe('sending'));
    transport.simulateDisconnect();

    // The server did store it before the connection dropped.
    setLatest(await sealUpdate(key, SESSION_ID, 1, 'lost?'));
    transport.publishResponse = () => ({ ok: true });
    transport.simulateConnect();
    // Nothing to resend: the server already holds what the editor shows.
    await vi.waitFor(() => expect(controller.status()).toBe('ready'));
    expect(transport.published).toHaveLength(1);

    controller.setText('lost? no');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.waitFor(() => expect(transport.published).toHaveLength(2));
    expect(transport.published.map((u) => u.seq)).toEqual([1, 2]);
    expect(await texts()).toEqual(['lost?', 'lost? no']);
  });

  it('shows an error instead of overwriting when the latest Update cannot be verified', async () => {
    const transport = new FakeTransport();
    const other = await generateSessionKey();
    const foreign = await sealUpdate(other.key, SESSION_ID, 3, 'from a different key');
    transport.joinResponse = () => ({ ok: true, latest: foreign });
    const { encoded } = await generateSessionKey();
    const controller = new SenderController({
      link: { sessionId: SESSION_ID, sessionKey: encoded, senderToken: TOKEN },
      transport,
      endSession: endedOk,
    });
    await controller.start();

    await vi.waitFor(() => expect(controller.status()).toBe('unverifiable'));
    controller.setText('overwrite');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(transport.published).toEqual([]);
    expect(transport.closed).toBe(true);
  });

  it.each([
    [ErrorCode.SessionNotFound, 'not-found'],
    [ErrorCode.Unauthorized, 'unauthorized'],
    [ErrorCode.RoleTaken, 'role-taken'],
  ] as const)('reports a %s join rejection', async (error, status) => {
    const transport = new FakeTransport();
    transport.joinResponse = () => ({ ok: false, error });
    const { encoded } = await generateSessionKey();
    const controller = new SenderController({
      link: { sessionId: SESSION_ID, sessionKey: encoded, senderToken: TOKEN },
      transport,
      endSession: endedOk,
    });
    await controller.start();
    await vi.advanceTimersByTimeAsync(FIRST_JOIN_RETRY_DELAYS_MS[0]);
    await vi.waitFor(() => expect(controller.status()).toBe(status));
    expect(transport.closed).toBe(true);
  });

  it('reports an error when a publish is rejected and retries on the next edit', async () => {
    const { controller, transport } = await setup();
    const respond = transport.publishResponse;
    transport.publishResponse = () => ({ ok: false, error: ErrorCode.InvalidPayload });

    controller.setText('one');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.waitFor(() => expect(controller.status()).toBe('error'));

    transport.publishResponse = respond;
    controller.setText('one two');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.waitFor(() => expect(controller.status()).toBe('sent'));
    expect(transport.published.at(-1)?.seq).toBe(1);
  });

  it('stops sending after dispose', async () => {
    const { controller, transport } = await setup();
    controller.setText('pending');
    controller.dispose();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(transport.published).toEqual([]);
    expect(transport.closed).toBe(true);
  });

  it('resyncs with the server after STALE_SEQUENCE and sends on top of its latest Update', async () => {
    const { controller, transport, key, setLatest, texts } = await setup();
    // Someone else's Update reached the server first.
    setLatest(await sealUpdate(key, SESSION_ID, 5, 'written elsewhere'));

    controller.setText('mine');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.waitFor(() => expect(controller.status()).toBe('sent'));

    expect(transport.joins).toHaveLength(2);
    expect(transport.published.map((u) => u.seq)).toEqual([1, 6]);
    expect(await texts()).toEqual(['mine', 'mine']);
  });

  it('resyncs after a lost ack instead of resending the same Sequence Number', async () => {
    const { controller, transport } = await setup();
    const respond = transport.publishResponse;
    transport.publishResponse = async (update) => {
      await respond(update); // stored by the server…
      throw new Error('ack timeout'); // …but the ack never arrived
    };

    controller.setText('stored anyway');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.waitFor(() => expect(transport.joins).toHaveLength(2));
    await vi.waitFor(() => expect(controller.status()).toBe('ready'));

    transport.publishResponse = respond;
    controller.setText('stored anyway, and more');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.waitFor(() => expect(controller.status()).toBe('sent'));
    expect(transport.published.map((u) => u.seq)).toEqual([1, 2]);
  });

  it('reports an error instead of looping when the resync does not help', async () => {
    const { controller, transport } = await setup();
    transport.publishResponse = () => ({ ok: false, error: ErrorCode.StaleSequence });

    controller.setText('never accepted');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.waitFor(() => expect(controller.status()).toBe('error'));
    expect(transport.joins).toHaveLength(2);
    expect(transport.published).toHaveLength(2);
  });

  it('sends edits made during a failed publish without waiting for more typing', async () => {
    const { controller, transport, texts } = await setup();
    const respond = transport.publishResponse;
    let rejectFirst!: () => void;
    transport.publishResponse = (update) =>
      update.seq === 1 && transport.published.length === 1
        ? new Promise<PublishAck>(
            (resolve) =>
              (rejectFirst = () => resolve({ ok: false, error: ErrorCode.InvalidPayload })),
          )
        : respond(update);

    controller.setText('a');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.waitFor(() => expect(transport.published).toHaveLength(1));
    controller.setText('ab');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    rejectFirst();
    await vi.waitFor(() => expect(controller.status()).toBe('sent'));
    expect(await texts()).toEqual(['a', 'ab']);
  });

  it('keeps the too-long warning when an earlier publish settles', async () => {
    const { controller, transport } = await setup();
    const respond = transport.publishResponse;
    let release!: () => void;
    transport.publishResponse = (update) =>
      new Promise<PublishAck>(
        (resolve) => (release = () => resolve(respond(update) as PublishAck)),
      );

    controller.setText('short');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.waitFor(() => expect(transport.published).toHaveLength(1));
    controller.setText('x'.repeat(MAX_MESSAGE_BYTES + 1));
    release();

    await vi.waitFor(() => expect(controller.lastSentAt()).not.toBeNull());
    expect(controller.status()).toBe('too-long');
    expect(transport.published).toHaveLength(1);
  });

  it('shows whether a Receiver is connected, from the join ack and live presence', async () => {
    const { controller, transport } = await setup();
    expect(controller.receiverConnected()).toBe(false);

    transport.simulatePresence({ receiverConnected: true });
    expect(controller.receiverConnected()).toBe(true);
    transport.simulatePresence({ receiverConnected: false });
    expect(controller.receiverConnected()).toBe(false);
  });

  it('takes Receiver presence from the join ack', async () => {
    const { encoded, key } = await generateSessionKey();
    const latest = await sealUpdate(key, SESSION_ID, 0, '');
    const transport = new FakeTransport();
    transport.joinResponse = () => ({ ok: true, latest, presence: { receiverConnected: true } });
    const controller = new SenderController({
      link: { sessionId: SESSION_ID, sessionKey: encoded, senderToken: TOKEN },
      transport,
      endSession: endedOk,
    });
    await controller.start();
    await vi.waitFor(() => expect(controller.receiverConnected()).toBe(true));

    transport.simulateDisconnect();
    expect(controller.receiverConnected()).toBe(false);
  });

  it('retries a rejoin while its previous connection still holds the Sender slot', async () => {
    const { controller, transport } = await setup();
    const latestAck = transport.joinResponse;
    let refusals = 2;
    transport.joinResponse = (request) =>
      refusals-- > 0 ? { ok: false, error: ErrorCode.RoleTaken } : latestAck(request);

    transport.simulateDisconnect();
    transport.simulateConnect();
    await vi.advanceTimersByTimeAsync(1_000 + 2_000);

    await vi.waitFor(() => expect(controller.status()).toBe('ready'));
    expect(transport.joins).toHaveLength(4);
    expect(transport.closed).toBe(false);
  });
});
