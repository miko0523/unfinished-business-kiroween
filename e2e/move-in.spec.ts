import { test, expect, type Page } from '@playwright/test';

const input = (page: Page) => page.getByLabel('What is still waiting for you?');
const submit = (page: Page) => page.getByRole('button', { name: 'Welcome a little ghost' });
const ghosts = (page: Page) => page.locator('[data-ghost]');

async function create(page: Page, title: string) {
  await input(page).fill(title);
  await submit(page).click();
}

async function ready(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.static-layer img')].every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0),
  );
}

test('合法标题：二楼左侧出现一只灰色 Ghost，名称含“Not clear yet”', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await ready(page);
  await expect(ghosts(page)).toHaveCount(0);

  await create(page, 'Pay the rent');
  const ghost = ghosts(page).first();
  await expect(ghosts(page)).toHaveCount(1);
  await expect(ghost).toHaveAttribute('data-state', 'gray');
  await expect(ghost).toHaveAttribute('data-floor', '2');
  await expect(ghost).toHaveAttribute('data-slot', '0');
  const name = (await ghost.getAttribute('aria-label'))!;
  expect(name).toContain('The little ghost on floor 2, left');
  expect(name).toContain('Pay the rent');
  expect(name).toContain('Not clear yet');
  await expect(page.getByRole('status')).toHaveText('A little ghost moved in.');
  await expect(input(page)).toHaveValue('');

  // 入住动画结束后，Ghost 在二楼模块之内（之后会在整层里飘动），且点击热区不小于 44×44
  await expect(page.locator('.ghost-enter')).toHaveCount(0);
  const box = (await ghost.boundingBox())!;
  const floor = (await page.locator('.static-layer [data-module="floor-01"]').boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(floor.x);
  expect(box.x + box.width).toBeLessThanOrEqual(floor.x + floor.width);
  expect(box.y + box.height).toBeLessThanOrEqual(floor.y + floor.height);
  expect(box.y).toBeGreaterThanOrEqual(floor.y);
  expect(errors).toEqual([]);
});

test('空白与 81 字符被拒绝，显示上限，输入内容保留', async ({ page }) => {
  await ready(page);
  await create(page, '   ');
  await expect(page.getByRole('alert')).toContainText('80');
  await expect(ghosts(page)).toHaveCount(0);

  const long = 'x'.repeat(81);
  await create(page, long);
  await expect(page.getByRole('alert')).toContainText('81');
  await expect(page.getByRole('alert')).toContainText('80');
  await expect(input(page)).toHaveValue(long);
  await expect(ghosts(page)).toHaveCount(0);

  await create(page, 'x'.repeat(80));
  await expect(ghosts(page)).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('标题里的 HTML 作为纯文本：页面不多出图片或脚本元素', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await ready(page);
  const imgBefore = await page.locator('img').count();
  const evil = '<img src=x onerror=alert(1)>';
  await create(page, evil);
  await expect(ghosts(page)).toHaveCount(1);
  expect(await ghosts(page).first().getAttribute('aria-label')).toContain(evil);
  expect(await page.locator('img').count()).toBe(imgBefore);
  expect(await page.locator('[onerror]').count()).toBe(0);
  expect(dialogs).toEqual([]);
});

test('点击楼层空白处不改变选中；点击 Ghost 才选中', async ({ page }) => {
  // Ghost 平时会四处飘动；这里让它们停在 Home Anchor，才能稳定地点“别处”。
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await create(page, 'One');
  await expect(page.locator('.ghost-enter')).toHaveCount(0);
  const ghost = ghosts(page).first();
  await expect(ghost).toHaveAttribute('aria-pressed', 'false');

  const floor = (await page.locator('.static-layer [data-module="floor-01"]').boundingBox())!;
  // 二楼右半边的空 Slot 附近、墙面与家具处各点一下
  for (const [fx, fy] of [[0.8, 0.6], [0.5, 0.2], [0.1, 0.5], [0.9, 0.9]] as const) {
    await page.mouse.click(floor.x + floor.width * fx, floor.y + floor.height * fy);
  }
  await expect(ghost).toHaveAttribute('aria-pressed', 'false');

  await ghost.click();
  await expect(ghost).toHaveAttribute('aria-pressed', 'true');
  // 详情卡打开后页面会下移，重新量一次楼层的位置。
  const moved = (await page.locator('.static-layer [data-module="floor-01"]').boundingBox())!;
  await page.mouse.click(moved.x + moved.width * 0.8, moved.y + moved.height * 0.6);
  await expect(ghost).toHaveAttribute('aria-pressed', 'true');
});

test('Reduced Motion：入住不播放动画，仍显示文字', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await create(page, 'Quiet');
  await expect(ghosts(page)).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveText('A little ghost moved in.');
  const animations = await page.evaluate(() => document.getAnimations().length);
  expect(animations).toBe(0);
});

test('320 宽度：无水平滚动，Ghost 热区不小于 44px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await ready(page);
  await create(page, 'Narrow');
  await expect(page.locator('.ghost-enter')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const box = (await ghosts(page).first().boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
});
