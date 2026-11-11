import { expect, test, type Page } from '@playwright/test';
import { JOINS, LOGICAL_WIDTH } from './helpers/atlas';
import { create, ready } from './helpers/app';

/** 当前页面上属于“长楼”的动画：屋顶/楼层模块与星星。 */
function growthAnims(page: Page) {
  return page.evaluate(() =>
    document
      .getAnimations()
      .map((a) => {
        const t = (a.effect as KeyframeEffect | null)?.target as HTMLElement | null;
        if (!t) return null;
        if (t.classList.contains('grow-sparkle')) return { kind: 'sparkle', total: Number(a.effect!.getComputedTiming().endTime) };
        if (t.closest('.static-layer') && t.dataset.module) return { kind: t.dataset.module, total: Number(a.effect!.getComputedTiming().endTime) };
        return null;
      })
      .filter((x): x is { kind: string; total: number } => x !== null),
  );
}
const sparkleCount = (page: Page) => page.locator('.grow-sparkle').count();

async function rects(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.static-layer [data-module]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.module!, top: r.top, left: r.left, width: r.width };
    }),
  );
}

async function expectSeams(page: Page) {
  const r = await rects(page);
  for (let i = 1; i < r.length; i++) {
    const lower = r[i - 1]!;
    const upper = r[i]!;
    const k = upper.width / LOGICAL_WIDTH;
    expect(Math.abs(upper.top + JOINS[upper.id]!.bottomJoin * k - (lower.top + JOINS[lower.id]!.topJoin * k)), `${lower.id} → ${upper.id}`).toBeLessThanOrEqual(1);
  }
}

/** 页面里没有任何长楼残留：动画、星星、临时属性、内联样式。 */
async function expectClean(page: Page) {
  expect(await growthAnims(page)).toEqual([]);
  expect(await sparkleCount(page)).toBe(0);
  await expect(page.locator('.house')).not.toHaveAttribute('data-growing', /.*/);
  const styles = await page.evaluate(() => [...document.querySelectorAll('.static-layer [data-module]')].map((e) => (e.getAttribute('style') ?? '') + '|' + e.className));
  for (const s of styles) expect(s).not.toMatch(/transform|clip-path|opacity|grow/);
}

