import { expect, test, type Page } from '@playwright/test';
import { createSession } from './support/session';

type WithViolations = Window & { __cspViolations: string[] };

/** Records every CSP violation the page reports, from the very first script on. */
async function recordCspViolations(page: Page): Promise<() => Promise<string[]>> {
  const consoleReports: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) consoleReports.push(message.text());
  });
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as WithViolations).__cspViolations = seen;
    document.addEventListener('securitypolicyviolation', (e) =>
      seen.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  return async () => [
    ...consoleReports,
    ...(await page.evaluate(() => (window as unknown as WithViolations).__cspViolations)),
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

test('the page carries a no-referrer policy', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
});
