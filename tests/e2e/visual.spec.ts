import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

test('signed-out catalog and share layouts fit desktop and 320px', async ({ page }) => {
  const output = resolve('output/qa');
  mkdirSync(output, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.locator('article.resource-card').first()).toBeVisible();
  await expect(page.locator('article.resource-card').first().locator('img')).toBeVisible();
  const skip = page.getByRole('link', { name: 'Skip to content', exact: true });
  expect(await skip.evaluate((node) => node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  expect(await skip.evaluate((node) => node.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
  await page.locator('h1').click();
  await page.locator('#resource-search').fill('jar');
  await page.getByRole('button', { name: 'Search resources', exact: true }).click();
  await expect(page).toHaveURL(/\?q=jar$/);
  await expect(
    page.getByRole('heading', { name: 'Glass jar with a screw lid', exact: true }),
  ).toBeVisible();
  await page.locator('.filter-chip').filter({ hasText: 'jar' }).click();
  await expect(page.locator('#resource-search')).toHaveValue('');
  await page.goBack();
  await expect(page.locator('#resource-search')).toHaveValue('jar');
  await page.goto('/');
  await expect(page.locator('article.resource-card')).toHaveCount(6);
  await page.screenshot({ path: `${output}/explore-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 320, height: 860 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${output}/explore-320.png`, fullPage: true });
  await page.screenshot({ path: `${output}/explore-320-viewport.png`, fullPage: false });
  await page.goto('/share');
  await expect(page.getByRole('link', { name: 'Sign in to share', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${output}/share-signedout-320.png`, fullPage: true });
});
