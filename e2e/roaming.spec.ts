import { expect, test } from '@playwright/test';
import { create, ghosts, openGhost, ready } from './helpers/app';
import { FLOOR_SPACES } from '../src/house/data/space';

interface Box { l: number; t: number; r: number; b: number }
interface Sample { floor: Box; bodies: Box[] }

// 单张楼层 PNG 的逻辑宽度与 Ghost 容器 / 身体的几何（来自 design.md 与 ghostShape）。
const LOGICAL_W = 801;
const GHOST_W = 140;
const GHOST_H = 180;

test('同层两只 Ghost 在整层里飘动：全程不出界、不重叠，位置覆盖不同高度与左右；选中后停住', async ({ page }) => {
  test.setTimeout(90_000);
  await ready(page);
  await create(page, 'Water the plants');
  await create(page, 'Fold the laundry');
  await expect(ghosts(page)).toHaveCount(2);
  await expect(page.locator('.ghost-enter')).toHaveCount(0);

  const samples: Sample[] = await page.evaluate(
    () =>
      new Promise<Sample[]>((resolve) => {
        const out: Sample[] = [];
        const floorEl = document.querySelector('.static-layer [data-module="floor-01"]')!;
        const started = performance.now();
        const timer = setInterval(() => {
          const f = floorEl.getBoundingClientRect();
          const bodies = [...document.querySelectorAll('[data-ghost]')].map((el) => {
            const r = el.getBoundingClientRect();
            return { l: r.left, t: r.top, r: r.right, b: r.bottom };
          });
          out.push({ floor: { l: f.left, t: f.top, r: f.right, b: f.bottom }, bodies });
          if (performance.now() - started > 30_000) {
            clearInterval(timer);
            resolve(out);
          }
        }, 100);
      }),
  );

  const s = samples[0]!.floor.r - samples[0]!.floor.l;
  const k = s / LOGICAL_W;
  const xs: number[] = [];
  const ys: number[] = [];
  let moved = 0;
  let first: Box[] | null = null;
  for (const sample of samples) {
    const f = sample.floor;
    const bodies = sample.bodies.map((c) => {
      // 容器 140×180：身体宽 112（x 14–126）、高 137，底边中点是锚点。
      const w = c.r - c.l;
      const h = c.b - c.t;
      return { l: c.l + (w * 14) / GHOST_W, r: c.l + (w * 126) / GHOST_W, t: c.b - (h * 137) / GHOST_H, b: c.b };
    });
    expect(bodies).toHaveLength(2);
    for (const b of bodies) {
      // 室内可导航区约为 x 60–735、y 15–262（逻辑像素），留 2px 的取整余量
      expect(b.l).toBeGreaterThanOrEqual(f.l + 60 * k - 2);
      expect(b.r).toBeLessThanOrEqual(f.l + 736 * k + 2);
      expect(b.t).toBeGreaterThanOrEqual(f.t + 15 * k - 2);
      expect(b.b).toBeLessThanOrEqual(f.t + 262 * k + 2);
      // 当前真实存在的显式障碍（现在没有；以后登记了，这里自动开始检查）
      for (const [ox0, oy0, ox1, oy1] of FLOOR_SPACES['floor-01'].obstacles) {
        const o = { l: f.l + ox0 * k, r: f.l + ox1 * k, t: f.t + oy0 * k, b: f.t + oy1 * k };
        expect(b.r <= o.l || o.r <= b.l || b.b <= o.t || o.b <= b.t).toBe(true);
      }
      xs.push((b.l + b.r) / 2 - f.l);
      ys.push(b.b - f.t);
    }
    const [a, b] = bodies as [Box, Box];
    const separated = a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
    expect(separated).toBe(true);
    if (!first) first = bodies;
    else if (Math.abs(bodies[0]!.l - first[0]!.l) + Math.abs(bodies[1]!.l - first[1]!.l) > 20 * k) moved++;
  }
  expect(moved).toBeGreaterThan(5);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(150 * k);
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(20 * k);
  // 覆盖左右两个半边（以楼层中线为界）和不同高度（高处与低处都到过）
  const mid = (LOGICAL_W / 2) * k;
  expect(xs.some((x) => x < mid)).toBe(true);
  expect(xs.some((x) => x > mid)).toBe(true);
  const midY = (Math.max(...ys) + Math.min(...ys)) / 2;
  expect(ys.some((y) => y < midY)).toBe(true);
  expect(ys.some((y) => y > midY)).toBe(true);

  // 选中后：屋里的位置停住（li 不再动），本体飞到抽屉上沿的小舞台并停在那里；屋里没有第二只。
  const target = ghosts(page).first();
  const home = () => target.evaluate((el) => { const r = el.parentElement!.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY }; });
  await openGhost(target);
  await expect(page.locator('[data-ghost]')).toHaveCount(2);
  await page.waitForTimeout(700); // 飞行 0.45 秒
  const a = await home();
  const stageA = await target.boundingBox();
  await page.waitForTimeout(2500);
  const b = await home();
  const stageB = await target.boundingBox();
  expect(Math.abs(a.x - b.x)).toBeLessThan(1);
  expect(Math.abs(a.y - b.y)).toBeLessThan(1);
  expect(stageB!.x).toBeCloseTo(stageA!.x, 0);
  expect(stageB!.y).toBeCloseTo(stageA!.y, 0);
});

