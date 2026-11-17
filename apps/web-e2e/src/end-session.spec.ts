import { expect, test } from '@playwright/test';
import { createSession } from './support/session';

test('the Sender ends the Session: the Receiver is told at once and both links stop working', async ({
  browser,
}) => {
  const senderContext = await browser.newContext();
  const sender = await senderContext.newPage();
  const session = await createSession(sender);
  const receiverContext = await browser.newContext();
  const receiver = await receiverContext.newPage();
  await receiver.goto(session.receiverLink);
  await sender.getByTestId('editor').fill('about to be deleted');
  await expect(receiver.getByTestId('message')).toHaveText('about to be deleted');

  await sender.getByTestId('end-session').click();
  await sender.getByTestId('cancel-end').click();
  await expect(receiver.getByTestId('message')).toHaveText('about to be deleted');

  await sender.getByTestId('end-session').click();
  await sender.getByTestId('confirm-end').click();
  await expect(sender.getByTestId('session-ended')).toContainText('You ended this session');
  await expect(receiver.getByTestId('session-ended')).toContainText(
    'The sender ended this session.',
  );
  await expect(receiver.getByText('about to be deleted')).toHaveCount(0);

  for (const [page, link] of [
    [sender, session.senderLink],
    [receiver, session.receiverLink],
  ] as const) {
    await page.goto('about:blank');
    await page.goto(link);
    await expect(page.getByRole('heading')).toHaveText("This session doesn't exist or has ended");
  }

  await senderContext.close();
  await receiverContext.close();
});
