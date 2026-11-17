import { ErrorCode, HEARTBEAT, type JoinAck } from '@slm/protocol';
import { joinSession, REJOIN_RETRY_DELAYS_MS } from './join-session';
import { FakeTransport } from './testing/fake-transport';

const request = { sessionId: 'abcDEF0123456789_-xyzA', role: 'receiver' } as const;
const taken: JoinAck = { ok: false, error: ErrorCode.RoleTaken };

describe('joinSession', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('keeps retrying a rejoin for longer than the server takes to notice a dead connection', () => {
    const total = REJOIN_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(HEARTBEAT.pingIntervalMs + HEARTBEAT.pingTimeoutMs);
  });

  it('retries ROLE_TAKEN after each delay and then gives up with it', async () => {
    const transport = new FakeTransport();
    transport.joinResponse = () => taken;
    const result = joinSession(transport, request, [100, 200], () => true);
    await vi.advanceTimersByTimeAsync(300);
    expect(await result).toEqual(taken);
    expect(transport.joins).toHaveLength(3);
  });

  it('does not retry other errors', async () => {
    const transport = new FakeTransport();
    transport.joinResponse = () => ({ ok: false, error: ErrorCode.SessionNotFound });
    expect(await joinSession(transport, request, [100], () => true)).toEqual({
      ok: false,
      error: ErrorCode.SessionNotFound,
    });
    expect(transport.joins).toHaveLength(1);
  });

  it('returns null once the attempt has been overtaken', async () => {
    const transport = new FakeTransport();
    transport.joinResponse = () => taken;
    let current = true;
    const result = joinSession(transport, request, [100, 200], () => current);
    current = false;
    await vi.advanceTimersByTimeAsync(300);
    expect(await result).toBeNull();
  });
});
