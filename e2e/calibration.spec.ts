import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// 在开发服务器下运行（playwright.config.ts 的 dev 项目）。
const SHOT = 'test-results/calibration-six-floors.png';

interface R {
  l: number;
  t: number;
  r: number;
  b: number;
}

async function rectOf(page: Page, selector: string): Promise<R[]> {
  return page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)].map((el) => {
      const b = el.getBoundingClientRect();
      return { l: b.left, t: b.top, r: b.right, b: b.bottom };
    });
  }, selector);
}

const EPS = 0.75; // 百分比定位的亚像素舍入余量

function inside(inner: R, outer: R) {
  return inner.l >= outer.l - EPS && inner.t >= outer.t - EPS && inner.r <= outer.r + EPS && inner.b <= outer.b + EPS;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/#/calibrate');
  await expect(page.locator('[data-debug="calibrate-root"]')).toBeVisible();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.static-layer img')].every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0),
  );
});

test('默认显示完整六层：屋顶 + 门厅 + 五层，五层左右安全矩形与落点齐全', async ({ page }) => {
  await expect(page.locator('.static-layer img')).toHaveCount(7);
  await expect(page.locator('[data-debug="floor-switch"] button[aria-pressed="true"]')).toHaveText('6');
  await expect(page.locator('[data-debug="floor-box"]')).toHaveCount(5);
  await expect(page.locator('[data-debug="safe-rect"]')).toHaveCount(10);
  await expect(page.locator('[data-debug="safe-rect"][data-side="L"]')).toHaveCount(5);
  await expect(page.locator('[data-debug="safe-rect"][data-side="R"]')).toHaveCount(5);
  await expect(page.locator('[data-debug="idle-point"]')).toHaveCount(10);
  for (let floor = 2; floor <= 6; floor++) {
    await expect(page.locator(`[data-debug="safe-rect"][data-floor="${floor}"][data-side="L"] .cal-label`)).toHaveText(`${floor}L`);
    await expect(page.locator(`[data-debug="safe-rect"][data-floor="${floor}"][data-side="R"] .cal-label`)).toHaveText(`${floor}R`);
  }
});

test('每个 Slot 的安全矩形完全落在对应楼层盒子内，落点在自己的矩形内', async ({ page }) => {
  for (let floor = 2; floor <= 6; floor++) {
    const [box] = await rectOf(page, `[data-debug="floor-box"][data-floor="${floor}"]`);
    for (const side of ['L', 'R']) {
      const [safe] = await rectOf(page, `[data-debug="safe-rect"][data-floor="${floor}"][data-side="${side}"]`);
      expect(inside(safe!, box!), `${floor}${side} 安全矩形`).toBe(true);
      const [idle] = await rectOf(page, `[data-debug="idle-point"][data-floor="${floor}"][data-side="${side}"]`);
      const cx = (idle!.l + idle!.r) / 2;
      const cy = (idle!.t + idle!.b) / 2;
      expect(cx >= safe!.l - EPS && cx <= safe!.r + EPS && cy >= safe!.t - EPS && cy <= safe!.b + EPS, `${floor}${side} 落点`).toBe(true);
    }
  }
});

