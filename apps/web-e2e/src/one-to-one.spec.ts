import { expect, test } from '@playwright/test';
import { createSession } from './support/session';

test('a second Receiver is turned away while the first is connected', async ({ browser }) => {
  const senderContext = await browser.newContext();
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const session = await createSession(await senderContext.newPage());

  const first = await firstContext.newPage();
  await first.goto(session.receiverLink);
  await expect(first.getByTestId('receiver-status')).toHaveText('Live');

  const second = await secondContext.newPage();
  await second.goto(session.receiverLink);
  await expect(second.getByRole('alert')).toContainText('This session already has a receiver');
  await expect(second.getByTestId('empty-message')).toHaveCount(0);

  // Once the first Receiver leaves, the link works again.
  await firstContext.close();
  await second.reload();
  await expect(second.getByTestId('receiver-status')).toHaveText('Live');

  await senderContext.close();
  await secondContext.close();
});

test('a second tab with the Sender Link is told the Session is already open', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const sender = await context.newPage();
  const session = await createSession(sender);
  await expect(sender.getByTestId('editor')).toBeEnabled();

  const secondTab = await context.newPage();
  await secondTab.goto(session.senderLink);
  await expect(secondTab.getByRole('alert')).toContainText('already open in another tab');
  await expect(secondTab.getByTestId('editor')).toHaveCount(0);

  await context.close();
});

test('the Sender sees the Receiver arrive and leave', async ({ browser }) => {
  const senderContext = await browser.newContext();
  const sender = await senderContext.newPage();
  const session = await createSession(sender);
  const presence = sender.getByTestId('receiver-presence');
  await expect(presence).toHaveText('Waiting for receiver');

  const receiverContext = await browser.newContext();
  const receiver = await receiverContext.newPage();
  await receiver.goto(session.receiverLink);
  await expect(presence).toHaveText('Receiver connected');

  await receiverContext.close();
  await expect(presence).toHaveText('Waiting for receiver');

  await senderContext.close();
});

test('a refreshed Receiver gets its slot back', async ({ browser }) => {
  const senderContext = await browser.newContext();
  const session = await createSession(await senderContext.newPage());
  const receiverContext = await browser.newContext();
  const receiver = await receiverContext.newPage();
  await receiver.goto(session.receiverLink);
  await expect(receiver.getByTestId('receiver-status')).toHaveText('Live');

  await receiver.reload();
  await expect(receiver.getByTestId('receiver-status')).toHaveText('Live');

  await senderContext.close();
  await receiverContext.close();
});
