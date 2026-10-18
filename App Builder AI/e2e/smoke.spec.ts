import { expect, test } from '@playwright/test';

test('health endpoint reports ok with database', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});

test('home page loads with security headers', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  const headers = response!.headers();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBeTruthy();
});

test('cookie banner is shown and can be dismissed', async ({ page }) => {
  await page.goto('/');
  const accept = page.getByRole('button', { name: /accept/i }).first();
  await expect(accept).toBeVisible();
  await accept.click();
  await expect(accept).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: /accept/i })).toHaveCount(0);
});

test('cookie policy page renders', async ({ page }) => {
  await page.goto('/cookies');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('admin area requires login', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByLabel('Password')).toBeVisible();
});

test('protected cron and social APIs reject anonymous calls', async ({ request }) => {
  expect((await request.get('/api/cron/social-post')).status()).toBeGreaterThanOrEqual(401);
  expect((await request.get('/api/social/posts')).status()).toBe(401);
  expect((await request.patch('/api/social/posts/x', { data: {} })).status()).toBe(401);
});
