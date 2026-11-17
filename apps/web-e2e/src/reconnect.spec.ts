import { expect, test } from '@playwright/test';
import { controllableNetwork, countServerAcks, RECONNECT_TIMEOUT_MS } from './support/network';
import { createSession } from './support/session';

test('edits made while the Sender is offline reach the Receiver on reconnect', async ({
  browser,
}) => {
  const senderContext = await browser.newContext();
  const sender = await senderContext.newPage();
  const network = await controllableNetwork(sender);
  const session = await createSession(sender);
  const editor = sender.getByTestId('editor');
  const status = sender.getByTestId('sender-status');

  const receiverContext = await browser.newContext();
  const receiver = await receiverContext.newPage();
  await receiver.goto(session.receiverLink);
  await editor.fill('before the drop');
  await expect(receiver.getByTestId('message')).toHaveText('before the drop');

  await network.drop();
  await expect(status).toHaveText('Offline: changes will be sent on reconnect.');
  await editor.fill('typed while offline');
  await editor.fill('typed while offline, then edited');
  await expect(receiver.getByTestId('message')).toHaveText('before the drop');

  network.restore();
  await expect(receiver.getByTestId('message')).toHaveText('typed while offline, then edited', {
    timeout: RECONNECT_TIMEOUT_MS,
  });
  await expect(status).toHaveText(/Sent at \d{2}:\d{2}:\d{2}/);

  await senderContext.close();
  await receiverContext.close();
});

test('a Receiver that loses its connection catches up on reconnect without a false alarm', async ({
  browser,
}) => {
  const senderContext = await browser.newContext();
  const sender = await senderContext.newPage();
  const senderAcks = countServerAcks(sender);
  const session = await createSession(sender);
  const editor = sender.getByTestId('editor');

  const receiverContext = await browser.newContext();
  const receiver = await receiverContext.newPage();
  const network = await controllableNetwork(receiver);
  await receiver.goto(session.receiverLink);
  await editor.fill('first');
  await expect(receiver.getByTestId('message')).toHaveText('first');

  await network.drop();
  await expect(receiver.getByTestId('receiver-status')).toHaveText('Reconnecting…');
  const acksBefore = senderAcks();
  await editor.fill('sent while the receiver was away');
  // The server has stored it before the Receiver is back, so the Receiver must catch up on join.
  await expect.poll(senderAcks).toBeGreaterThan(acksBefore);

  network.restore();
  await expect(receiver.getByTestId('receiver-status')).toHaveText('Live', {
    timeout: RECONNECT_TIMEOUT_MS,
  });
  await expect(receiver.getByTestId('message')).toHaveText('sent while the receiver was away');
  await expect(receiver.getByTestId('integrity-banner')).toHaveCount(0);

  await editor.fill('and live again');
  await expect(receiver.getByTestId('message')).toHaveText('and live again');

  await senderContext.close();
  await receiverContext.close();
});

test('a refreshed Receiver shows the current Message and keeps receiving', async ({ browser }) => {
  const senderContext = await browser.newContext();
  const sender = await senderContext.newPage();
  const session = await createSession(sender);
  const editor = sender.getByTestId('editor');

  const receiverContext = await browser.newContext();
  const receiver = await receiverContext.newPage();
  await receiver.goto(session.receiverLink);
  await editor.fill('one');
  await expect(receiver.getByTestId('message')).toHaveText('one');
  await editor.fill('two');
  await expect(receiver.getByTestId('message')).toHaveText('two');

  await receiver.reload();
  await expect(receiver.getByTestId('message')).toHaveText('two');

  await editor.fill('three');
  await expect(receiver.getByTestId('message')).toHaveText('three');

  await senderContext.close();
  await receiverContext.close();
});
