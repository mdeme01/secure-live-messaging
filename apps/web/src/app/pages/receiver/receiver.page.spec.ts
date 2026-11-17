import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { generateSessionKey, sealUpdate } from '@slm/crypto';
import { ErrorCode, type JoinAck } from '@slm/protocol';
import { appRoutes } from '../../app.routes';
import { FakeTransport } from '../../live/testing/fake-transport';
import { LIVE_TRANSPORT } from '../../live/transport';

const id = 'abcDEF0123456789_-xyzA';

async function open(url: string, joinResponse?: () => JoinAck) {
  const transport = new FakeTransport();
  if (joinResponse) transport.joinResponse = joinResponse;
  TestBed.configureTestingModule({
    providers: [provideRouter(appRoutes), { provide: LIVE_TRANSPORT, useValue: () => transport }],
  });
  const harness = await RouterTestingHarness.create(url);
  return { harness, transport, el: () => harness.routeNativeElement as HTMLElement };
}

describe('ReceiverPage', () => {
  it('shows the verified empty state for a new Session', async () => {
    const { encoded, key } = await generateSessionKey();
    const latest = await sealUpdate(key, id, 0, '');
    const { harness, el } = await open(`/r/${id}#k=${encoded}`, () => ({ ok: true, latest }));

    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(el().querySelector('[data-testid=empty-message]')).not.toBeNull();
    });
    expect(el().querySelector('[data-testid=receiver-status]')?.textContent).toContain('Live');
  });

  it('explains a Session that does not exist', async () => {
    const { encoded } = await generateSessionKey();
    const { harness, el } = await open(`/r/${id}#k=${encoded}`, () => ({
      ok: false,
      error: ErrorCode.SessionNotFound,
    }));

    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(el().textContent).toContain("doesn't exist or has ended");
    });
  });

  it('explains a link whose key does not match the Session, without showing any text', async () => {
    const { key } = await generateSessionKey();
    const { encoded: wrongKey } = await generateSessionKey();
    const latest = await sealUpdate(key, id, 0, 'secret');
    const { harness, el } = await open(`/r/${id}#k=${wrongKey}`, () => ({ ok: true, latest }));

    await vi.waitFor(async () => {
      await harness.fixture.whenStable();
      expect(el().querySelector('[role=alert]')?.textContent).toContain("couldn't be verified");
    });
    expect(el().textContent).not.toContain('secret');
  });

  it('warns about a tampered Update, keeps the last verified Message, and clears on the next', async () => {
    const { encoded, key } = await generateSessionKey();
    const latest = await sealUpdate(key, id, 0, 'verified text');
    const { harness, el, transport } = await open(`/r/${id}#k=${encoded}`, () => ({
      ok: true,
      latest,
    }));
    const banner = () => el().querySelector('[data-testid=integrity-banner]');
    const settle = (assertion: () => void) =>
      vi.waitFor(async () => {
        await harness.fixture.whenStable();
        assertion();
      });
    await settle(() => expect(el().querySelector('[data-testid=message]')).not.toBeNull());
    expect(banner()).toBeNull();

    const forged = await sealUpdate(key, id, 1, 'tampered text');
    const flipped = (forged.ciphertext[0] === 'A' ? 'B' : 'A') + forged.ciphertext.slice(1);
    transport.simulateUpdate({ ...forged, ciphertext: flipped });

    await settle(() =>
      expect(banner()?.textContent).toContain(
        'Latest update failed integrity check — showing last verified message',
      ),
    );
    expect(banner()?.getAttribute('role')).toBe('alert');
    expect(el().querySelector('[data-testid=message]')?.textContent?.trim()).toBe('verified text');
    expect(el().textContent).not.toContain('tampered text');

    transport.simulateUpdate(await sealUpdate(key, id, 1, 'next genuine text'));
    await settle(() => expect(banner()).toBeNull());
    expect(el().querySelector('[data-testid=message]')?.textContent?.trim()).toBe(
      'next genuine text',
    );
  });

  it('explains when the Session already has a Receiver', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { encoded } = await generateSessionKey();
      const { harness, el } = await open(`/r/${id}#k=${encoded}`, () => ({
        ok: false,
        error: ErrorCode.RoleTaken,
      }));
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(async () => {
        await harness.fixture.whenStable();
        expect(el().querySelector('[role=alert]')?.textContent).toContain(
          'This session already has a receiver',
        );
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['ended-by-sender', 'The sender ended this session.'],
    ['expired', 'expired after an hour without activity'],
  ] as const)('tells the Receiver the Session ended (%s)', async (reason, text) => {
    const { encoded, key } = await generateSessionKey();
    const latest = await sealUpdate(key, id, 0, 'secret');
    const { harness, transport, el } = await open(`/r/${id}#k=${encoded}`, () => ({
      ok: true,
      latest,
    }));
    const stable = async (assertion: () => void) =>
      vi.waitFor(async () => {
        await harness.fixture.whenStable();
        assertion();
      });
    await stable(() => expect(el().querySelector('[data-testid=message]')).not.toBeNull());

    transport.simulateEnded({ reason });
    await stable(() =>
      expect(el().querySelector('[data-testid=session-ended]')?.textContent).toContain(text),
    );
    expect(el().textContent).not.toContain('secret');
  });

  it('explains a link without its key', async () => {
    const { el } = await open(`/r/${id}`);
    expect(el().querySelector('[role=alert]')?.textContent).toContain('invalid or incomplete');
  });
});
