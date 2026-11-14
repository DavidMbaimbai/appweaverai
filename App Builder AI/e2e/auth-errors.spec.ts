import { expect, test } from '@playwright/test';

test('a stale OAuth error is replaced by the current password failure', async ({ page }) => {
  await page.route('**/api/auth/get-session*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );
  let releaseResponse!: () => void;
  const responseReady = new Promise<void>((resolve) => { releaseResponse = resolve; });
  await page.route('**/api/auth/sign-in/email', async (route) => {
    await responseReady;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }),
    });
  });
  await page.goto('/?auth=login&error=invalid_code');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/Social sign-in could not be completed/)).toBeVisible();
  await expect(page).not.toHaveURL(/error=/);
  await dialog.getByLabel('Email', { exact: true }).fill('auth-test@example.invalid');
  await dialog.getByLabel('Password', { exact: true }).fill('test-only-password');
  const request = page.waitForRequest('**/api/auth/sign-in/email');
  await dialog.getByRole('button', { name: 'Log in', exact: true }).click();
  await request;
  await expect(dialog.getByText(/Social sign-in could not be completed/)).toHaveCount(0);
  releaseResponse();
  await expect(dialog.getByText(/Invalid email or password/)).toBeVisible();
  await expect(dialog.getByText(/expired|already used/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/Social sign-in could not be completed/)).toHaveCount(0);
});
