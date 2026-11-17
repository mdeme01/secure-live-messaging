import { expect, test } from '@playwright/test';
import { SESSIONS_PATH } from '@slm/protocol';

test('creating a session shows a Receiver Link and a private Sender Link', async ({ page }) => {
  await page.goto('/');
  const createRequest = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().endsWith(SESSIONS_PATH),
  );
  await page.getByRole('button', { name: 'Create session' }).click();

  await expect(page).toHaveURL(/\/s\/[A-Za-z0-9_-]{22}#k=[A-Za-z0-9_-]{43}&t=[A-Za-z0-9_-]{43}$/);
  const [, sessionId, key, token] = /\/s\/([^#]+)#k=([^&]+)&t=(.+)$/.exec(page.url()) ?? [];
  const origin = new URL(page.url()).origin;

  await expect(page.getByTestId('receiver-link')).toHaveValue(`${origin}/r/${sessionId}#k=${key}`);
  await expect(page.getByTestId('sender-link')).toHaveValue(
    `${origin}/s/${sessionId}#k=${key}&t=${token}`,
  );
  await expect(page.getByText('Keep this private')).toBeVisible();

  // The server only ever learns the Session ID and ciphertext, never the Session Key.
  const body = (await createRequest).postData() ?? '';
  expect(body).toContain(sessionId);
  expect(body).not.toContain(key);
});
