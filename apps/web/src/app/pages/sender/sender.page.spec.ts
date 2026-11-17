import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes } from '../../app.routes';

const id = 'abcDEF0123456789_-xyzA';
const key = 'K'.repeat(43);
const token = 'T'.repeat(43);

async function open(url: string) {
  TestBed.configureTestingModule({ providers: [provideRouter(appRoutes)] });
  const harness = await RouterTestingHarness.create(url);
  return harness.routeNativeElement as HTMLElement;
}

const valueOf = (el: HTMLElement, testId: string) =>
  (el.querySelector(`[data-testid=${testId}]`) as HTMLInputElement).value;

describe('SenderPage', () => {
  it('shows a Receiver Link without the Sender Token, and the private Sender Link', async () => {
    const el = await open(`/s/${id}#k=${key}&t=${token}`);

    expect(valueOf(el, 'receiver-link')).toBe(`${location.origin}/r/${id}#k=${key}`);
    expect(valueOf(el, 'sender-link')).toBe(`${location.origin}/s/${id}#k=${key}&t=${token}`);
    expect(el.textContent).toContain('Keep this private');
  });

  it('explains when the link is missing its secrets', async () => {
    const el = await open(`/s/${id}#k=${key}`);
    expect(el.querySelector('[role=alert]')?.textContent).toContain('invalid or incomplete');
  });
});
