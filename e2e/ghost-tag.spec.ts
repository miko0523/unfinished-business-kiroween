import { expect, test } from '@playwright/test';
import { addStep, card, create, ghosts, openGhost, ready } from './helpers/app';

const tag = (g: ReturnType<typeof ghosts>) => g.locator('.ghost-tag');
const opacity = async (g: ReturnType<typeof ghosts>) => Number(await tag(g).evaluate((el) => getComputedStyle(el).opacity));

test('进度牌：默认与选中隐藏；hover 显示、移开隐藏；aria-label 含进度', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await create(page, 'Sort the photos');
  const g = ghosts(page).first();
  expect(await opacity(g)).toBe(0);
  await openGhost(g);
  await addStep(page, 'Gather the boxes');
  await expect(card(page)).toBeVisible();
  await page.mouse.move(0, 0);
  expect(await opacity(g)).toBe(0);
  await expect(g).toHaveAttribute('aria-label', /0 of 1 done$/);

  const box = (await g.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => opacity(g)).toBe(1);
  expect(await tag(g).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  await page.mouse.move(0, 0);
  await expect.poll(() => opacity(g)).toBe(0);
});

test('进度牌：键盘 focus 显示，失焦隐藏', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await create(page, 'Sort the photos');
  const g = ghosts(page).first();
  await page.keyboard.press('Tab'); // 先进入键盘模式
  await g.focus();
  await expect.poll(() => opacity(g)).toBe(1);
  await g.blur();
  await expect.poll(() => opacity(g)).toBe(0);
});

test('320 宽触摸视口：进度牌不常驻', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 800 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await ready(page);
  await create(page, 'Sort the photos');
  const g = ghosts(page).first();
  expect(await opacity(g)).toBe(0);
  await openGhost(g);
  expect(await opacity(g)).toBe(0);
  await expect(g).toHaveAttribute('aria-label', /0 of 0 done$/);
  await ctx.close();
});
