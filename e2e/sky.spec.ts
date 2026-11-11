import { expect, test } from '@playwright/test';
import { ready } from './helpers/app';

const sky = (page: import('@playwright/test').Page) => page.locator('.sky');

for (const [width, max] of [[1280, 10], [320, 4]] as const) {
  test(`夜空（${width} 宽）：萤火不超过 ${max} 颗，周期不短于 6 秒，不闪烁，没有文字，对辅助技术隐藏`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await ready(page);
    await expect(sky(page)).toHaveAttribute('aria-hidden', 'true');
    const flies = page.locator('.sky .firefly');
    expect(await flies.count()).toBe(max);
    const info = await flies.evaluateAll((els) =>
      els.map((el) => {
        const s = getComputedStyle(el);
        return { duration: parseFloat(s.animationDuration), name: s.animationName, opacity: s.opacity };
      }),
    );
    for (const f of info) {
      expect(f.name).toBe('firefly-drift');
      expect(f.duration).toBeGreaterThanOrEqual(6);
      expect(f.opacity).toBe('0.85'); // 亮度恒定：不闪烁
    }
    // 只用 transform 漂移
    const props = await page.evaluate(() => document.getAnimations().filter((a) => (a as CSSAnimation).animationName === 'firefly-drift').map((a) => ((a.effect as KeyframeEffect).getKeyframes().flatMap((k) => Object.keys(k)))));
    for (const keys of props) expect(keys.filter((k) => !['offset', 'easing', 'composite', 'computedOffset', 'transform'].includes(k))).toEqual([]);
    // 没有文字，没有位图
    expect(await sky(page).evaluate((el) => (el.textContent ?? '').trim())).toBe('');
    expect(await sky(page).locator('img').count()).toBe(0);
    // 宽屏有两侧的树影，窄屏没有
    expect(await sky(page).locator('.sky-trees').count()).toBe(width >= 900 ? 2 : 0);
    expect(await sky(page).locator('.sky-moon').count()).toBe(1);
    expect(await sky(page).locator('.sky-stars circle').count()).toBeGreaterThan(20);
  });
}

test('夜空：页面隐藏时暂停，回来继续', async ({ page }) => {
  await ready(page);
  const running = () => page.evaluate(() => document.getAnimations().filter((a) => (a as CSSAnimation).animationName === 'firefly-drift' && a.playState === 'running').length);
  expect(await running()).toBeGreaterThan(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(running).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(running).toBeGreaterThan(0);
});

test('夜空：减少动态下萤火停在固定位置，没有动画', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await ready(page);
  expect(await page.locator('.sky .firefly').count()).toBe(10);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  const a = await page.locator('.sky .firefly').first().boundingBox();
  await page.waitForTimeout(800);
  expect(await page.locator('.sky .firefly').first().boundingBox()).toEqual(a);
  await context.close();
});

test('夜空：在文字和控件后面，不拦截点击，也不把页面撑出水平滚动', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await ready(page);
  expect(await sky(page).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await sky(page).evaluate((el) => Number(getComputedStyle(el).zIndex))).toBeLessThan(0);
});
