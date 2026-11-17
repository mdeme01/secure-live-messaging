import { expect, type Page } from '@playwright/test';

export interface CreatedSession {
  sessionId: string;
  sessionKey: string;
  senderToken: string;
  receiverLink: string;
  senderLink: string;
}

/** Creates a Session through the UI and returns its links. */
export async function createSession(page: Page): Promise<CreatedSession> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create session' }).click();
  await expect(page).toHaveURL(/\/s\/[A-Za-z0-9_-]{22}#k=[A-Za-z0-9_-]{43}&t=[A-Za-z0-9_-]{43}$/);
  const [, sessionId, sessionKey, senderToken] =
    /\/s\/([^#]+)#k=([^&]+)&t=(.+)$/.exec(page.url()) ?? [];
  return {
    sessionId,
    sessionKey,
    senderToken,
    receiverLink: await page.getByTestId('receiver-link').inputValue(),
    senderLink: await page.getByTestId('sender-link').inputValue(),
  };
}
