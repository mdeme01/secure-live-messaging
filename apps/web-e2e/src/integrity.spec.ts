import { expect, test, type Page } from '@playwright/test';
import { createSession } from './support/session';

/** socket.io event frame from the server: engine.io "message" (4) + socket.io "event" (2) + JSON. */
const EVENT_PREFIX = '42';
const UPDATE_FRAME_PREFIX = `${EVENT_PREFIX}["update"`;

/** Flips one bit of the first ciphertext byte of an `update` event frame. */
function tamperUpdateFrame(frame: string): string {
  const [event, update] = JSON.parse(frame.slice(EVENT_PREFIX.length));
  const bytes = Buffer.from(update.ciphertext, 'base64url');
  bytes[0] ^= 0x01;
  const tampered = { ...update, ciphertext: bytes.toString('base64url') };
  return EVENT_PREFIX + JSON.stringify([event, tampered]);
}

/**
 * Puts a man-in-the-middle between the Receiver and the server. Frames pass through
 * untouched until `tamperNextUpdate()` is called; then the next `update` frame is altered.
 */
async function interceptReceiverSocket(page: Page) {
  let tamper = false;
  let tampered = 0;
  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (tamper && typeof message === 'string' && message.startsWith(UPDATE_FRAME_PREFIX)) {
        tamper = false;
        tampered++;
        ws.send(tamperUpdateFrame(message));
        return;
      }
      ws.send(message);
    });
  });
  return {
    tamperNextUpdate: () => (tamper = true),
    tamperedCount: () => tampered,
  };
}

test('a tampered Update is never shown; the last verified Message stays until a genuine one', async ({
  browser,
}) => {
  const senderContext = await browser.newContext();
  const receiverContext = await browser.newContext();
  const sender = await senderContext.newPage();
  const session = await createSession(sender);
  const editor = sender.getByTestId('editor');
  await expect(editor).toBeEnabled();

  const receiver = await receiverContext.newPage();
  const mitm = await interceptReceiverSocket(receiver);
  await receiver.goto(session.receiverLink);
  await expect(receiver.getByTestId('empty-message')).toBeVisible();

  await editor.fill('verified message');
  await expect(receiver.getByTestId('message')).toHaveText('verified message');

  mitm.tamperNextUpdate();
  await editor.fill('this update gets tampered');
  const banner = receiver.getByTestId('integrity-banner');
  await expect(banner).toHaveText(
    'Latest update failed integrity check — showing last verified message',
  );
  expect(mitm.tamperedCount()).toBe(1);
  await expect(receiver.getByTestId('message')).toHaveText('verified message');
  await expect(receiver.getByText('this update gets tampered')).toHaveCount(0);

  await editor.fill('next genuine update');
  await expect(receiver.getByTestId('message')).toHaveText('next genuine update');
  await expect(banner).toHaveCount(0);

  await senderContext.close();
  await receiverContext.close();
});