test('第 3 只：屋顶轻顶 + 新层 reveal + 少量星星，≤1s 后清理，接缝正确；第 5 只再播且是新层', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await ready(page);
  await create(page, 'T1');
  await create(page, 'T2');
  expect(await growthAnims(page)).toEqual([]); // 前两只不长

  const t0 = Date.now();
  await create(page, 'T3');
  await expect.poll(async () => (await growthAnims(page)).filter((a) => a.kind === 'roof').length).toBe(1);
  const during = await growthAnims(page);
  expect(during.filter((a) => a.kind === 'floor-02')).toHaveLength(1);
  expect(during.filter((a) => a.kind === 'floor-01' || a.kind === 'lobby')).toHaveLength(0);
  const stars = during.filter((a) => a.kind === 'sparkle');
  expect(stars.length).toBeGreaterThanOrEqual(3);
  expect(stars.length).toBeLessThanOrEqual(5);
  for (const a of during) expect(a.total).toBeLessThanOrEqual(1000);
  const host = page.locator('.grow-sparkles');
  await expect(host).toHaveAttribute('aria-hidden', 'true');
  expect(await host.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  expect(await page.locator('.grow-sparkle').first().evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');

  // 把屋顶动画定在起点：屋顶位于旧位置（比终点更低），且恰好压着新层的位置
  const lifted = await page.evaluate(() => {
    const anim = document.getAnimations().find((a) => (a.effect as KeyframeEffect).target?.getAttribute?.('data-module') === 'roof')!;
    const roof = (anim.effect as KeyframeEffect).target as HTMLElement;
    anim.pause();
    anim.currentTime = 0;
    const start = roof.getBoundingClientRect().top;
    anim.currentTime = 900;
    const end = roof.getBoundingClientRect().top;
    anim.play();
    return { start, end };
  });
  expect(lifted.start).toBeGreaterThan(lifted.end + 20);

  await expect.poll(() => sparkleCount(page), { timeout: 2000, intervals: [100] }).toBe(0);
  expect(Date.now() - t0).toBeLessThan(2500);
  await expectClean(page);
  await expectSeams(page);
  expect((await rects(page)).map((r) => r.id)).toEqual(['lobby', 'floor-01', 'floor-02', 'roof']);

  await create(page, 'T4');
  expect(await growthAnims(page)).toEqual([]); // 第 4 只不长
  await create(page, 'T5');
  await expect.poll(async () => (await growthAnims(page)).length).toBeGreaterThan(0);
  const again = await growthAnims(page);
  expect(again.filter((a) => a.kind === 'floor-03')).toHaveLength(1);
  expect(again.filter((a) => a.kind === 'floor-02')).toHaveLength(0);
  expect(again.filter((a) => a.kind === 'roof')).toHaveLength(1);
  await expect.poll(() => sparkleCount(page), { timeout: 2000, intervals: [100] }).toBe(0);
  await expectClean(page);
  await expectSeams(page);
  expect(errors).toEqual([]);
});

test('快速连续增长：旧动画收口，只剩新一组，结束后无残留，接缝正确', async ({ page }) => {
  await ready(page);
  for (let i = 1; i <= 4; i++) await create(page, `T${i}`);
  await page.waitForTimeout(1100);
  await create(page, 'T5');
  await expect.poll(() => sparkleCount(page)).toBeGreaterThan(0);
  const first = await sparkleCount(page);
  // 第 5 只的动画还在播时继续连续创建到第 7 只
  await create(page, 'T6');
  await create(page, 'T7');
  await expect.poll(async () => (await growthAnims(page)).filter((a) => a.kind === 'floor-04').length).toBe(1);
  expect(await sparkleCount(page)).toBe(first);
  const now = await growthAnims(page);
  expect(now.filter((a) => a.kind === 'floor-03')).toHaveLength(0);
  expect(now.filter((a) => a.kind === 'roof')).toHaveLength(1);
  await expect.poll(() => sparkleCount(page), { timeout: 2000, intervals: [100] }).toBe(0);
  await expectClean(page);
  await expectSeams(page);
  expect((await rects(page)).map((r) => r.id)).toEqual(['lobby', 'floor-01', 'floor-02', 'floor-03', 'floor-04', 'roof']);
});

test('刷新加载已有三层：不补播', async ({ page }) => {
  await ready(page);
  for (let i = 1; i <= 3; i++) await create(page, `T${i}`);
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator('.static-layer [data-module]')).toHaveCount(4);
  for (const wait of [0, 100, 500]) {
    await page.waitForTimeout(wait);
    expect(await growthAnims(page)).toEqual([]);
    expect(await sparkleCount(page)).toBe(0);
  }
  await expectClean(page);
});

test('Reduced Motion：直接最终布局，无动画、无星星', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  for (let i = 1; i <= 3; i++) await create(page, `T${i}`);
  await expect(page.locator('.static-layer [data-module]')).toHaveCount(4);
  expect(await growthAnims(page)).toEqual([]);
  expect(await sparkleCount(page)).toBe(0);
  await expectClean(page);
  await expectSeams(page);
});

test('页面隐藏时增长：直接最终布局，无动画、无星星', async ({ page }) => {
  await ready(page);
  await create(page, 'T1');
  await create(page, 'T2');
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
  await create(page, 'T3');
  await expect(page.locator('.static-layer [data-module]')).toHaveCount(4);
  expect(await growthAnims(page)).toEqual([]);
  expect(await sparkleCount(page)).toBe(0);
  await expectSeams(page);
});