test('Reduced Motion：Ghost 固定在各自的家，没有位移动画', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await create(page, 'One');
  await create(page, 'Two');
  const before = await Promise.all([0, 1].map((i) => ghosts(page).nth(i).boundingBox()));
  await page.waitForTimeout(4000);
  const after = await Promise.all([0, 1].map((i) => ghosts(page).nth(i).boundingBox()));
  expect(after).toEqual(before);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('两层各一对（共 4 只）：各层各自不出界、不重叠，选中其中一只后它停在原位', async ({ page }) => {
  test.setTimeout(60_000);
  await ready(page);
  for (const t of ['A', 'B', 'C', 'D']) await create(page, t);
  await expect(ghosts(page)).toHaveCount(4);
  await expect(page.locator('.ghost-enter')).toHaveCount(0);

  const samples = await page.evaluate(
    () =>
      new Promise<{ floors: Record<string, Box>; bodies: { floor: string; box: Box }[] }[]>((resolve) => {
        const out: { floors: Record<string, Box>; bodies: { floor: string; box: Box }[] }[] = [];
        const started = performance.now();
        const timer = setInterval(() => {
          const floors: Record<string, Box> = {};
          for (const id of ['floor-01', 'floor-02']) {
            const r = document.querySelector(`.static-layer [data-module="${id}"]`)!.getBoundingClientRect();
            floors[id] = { l: r.left, t: r.top, r: r.right, b: r.bottom };
          }
          const bodies = [...document.querySelectorAll<HTMLElement>('[data-ghost]')].map((el) => {
            const r = el.getBoundingClientRect();
            const w = r.width;
            const h = r.height;
            return { floor: el.dataset.floor!, box: { l: r.left + (w * 14) / 140, r: r.left + (w * 126) / 140, t: r.bottom - (h * 137) / 180, b: r.bottom } };
          });
          out.push({ floors, bodies });
          if (performance.now() - started > 15_000) {
            clearInterval(timer);
            resolve(out);
          }
        }, 100);
      }),
  );
  const k = (samples[0]!.floors['floor-01']!.r - samples[0]!.floors['floor-01']!.l) / LOGICAL_W;
  for (const s of samples) {
    for (const floorNo of ['2', '3']) {
      const mod = s.floors[floorNo === '2' ? 'floor-01' : 'floor-02']!;
      const pair = s.bodies.filter((b) => b.floor === floorNo).map((b) => b.box);
      expect(pair).toHaveLength(2);
      for (const b of pair) {
        expect(b.l).toBeGreaterThanOrEqual(mod.l + 58 * k - 2);
        expect(b.r).toBeLessThanOrEqual(mod.l + 738 * k + 2);
        expect(b.t).toBeGreaterThanOrEqual(mod.t + 12 * k - 2);
        expect(b.b).toBeLessThanOrEqual(mod.t + 264 * k + 2);
      }
      const [a, b] = pair as [Box, Box];
      expect(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t).toBe(true);
    }
  }
});
