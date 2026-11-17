import { expect, test } from '@playwright/test';
import { createSession } from './support/session';

test('a Receiver opening a new Session sees the verified empty state', async ({ browser }) => {
  const senderContext = await browser.newContext();
  const receiverContext = await browser.newContext();
  const session = await createSession(await senderContext.newPage());

  const receiver = await receiverContext.newPage();
  const requestedUrls: string[] = [];
  receiver.on('request', (req) => requestedUrls.push(req.url()));
  await receiver.goto(session.receiverLink);

  await expect(receiver.getByTestId('empty-message')).toHaveText(
    "The sender hasn't written anything yet.",
  );
  await expect(receiver.getByTestId('receiver-status')).toHaveText('Live');
  // The key lives only in the fragment, which never reaches the network.
  expect(requestedUrls.some((url) => url.includes(session.sessionKey))).toBe(false);

  await senderContext.close();
  await receiverContext.close();
});

test('a Receiver Link for an unknown Session explains that it does not exist', async ({ page }) => {
  await page.goto(`/r/${'A'.repeat(22)}#k=${'B'.repeat(43)}`);
  await expect(page.getByRole('alert')).toContainText("doesn't exist or has ended");
});

test('a Receiver Link without its key is reported as invalid', async ({ page }) => {
  await page.goto(`/r/${'A'.repeat(22)}`);
  await expect(page.getByRole('alert')).toContainText('invalid or incomplete');
});
