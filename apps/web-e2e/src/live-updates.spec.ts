import { expect, test, type Page } from '@playwright/test';
import { createSession } from './support/session';

/** Collects every WebSocket frame the page sends, to check what leaves the browser. */
function recordSentFrames(page: Page): string[] {
  const frames: string[] = [];
  page.on('websocket', (ws) =>
    ws.on('framesent', ({ payload }) => frames.push(payload.toString())),
  );
  return frames;
}

test('the Receiver sees consecutive edits live, and only ciphertext leaves the Sender', async ({
  browser,
}) => {
  const senderContext = await browser.newContext();
  const receiverContext = await browser.newContext();
  const sender = await senderContext.newPage();
  const frames = recordSentFrames(sender);
  const session = await createSession(sender);

  const receiver = await receiverContext.newPage();
  await receiver.goto(session.receiverLink);
  await expect(receiver.getByTestId('empty-message')).toBeVisible();

  const editor = sender.getByTestId('editor');
  await expect(editor).toBeEnabled();

  await editor.fill('First secret line');
  await expect(sender.getByTestId('sender-status')).toHaveText(/Sent at \d{2}:\d{2}:\d{2}/);
  await expect(receiver.getByTestId('message')).toHaveText('First secret line');

  await editor.fill('First secret line, then a second one');
  await expect(receiver.getByTestId('message')).toHaveText('First secret line, then a second one');
  await expect(receiver.getByTestId('receiver-status')).toHaveText('Live');

  expect(frames.some((f) => f.includes('update:publish'))).toBe(true);
  expect(frames.some((f) => f.includes('secret'))).toBe(false);
  expect(frames.some((f) => f.includes(session.sessionKey))).toBe(false);

  await senderContext.close();
  await receiverContext.close();
});

test('a late Receiver and a reloaded Sender both get the current Message', async ({ browser }) => {
  const senderContext = await browser.newContext();
  const sender = await senderContext.newPage();
  const session = await createSession(sender);

  await sender.getByTestId('editor').fill('written before anyone joined');
  await expect(sender.getByTestId('sender-status')).toHaveText(/Sent at \d{2}:\d{2}:\d{2}/);

  const receiverContext = await browser.newContext();
  const receiver = await receiverContext.newPage();
  await receiver.goto(session.receiverLink);
  await expect(receiver.getByTestId('message')).toHaveText('written before anyone joined');

  await sender.reload();
  await expect(sender.getByTestId('editor')).toHaveValue('written before anyone joined');
  await expect(sender.getByTestId('editor')).toBeEnabled();

  await sender.getByTestId('editor').fill('edited after reload');
  await expect(receiver.getByTestId('message')).toHaveText('edited after reload');

  await senderContext.close();
  await receiverContext.close();
});

test('text over the size limit is refused instead of sent', async ({ page }) => {
  await createSession(page);
  const editor = page.getByTestId('editor');
  await expect(editor).toBeEnabled();
  await editor.fill('x'.repeat(70_000));
  await expect(page.getByTestId('sender-status')).toContainText('Too long to send');
});
