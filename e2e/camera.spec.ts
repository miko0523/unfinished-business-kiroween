import { expect, test, type Page } from '@playwright/test';
import { addStep, card, create, ghosts, ready, setCriteria } from './helpers/app';

// 手机镜头：聚焦当前楼层 / 全景；全景里点 Ghost 先聚焦、再点才打开详情；确认后手机自动进入全景。
// 宽屏没有全景，旧宅宽度不因选中而改变。

const toggle = (page: Page) => page.getByRole('button', { name: /View full house|Back to this floor/ });
const houseWidth = (page: Page) => page.locator('.house').evaluate((el) => el.getBoundingClientRect().width);

for (const width of [320, 390]) {
  test(`手机 ${width}：舞台不挡全景按钮，月亮不压状态文字`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await ready(page);
    await create(page, 'A little garden');
    const ghost = ghosts(page).first();
    await ghost.dispatchEvent('click');
    await expect(page.locator('[data-staged]')).toHaveCount(1);
    const separate = (a: {x:number;y:number;width:number;height:number}, b: {x:number;y:number;width:number;height:number}) =>
      a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
    await expect.poll(async () => separate((await ghost.boundingBox())!, (await toggle(page).boundingBox())!)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => separate((await page.locator('.sky-moon').boundingBox())!, (await page.getByRole('status').boundingBox())!)).toBe(true);
    await toggle(page).click();
    await expect(page.locator('.house')).toHaveAttribute('data-camera', 'panorama');
  });
}

async function fourGhosts(page: Page) {
  await ready(page);
  for (const name of ['A', 'B', 'C', 'D']) await create(page, name);
  await expect(page.locator('.ghost-enter')).toHaveCount(0);
}

test('手机：看全景 → 整栋缩小到一屏、详情收起；再点回到当前楼层', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 560 });
  await fourGhosts(page);
  await expect(page.locator('.house')).toHaveAttribute('data-camera', 'focus');
  const focusW = await houseWidth(page);
  await ghosts(page).first().dispatchEvent('click');
  await expect(card(page)).toBeVisible();
  await toggle(page).click();
  await expect(page.locator('.house')).toHaveAttribute('data-camera', 'panorama');
  await expect(card(page)).toHaveCount(0); // 详情收起
  const panW = await houseWidth(page);
  expect(panW).toBeLessThan(focusW);
  expect(panW).toBeGreaterThanOrEqual(160);
  // 整栋在一屏里
  const box = (await page.locator('.house').boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(560);
  await expect(toggle(page)).toHaveText('Back to this floor');
  await toggle(page).click();
  await expect(page.locator('.house')).toHaveAttribute('data-camera', 'focus');
  expect(Math.round(await houseWidth(page))).toBe(Math.round(focusW));
});

test('手机全景：点 Ghost 先聚焦它所在的楼层并退出全景，再点一次才打开详情', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await fourGhosts(page);
  await toggle(page).click();
  await expect(page.locator('.house')).toHaveAttribute('data-camera', 'panorama');
  const target = page.locator('[data-ghost][data-floor="3"]').first();
  await target.dispatchEvent('click');
  await expect(page.locator('.house')).toHaveAttribute('data-camera', 'focus');
  await expect(card(page)).toHaveCount(0);
  await expect(target).toHaveAttribute('aria-pressed', 'false');
  // 那一层进入视口
  await expect
    .poll(async () => {
      const b = (await target.boundingBox())!;
      return b.y >= 0 && b.y + b.height <= 800;
    })
    .toBe(true);
  await target.dispatchEvent('click');
  await expect(card(page)).toBeVisible();
  await expect(target).toHaveAttribute('aria-pressed', 'true');
});

test('手机全景：Ghost 的触控热区不小于 44×44，两只的热区不重叠', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await fourGhosts(page);
  await toggle(page).click();
  await expect(page.locator('.house')).toHaveAttribute('data-camera', 'panorama');
  const hits = await page.evaluate(() => {
    const out: { floor: string; slot: string; l: number; r: number; t: number; b: number }[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('[data-ghost]')) {
      const box = el.getBoundingClientRect();
      const before = getComputedStyle(el, '::before');
      const w = parseFloat(before.width);
      const h = parseFloat(before.height);
      const slot = el.dataset.slot!;
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const l = slot === '0' ? cx - w : cx;
      out.push({ floor: el.dataset.floor!, slot, l, r: l + w, t: cy - h / 2, b: cy + h / 2 });
    }
    return out;
  });
  for (const h of hits) {
    expect(h.b - h.t).toBeGreaterThanOrEqual(44);
    expect(h.r - h.l).toBeGreaterThanOrEqual(44);
  }
  for (const floor of ['2', '3']) {
    const pair = hits.filter((h) => h.floor === floor);
    expect(pair).toHaveLength(2);
    const [a, b] = pair.sort((x, y) => Number(x.slot) - Number(y.slot)) as [typeof hits[number], typeof hits[number]];
    expect(a.r).toBeLessThanOrEqual(b.l + 1);
  }
});

test('手机：确认完成后自动进入全景，庆祝结束后回到聚焦', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 800 });
  await ready(page);
  await create(page, 'Solo');
  const ghost = ghosts(page).first();
  await ghost.dispatchEvent('click');
  await setCriteria(page, 'Done');
  await addStep(page, 'one');
  await card(page).getByRole('checkbox').nth(0).check();
  await expect(ghost).not.toHaveAttribute('data-chore', /.*/, { timeout: 4000 });
  await card(page).getByRole('button', { name: 'Confirm complete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm complete' }).click();
  await expect(page.locator('.house')).toHaveAttribute('data-camera', 'panorama');
  await expect(page.locator('.celebration')).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('.house')).toHaveAttribute('data-camera', 'focus');
});

test('宽屏：没有全景入口；选中、改选、关闭，旧宅的宽度都不变', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await ready(page);
  await create(page, 'A');
  await create(page, 'B');
  await expect(toggle(page)).toHaveCount(0);
  const w = await houseWidth(page);
  await ghosts(page).first().dispatchEvent('click');
  await expect(card(page)).toBeVisible();
  expect(await houseWidth(page)).toBe(w);
  await ghosts(page).nth(1).dispatchEvent('click');
  expect(await houseWidth(page)).toBe(w);
  await card(page).getByRole('button', { name: 'Close' }).click();
  expect(await houseWidth(page)).toBe(w);
});
