import { expect, test, type Page } from '@playwright/test';
import { addStep, card, create, ghosts, ready, setCriteria } from './helpers/app';

// 布局套件：固定宽度下，缩减版主线都能走完；无水平滚动；旧宅宽度不超限；899 与 900 之间切换无跳变。

const SIZES = [
  [1280, 800],
  [900, 800],
  [899, 800],
  [320, 640],
] as const;

const stageWidth = (page: Page) => page.locator('.house').evaluate((el) => el.getBoundingClientRect().width);
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const [width, height] of SIZES) {
  test(`缩减版主线（${width}×${height}）：创建、澄清、勾选、等确认、确认、纪念册；无水平滚动`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height });
    await ready(page);
    expect(await noHScroll(page)).toBe(true);
    const w0 = await stageWidth(page);
    expect(w0).toBeLessThanOrEqual(Math.min(809, width - 16) + 0.5);

    await create(page, 'Reduced run');
    const ghost = ghosts(page).first();
    await ghost.dispatchEvent('click');
    await expect(card(page)).toBeVisible();
    expect(await stageWidth(page)).toBe(w0); // 选中不改变旧宅宽度
    await setCriteria(page, 'It is done');
    await addStep(page, 'one step');
    await card(page).getByRole('checkbox').nth(0).check();
    await expect(ghost).toHaveAttribute('data-pending', 'true');
    await expect(ghost).not.toHaveAttribute('data-chore', /.*/, { timeout: 4000 });
    // 被选的 Ghost 站在抽屉上沿，完整在视口里
    const g = (await ghost.boundingBox())!;
    const d = (await card(page).boundingBox())!;
    expect(g.y).toBeGreaterThanOrEqual(0);
    expect(g.y + g.height).toBeLessThanOrEqual(d.y + 0.5);
    expect(await noHScroll(page)).toBe(true);
    await card(page).getByRole('button', { name: 'Confirm complete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm complete' }).click();
    await expect(page.locator('.celebration')).toHaveCount(0, { timeout: 9000 });
    expect(await noHScroll(page)).toBe(true);
    await page.getByRole('button', { name: 'Open the Archive' }).click();
    await expect(page.getByRole('heading', { name: /Archive/i }).first()).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
  });
}

test('899 与 900 之间切换：旧宅宽度连续，没有跳变；全景入口只在窄屏', async ({ page }) => {
  await page.setViewportSize({ width: 899, height: 800 });
  await ready(page);
  const narrow = await stageWidth(page);
  await expect(page.getByRole('button', { name: 'View full house' })).toHaveCount(1);
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.getByRole('button', { name: 'View full house' })).toHaveCount(0);
  const wide = await stageWidth(page);
  expect(wide).toBe(809);
  expect(narrow).toBe(809);
  await page.setViewportSize({ width: 899, height: 800 });
  expect(await stageWidth(page)).toBe(809);
});

test('2560 宽：旧宅图不超过 801 CSS px，舞台不拉伸，两侧继续是夜景', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1000 });
  await ready(page);
  const art = await page.evaluate(() => {
    const el = document.querySelector('.static-layer [data-module="floor-01"]')!;
    return el.getBoundingClientRect().width;
  });
  expect(art).toBeLessThanOrEqual(801.5);
  expect(await stageWidth(page)).toBeLessThanOrEqual(809);
  expect(await page.locator('.sky .sky-trees').count()).toBe(2);
  const left = (await page.locator('.house').boundingBox())!.x;
  expect(left).toBeGreaterThan(600);
});

test('320 宽，100% 缩放：详情抽屉不超过 58% 视口高，内容在抽屉内滚动', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await ready(page);
  await create(page, 'Narrow');
  await ghosts(page).first().dispatchEvent('click');
  for (let i = 0; i < 8; i++) await addStep(page, `step ${i}`);
  const d = (await card(page).boundingBox())!;
  expect(d.height).toBeLessThanOrEqual(640 * 0.58 + 1);
  expect(await noHScroll(page)).toBe(true);
});
