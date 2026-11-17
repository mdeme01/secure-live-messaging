import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ErrorCode } from '@slm/protocol';
import { appRoutes } from '../../app.routes';
import { ApiError } from '../../session/session-api';
import { SessionCreator } from '../../session/session-creator';

const link = {
  sessionId: 'abcDEF0123456789_-xyzA',
  sessionKey: 'K'.repeat(43),
  senderToken: 'T'.repeat(43),
};

async function setup(create: () => Promise<typeof link>) {
  TestBed.configureTestingModule({
    providers: [provideRouter(appRoutes), { provide: SessionCreator, useValue: { create } }],
  });
  const harness = await RouterTestingHarness.create('/');
  const button = () => harness.routeNativeElement?.querySelector('button') as HTMLButtonElement;
  return { harness, button };
}

describe('LandingPage', () => {
  it('creates a session and opens the Sender Link', async () => {
    const { harness, button } = await setup(async () => link);
    button().click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe(
      `/s/${link.sessionId}#k=${link.sessionKey}&t=${link.senderToken}`,
    );
    expect(harness.routeNativeElement?.textContent).toContain('Receiver Link');
  });

  it('shows a clear error when the server is at capacity', async () => {
    const { harness, button } = await setup(() =>
      Promise.reject(new ApiError(ErrorCode.CapacityReached)),
    );
    button().click();
    await harness.fixture.whenStable();

    expect(harness.routeNativeElement?.querySelector('[role=alert]')?.textContent).toContain(
      'at capacity',
    );
    expect(button().disabled).toBe(false);
  });
});
