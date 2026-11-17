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
  return { harness, el: () => harness.routeNativeElement as HTMLElement };
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

  it('explains a link without its key', async () => {
    const { el } = await open(`/r/${id}`);
    expect(el().querySelector('[role=alert]')?.textContent).toContain('invalid or incomplete');
  });
});
