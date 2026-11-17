import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { generateSessionKey, sealUpdate } from '@slm/crypto';
import { ErrorCode, type JoinAck } from '@slm/protocol';
import { appRoutes } from '../../app.routes';
import { FakeTransport } from '../../live/testing/fake-transport';
import { LIVE_TRANSPORT, type TransportAuth } from '../../live/transport';
import { SessionApi } from '../../session/session-api';

const id = 'abcDEF0123456789_-xyzA';
const token = 'T'.repeat(43);

async function open(url: string, joinResponse?: () => JoinAck) {
  const transport = new FakeTransport();
  const auths: TransportAuth[] = [];
  const endSession = vi.fn(async (): Promise<'ended' | 'not-found'> => 'ended');
  if (joinResponse) transport.joinResponse = joinResponse;
  TestBed.configureTestingModule({
    providers: [
      provideRouter(appRoutes),
      {
        provide: LIVE_TRANSPORT,
        useValue: (auth: TransportAuth) => (auths.push(auth), transport),
      },
      { provide: SessionApi, useValue: { endSession } },
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  const el = () => harness.routeNativeElement as HTMLElement;
  const settle = async (assertion: () => void) =>
    vi.waitFor(async () => {
      await harness.fixture.whenStable();
      assertion();
    });
  return { harness, transport, auths, endSession, el, settle };
}

async function newSession(text = '') {
  const { encoded, key } = await generateSessionKey();
  const latest = await sealUpdate(key, id, 0, text);
  return { key: encoded, joinResponse: (): JoinAck => ({ ok: true, latest }) };
}

const valueOf = (el: HTMLElement, testId: string) =>
  (el.querySelector(`[data-testid=${testId}]`) as HTMLInputElement).value;
const editor = (el: HTMLElement) => el.querySelector('[data-testid=editor]') as HTMLTextAreaElement;
const status = (el: HTMLElement) =>
  el.querySelector('[data-testid=sender-status]')?.textContent?.trim();

describe('SenderPage', () => {
  it('shows a Receiver Link without the Sender Token, and the private Sender Link', async () => {
    const { key, joinResponse } = await newSession();
    const { el } = await open(`/s/${id}#k=${key}&t=${token}`, joinResponse);

    expect(valueOf(el(), 'receiver-link')).toBe(`${location.origin}/r/${id}#k=${key}`);
    expect(valueOf(el(), 'sender-link')).toBe(`${location.origin}/s/${id}#k=${key}&t=${token}`);
    expect(el().textContent).toContain('Keep this private');
  });

  it('connects with the Sender Token and enables the editor with the current Message', async () => {
    const { key, joinResponse } = await newSession('hello');
    const { el, auths, settle } = await open(`/s/${id}#k=${key}&t=${token}`, joinResponse);

    await settle(() => expect(editor(el()).disabled).toBe(false));
    expect(auths).toEqual([{ senderToken: token }]);
    expect(editor(el()).value).toBe('hello');
    expect(status(el())).toContain('Live');
  });

  it('sends what is typed and reports when it was sent', async () => {
    const { key, joinResponse } = await newSession();
    const { el, transport, settle } = await open(`/s/${id}#k=${key}&t=${token}`, joinResponse);
    await settle(() => expect(editor(el()).disabled).toBe(false));

    editor(el()).value = 'typed';
    editor(el()).dispatchEvent(new Event('input'));

    await settle(() => expect(status(el())).toMatch(/^Sent at \d{2}:\d{2}:\d{2}$/));
    expect(transport.published).toHaveLength(1);
  });

  it('explains a Sender Token the server rejects', async () => {
    const { key } = await newSession();
    const { el, settle } = await open(`/s/${id}#k=${key}&t=${token}`, () => ({
      ok: false,
      error: ErrorCode.Unauthorized,
    }));
    await settle(() => expect(el().textContent).toContain("isn't valid for this session"));
  });

  it('shows whether the Receiver is connected', async () => {
    const { key, joinResponse } = await newSession();
    const { el, transport, settle } = await open(`/s/${id}#k=${key}&t=${token}`, joinResponse);
    const presence = () =>
      el().querySelector('[data-testid=receiver-presence]')?.textContent?.trim();

    await settle(() => expect(presence()).toBe('Waiting for receiver'));
    transport.simulatePresence({ receiverConnected: true });
    await settle(() => expect(presence()).toBe('Receiver connected'));
  });

  it('explains when the Session is already open in another tab', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { key } = await newSession();
      const { el, harness } = await open(`/s/${id}#k=${key}&t=${token}`, () => ({
        ok: false,
        error: ErrorCode.RoleTaken,
      }));
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(async () => {
        await harness.fixture.whenStable();
        expect(el().textContent).toContain('already open in another tab');
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers to end the Session only once this tab has joined', async () => {
    const { key, joinResponse } = await newSession();
    let answer!: () => void;
    const joined = new Promise<void>((resolve) => (answer = resolve));
    const { el, transport, settle } = await open(`/s/${id}#k=${key}&t=${token}`);
    transport.join = async (request) => {
      transport.joins.push(request);
      await joined;
      return joinResponse();
    };
    transport.simulateConnect();

    await settle(() => expect(status(el())).toContain('Connecting'));
    expect(el().querySelector('[data-testid=end-session]')).toBeNull();

    answer();
    await settle(() => expect(el().querySelector('[data-testid=end-session]')).not.toBeNull());
  });

  it('ends the Session only after confirmation', async () => {
    const { key, joinResponse } = await newSession();
    const { el, endSession, settle } = await open(`/s/${id}#k=${key}&t=${token}`, joinResponse);
    const click = (testId: string) =>
      (el().querySelector(`[data-testid=${testId}]`) as HTMLButtonElement).click();
    await settle(() => expect(editor(el()).disabled).toBe(false));

    click('end-session');
    await settle(() => expect(el().textContent).toContain("This can't be undone"));
    click('cancel-end');
    await settle(() => expect(el().querySelector('[data-testid=confirm-end]')).toBeNull());
    expect(endSession).not.toHaveBeenCalled();

    click('end-session');
    await settle(() => expect(el().querySelector('[data-testid=confirm-end]')).not.toBeNull());
    click('confirm-end');
    await settle(() =>
      expect(el().querySelector('[data-testid=session-ended]')?.textContent).toContain(
        'You ended this session',
      ),
    );
    expect(endSession).toHaveBeenCalledTimes(1);
  });

  it('explains a Session that expired', async () => {
    const { key, joinResponse } = await newSession();
    const { el, transport, settle } = await open(`/s/${id}#k=${key}&t=${token}`, joinResponse);
    await settle(() => expect(editor(el()).disabled).toBe(false));
    transport.simulateEnded({ reason: 'expired' });
    await settle(() => expect(el().textContent).toContain('expired after an hour'));
  });

  it('explains when the link is missing its secrets', async () => {
    const { key } = await newSession();
    const { el } = await open(`/s/${id}#k=${key}`);
    expect(el().querySelector('[role=alert]')?.textContent).toContain('invalid or incomplete');
  });
});
