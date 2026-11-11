import { test, expect, type Page } from '@playwright/test';
import type { Server } from 'node:http';
import { SUBPATH_PREFIX, startSubpathServer, stopServer } from './helpers/subpath-server';

async function checkFirstScreen(page: Page, url: string) {
  const foreign: string[] = [];
  const failed: string[] = [];
  const origin = new URL(url, 'http://localhost:4173').origin;
  await page.route('**/*', (route) => {
    const reqUrl = route.request().url();
    if (!reqUrl.startsWith('data:') && new URL(reqUrl).origin !== origin) foreign.push(reqUrl);
    return route.continue();
  });
  page.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(url);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
  expect(foreign).toEqual([]);
  expect(failed).toEqual([]);
}

test('根路径：首屏可见、h1 唯一、无非同源请求', async ({ page }) => {
  await checkFirstScreen(page, '/');
});

test.describe('子路径 /unfinished-business/', () => {
  let server: Server;
  let origin = '';
  test.beforeAll(async () => {
    ({ server, origin } = await startSubpathServer());
  });
  test.afterAll(async () => {
    await stopServer(server);
  });

  test('子路径：首屏可见、h1 唯一、无非同源请求', async ({ page }) => {
    await checkFirstScreen(page, origin + SUBPATH_PREFIX);
  });
});
