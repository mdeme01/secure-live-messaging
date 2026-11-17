import { expect, test } from '@playwright/test';
import { SESSIONS_PATH } from '@slm/protocol';
import { createSession } from './support/session';

test('creating a session shows a Receiver Link and a private Sender Link', async ({ page }) => {
  const createRequest = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().endsWith(SESSIONS_PATH),
  );
  const session = await createSession(page);
  const origin = new URL(page.url()).origin;

  expect(session.receiverLink).toBe(`${origin}/r/${session.sessionId}#k=${session.sessionKey}`);
  expect(session.senderLink).toBe(
    `${origin}/s/${session.sessionId}#k=${session.sessionKey}&t=${session.senderToken}`,
  );
  await expect(page.getByText('Keep this private')).toBeVisible();

  // The server only ever learns the Session ID and ciphertext, never the Session Key.
  const body = (await createRequest).postData() ?? '';
  expect(body).toContain(session.sessionId);
  expect(body).not.toContain(session.sessionKey);
});
