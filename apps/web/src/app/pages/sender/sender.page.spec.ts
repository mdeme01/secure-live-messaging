import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { generateSessionKey, sealUpdate } from '@slm/crypto';
import { ErrorCode, type JoinAck } from '@slm/protocol';
import { appRoutes } from '../../app.routes';
import { FakeTransport } from '../../live/testing/fake-transport';
import { LIVE_TRANSPORT, type TransportAuth } from '../../live/transport';

const id = 'abcDEF0123456789_-xyzA';
const token = 'T'.repeat(43);

async function open(url: string, joinResponse?: () => JoinAck) {
  const transport = new FakeTransport();
  const auths: TransportAuth[] = [];
  if (joinResponse) transport.joinResponse = joinResponse;
  TestBed.configureTestingModule({
    providers: [
      provideRouter(appRoutes),
      {
        provide: LIVE_TRANSPORT,
        useValue: (auth: TransportAuth) => (auths.push(auth), transport),
      },
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  const el = () => harness.routeNativeElement as HTMLElement;
  const settle = async (assertion: () => void) =>
    vi.waitFor(async () => {
      await harness.fixture.whenStable();
      assertion();
    });
  return { harness, transport, auths, el, settle };
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
    expect(status(el())).toContain('Ready');
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

  it('explains when the link is missing its secrets', async () => {
    const { key } = await newSession();
    const { el } = await open(`/s/${id}#k=${key}`);
    expect(el().querySelector('[role=alert]')?.textContent).toContain('invalid or incomplete');
  });
});
