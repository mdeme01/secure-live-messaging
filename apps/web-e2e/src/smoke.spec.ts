import { expect, test } from '@playwright/test';
import { HEALTH_PATH } from '@slm/protocol';

test('landing page renders and the API is reachable through the proxy', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Share a live, encrypted message' }),
  ).toBeVisible();

  const health = await request.get(HEALTH_PATH);
  expect(health.ok()).toBe(true);
});