test('门厅：纪念册热区与锚点、3 个静态灯框、12 个暖灯位都已画出，且全在门厅内、互不冲突', async ({ page }) => {
  const [lobby] = await rectOf(page, '[data-debug="lobby-box"]');
  await expect(page.locator('[data-debug="missing"]')).toHaveCount(0);
  await expect(page.locator('[data-debug="archive-point"]')).toHaveCount(1);
  await expect(page.locator('[data-debug="archive-hit"]')).toHaveCount(1);
  await expect(page.locator('[data-debug="static-lamp-rect"]')).toHaveCount(3);
  await expect(page.locator('[data-debug="lamp-slot"]')).toHaveCount(12);

  for (const sel of ['[data-debug="lamp-slot"]', '[data-debug="archive-point"]', '[data-debug="archive-hit"]', '[data-debug="static-lamp-rect"]']) {
    for (const r of await rectOf(page, sel)) expect(inside(r, lobby!), sel).toBe(true);
  }

  // 屏幕像素 = 逻辑像素 × scale；灯位占位按 1x 逻辑半径 12 + 安全距离 8 换算后，不得碰书热区与静态灯框。
  const scale = lobby!.r - lobby!.l > 0 ? (lobby!.r - lobby!.l) / 801 : 1;
  const [hit] = await rectOf(page, '[data-debug="archive-hit"]');
  const lampRects = await rectOf(page, '[data-debug="static-lamp-rect"]');
  const centers = (await rectOf(page, '[data-debug="lamp-slot"]')).map((r) => ({ x: (r.l + r.r) / 2, y: (r.t + r.b) / 2 }));
  const reach = (12 + 8) * scale;
  const hits = (c: { x: number; y: number }, b: R) => c.x + reach > b.l && c.x - reach < b.r && c.y + reach > b.t && c.y - reach < b.b;
  // 前 3 个灯位就是三个静态灯框的中心（叠在原画灯笼上）；后 9 个挂墙灯位不碰书热区与静态灯框
  const inRect = (c: { x: number; y: number }, b: R) => c.x >= b.l && c.x <= b.r && c.y >= b.t && c.y <= b.b;
  const sortedRects = [...lampRects].sort((a, b) => a.l - b.l);
  centers.slice(0, 3).forEach((c, i) => expect(inRect(c, sortedRects[i]!), `前 3 个灯位在第 ${i + 1} 个静态灯框内`).toBe(true));
  for (const c of centers.slice(3)) {
    expect(hits(c, hit!), '灯位不碰纪念册热区').toBe(false);
    for (const b of lampRects) expect(hits(c, b), '灯位不碰静态灯框').toBe(false);
  }
  for (let i = 3; i < centers.length; i++)
    for (let j = i + 1; j < centers.length; j++) {
      const d = Math.hypot(centers[i]!.x - centers[j]!.x, centers[i]!.y - centers[j]!.y);
      expect(d, `灯位 ${i + 1}-${j + 1} 间距`).toBeGreaterThanOrEqual(24 * scale - EPS);
    }

  // 锚点在自己的热区内
  const [pt] = await rectOf(page, '[data-debug="archive-point"]');
  const px = (pt!.l + pt!.r) / 2;
  const py = (pt!.t + pt!.b) / 2;
  expect(px >= hit!.l && px <= hit!.r && py >= hit!.t && py <= hit!.b).toBe(true);
  // 静态灯框互不重叠
  for (let i = 0; i < lampRects.length; i++)
    for (let j = i + 1; j < lampRects.length; j++) {
      const a = lampRects[i]!;
      const b = lampRects[j]!;
      const overlapW = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const overlapH = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      expect(overlapW > 6 * scale && overlapH > 6 * scale, `静态灯框 ${i + 1}-${j + 1} 不应大面积重叠`).toBe(false);
    }
});

test('实测亮区取自实际 lobby.png，且都在门厅盒子内', async ({ page }) => {
  await expect(page.locator('[data-debug="glow-evidence"]')).toHaveCount(3);
  const boxes = await page.locator('[data-debug="glow-evidence"]').evaluateAll((els) =>
    els.map((e) => ['data-x0', 'data-y0', 'data-x1', 'data-y1'].map((a) => Number(e.getAttribute(a)))),
  );
  expect(boxes).toEqual([
    [109, 127, 125, 153],
    [380, 108, 469, 158],
    [466, 109, 556, 161],
  ]);
  const [lobby] = await rectOf(page, '[data-debug="lobby-box"]');
  for (const r of await rectOf(page, '[data-debug="glow-evidence"]')) expect(inside(r, lobby!)).toBe(true);
});

test('所有调试框都不超出舞台宽度，页面无水平滚动', async ({ page }) => {
  const [stage] = await rectOf(page, '.house');
  for (const r of await rectOf(page, '[data-debug]:not([data-debug="calibrate-root"]):not([data-debug="floor-switch"])')) {
    expect(r.l).toBeGreaterThanOrEqual(stage!.l - EPS);
    expect(r.r).toBeLessThanOrEqual(stage!.r + EPS);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('楼层数切换 2 至 6，调试层随之增减', async ({ page }) => {
  for (let n = 2; n <= 6; n++) {
    await page.locator(`[data-debug="floor-switch"] button[data-n="${n}"]`).click();
    await expect(page.locator('.static-layer img')).toHaveCount(n + 1);
    await expect(page.locator('[data-debug="floor-box"]')).toHaveCount(n - 1);
    await expect(page.locator('[data-debug="safe-rect"]')).toHaveCount((n - 1) * 2);
  }
});

test('生成完整六层校准截图', async ({ page }) => {
  await page.locator('[data-debug="floor-switch"] button[data-n="6"]').click();
  await expect(page.locator('[data-debug="glow-evidence"]')).toHaveCount(3);
  mkdirSync(dirname(SHOT), { recursive: true });
  await page.screenshot({ path: SHOT, fullPage: true });
});
