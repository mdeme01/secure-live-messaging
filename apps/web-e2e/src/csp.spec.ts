import { expect, test, type Page } from '@playwright/test';
import { createSession } from './support/session';

/** Records every CSP violation the page reports, from the very first script on. */
async function recordCspViolations(page: Page): Promise<() => Promise<string[]>> {
  const console: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) console.push(message.text());
  });
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = seen;
    document.addEventListener('securitypolicyviolation', (e) =>
      seen.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  return async () => [
    ...console,
    ...(await page.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
    )),
  ];
}

test('the whole flow runs under a strict CSP with no violations', async ({ browser }) => {
  const senderContext = await browser.newContext();
  const sender = await senderContext.newPage();
  const senderViolations = await recordCspViolations(sender);
  const session = await createSession(sender);

  const receiverContext = await browser.newContext();
  const receiver = await receiverContext.newPage();
  const receiverViolations = await recordCspViolations(receiver);
  await receiver.goto(session.receiverLink);
  await sender.getByTestId('editor').fill('under CSP');
  await expect(receiver.getByTestId('message')).toHaveText('under CSP');

  const csp = await sender
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain('unsafe-inline');
  expect(csp).not.toContain('unsafe-eval');
  expect(await senderViolations()).toEqual([]);
  expect(await receiverViolations()).toEqual([]);

  await senderContext.close();
  await receiverContext.close();
});

test('the page tells the browser never to send a Referer', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  expect(await page.evaluate(() => document.referrer)).toBe('');
});
