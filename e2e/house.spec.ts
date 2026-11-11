import { test, expect, type Page } from '@playwright/test';
import { JOINS, LOGICAL_WIDTH, STACK_6 } from './helpers/atlas';
import { create, ready } from './helpers/app';

async function moduleRects(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.static-layer [data-module]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.module!, top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height };
    }),
  );
}

for (const width of [320, 800, 1280]) {
  test(`静态层：住满九位后六层 + 屋顶全部渲染，接缝误差 ≤ 1 CSS px（视口 ${width}）`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    for (let i = 1; i <= 9; i++) await create(page, `Task ${i}`);
    await expect(page.locator('.static-layer img')).toHaveCount(7);
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.static-layer img')].every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0),
    );

    const rects = await moduleRects(page);
    expect(rects.map((r) => r.id)).toEqual([...STACK_6]);

    for (let i = 1; i < rects.length; i++) {
      const lower = rects[i - 1]!;
      const upper = rects[i]!;
      const k = upper.width / LOGICAL_WIDTH; // 屏幕像素 / 逻辑像素
      const upperJoinY = upper.top + JOINS[upper.id]!.bottomJoin * k;
      const lowerJoinY = lower.top + JOINS[lower.id]!.topJoin * k;
      expect(Math.abs(upperJoinY - lowerJoinY), `${lower.id} → ${upper.id}`).toBeLessThanOrEqual(1);
    }

    // 相邻模块水平错位 ≤ 8 逻辑像素（design.md），且整体不产生横向滚动
    const k0 = rects[0]!.width / LOGICAL_WIDTH;
    for (let i = 1; i < rects.length; i++) {
      expect(Math.abs(rects[i]!.left - rects[i - 1]!.left)).toBeLessThanOrEqual(8 * k0 + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('静态层：图片属性与指针事件（空房：门厅、一层住宅、屋顶）', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.static-layer img')).toHaveCount(3);
  const info = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLImageElement>('.static-layer img')].map((i) => ({
      alt: i.getAttribute('alt'),
      ariaHidden: i.getAttribute('aria-hidden'),
      draggable: i.draggable,
      pointer: getComputedStyle(i).pointerEvents,
      filter: getComputedStyle(i).filter,
      opacity: getComputedStyle(i).opacity,
      hasSrcset: !!i.getAttribute('srcset') && !!i.getAttribute('sizes'),
      hasSize: !!i.getAttribute('width') && !!i.getAttribute('height'),
    })),
  );
  for (const i of info) {
    expect(i).toEqual({ alt: '', ariaHidden: 'true', draggable: false, pointer: 'none', filter: 'none', opacity: '1', hasSrcset: true, hasSize: true });
  }
});

test('素材加载失败：显示纯色底板，没有未捕获异常，其余模块照常', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/\/assets\/dollhouse\/(1x|2x)\/(lobby|floor-02)\.png$/, (route) => route.abort());
  await page.goto('/');
  for (let i = 1; i <= 3; i++) await create(page, `Task ${i}`); // 三位住客 → 门厅、两层住宅、屋顶
  await expect(page.locator('.static-plate')).toHaveCount(2);
  await expect(page.locator('.static-plate[data-module="lobby"][data-failed="true"]')).toBeVisible();
  await expect(page.locator('.static-plate[data-module="floor-02"]')).toBeVisible();
  await expect(page.locator('.static-layer img')).toHaveCount(2);
  const plate = await page.locator('.static-plate[data-module="lobby"]').boundingBox();
  expect(plate!.width).toBeGreaterThan(100);
  expect(plate!.height).toBeGreaterThan(50);
  expect(errors).toEqual([]);
});
