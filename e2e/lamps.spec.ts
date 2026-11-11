import { expect, test, type Page } from '@playwright/test';
import { LOBBY } from '../src/house/data/lobby';
import { addStep, card, create, ghosts, openGhost, ready, setCriteria } from './helpers/app';
import { saveWithArchive, seedSave } from './helpers/save';

const lamps = (page: Page) => page.locator('.warm-lamp');
const lampCount = (page: Page) => page.locator('.warm-lamps').getAttribute('data-lamps');

const lobbyBox = (page: Page) =>
  page.locator('.static-layer [data-module="lobby"]').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, w: r.width, h: r.height };
  });

for (const [n, expected] of [[0, 0], [1, 1], [3, 3], [5, 5], [12, 12], [13, 12], [20, 12]] as const) {
  test(`已有 ${n} 条纪念就有 ${expected} 盏暖灯（最多 12）；刷新一致、不补播`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await seedSave(page, saveWithArchive(n));
    await ready(page);
    await expect(lamps(page)).toHaveCount(expected);
    // 初始化与刷新只显示现有的灯，不补播淡入或小星
    expect(await page.locator('.warm-lamp-new').count()).toBe(0);
    expect(await page.locator('.lamp-sparks').count()).toBe(0);
    await page.reload();
    await expect(lamps(page)).toHaveCount(expected);
    expect(await page.locator('.warm-lamp-new').count()).toBe(0);
  });
}

test('前 3 盏叠在门厅原画的 3 盏灯笼上（从左到右依次点亮）；第 4–12 盏是挂墙灯笼组件，透明 PNG', async ({ page }) => {
  await seedSave(page, saveWithArchive(12));
  await ready(page);
  await expect(lamps(page)).toHaveCount(12);
  const lobby = await lobbyBox(page);
  const k = lobby.w / 801;
  const rects = LOBBY.staticLampRects.status === 'derived' ? LOBBY.staticLampRects.rects : [];
  const info = await lamps(page).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { kind: el.getAttribute('data-kind'), index: Number(el.getAttribute('data-index')), l: r.left, t: r.top, r: r.right, b: r.bottom, img: !!el.querySelector('img.lamp-lantern') };
    }),
  );
  const statics = info.filter((i) => i.kind === 'static-lantern').sort((a, b) => a.index - b.index);
  expect(statics.map((s) => s.index)).toEqual([0, 1, 2]);
  expect(statics.map((s) => s.img)).toEqual([false, false, false]); // 只叠光，不放新图
  // 位置正好是原画灯框
  const sortedRects = [...rects].sort((a, b) => a[0] - b[0]);
  statics.forEach((s, i) => {
    const r = sortedRects[i]!;
    expect(Math.abs(s.l - (lobby.l + r[0] * k))).toBeLessThan(1.5);
    expect(Math.abs(s.t - (lobby.t + r[1] * k))).toBeLessThan(1.5);
  });
  expect(statics[0]!.l).toBeLessThan(statics[1]!.l);
  expect(statics[1]!.l).toBeLessThan(statics[2]!.l);
  const hung = info.filter((i) => i.kind === 'hung-lantern');
  expect(hung).toHaveLength(9);
  expect(hung.every((h) => h.img)).toBe(true);
  // 组件是透明 PNG：真的加载成功，有透明通道
  const loaded = await page.locator('img.lamp-lantern').first().evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    return { w: img.naturalWidth, h: img.naturalHeight, corner: g.getImageData(2, 2, 1, 1).data[3], centre: g.getImageData(img.naturalWidth / 2, img.naturalHeight * 0.4, 1, 1).data[3] };
  });
  expect(loaded.w).toBe(64);
  expect(loaded.h).toBe(96);
  expect(loaded.corner).toBe(0); // 背景透明
  expect(loaded.centre).toBeGreaterThanOrEqual(240); // 灯身不透明
});

test('挂墙灯不遮书、门、已有灯笼和住客；都挂在上半墙上，有挂钩承托', async ({ page }) => {
  await seedSave(page, saveWithArchive(12));
  await ready(page);
  const lobby = await lobbyBox(page);
  const k = lobby.w / 801;
  const book = (await page.locator('.archive-book').boundingBox())!;
  const hung = await page.locator('.warm-lamp[data-kind="hung-lantern"]').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom, hook: !!el.querySelector('.lamp-hook circle') };
    }),
  );
  const statics = LOBBY.staticLampRects.status === 'derived' ? LOBBY.staticLampRects.rects : [];
  for (const h of hung) {
    expect(h.hook).toBe(true);
    // 在门厅上半墙里（顶边在梁下面，底边在桌面上方）
    expect(h.t).toBeGreaterThanOrEqual(lobby.t + 22 * k);
    expect(h.b).toBeLessThanOrEqual(lobby.t + 225 * k);
    expect(h.l).toBeGreaterThanOrEqual(lobby.l + 34 * k);
    expect(h.r).toBeLessThanOrEqual(lobby.l + 762 * k);
    // 不碰书的热区
    expect(h.r <= book.x || h.l >= book.x + book.width || h.b <= book.y || h.t >= book.y + book.height).toBe(true);
    // 不碰原画里的 3 盏灯笼
    for (const s of statics) {
      const o = { l: lobby.l + s[0] * k, t: lobby.t + s[1] * k, r: lobby.l + s[2] * k, b: lobby.t + s[3] * k };
      expect(h.r <= o.l || h.l >= o.r || h.b <= o.t || h.t >= o.b).toBe(true);
    }
  }
  // 互不重叠
  for (let i = 0; i < hung.length; i++)
    for (let j = i + 1; j < hung.length; j++) expect(hung[i]!.r <= hung[j]!.l || hung[j]!.r <= hung[i]!.l || hung[i]!.b <= hung[j]!.t || hung[j]!.b <= hung[i]!.t).toBe(true);
});

test('暖金光晕慢呼吸（周期 ≥3 秒，透明度波动 ≤15%），不闪烁', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await seedSave(page, saveWithArchive(12));
  await ready(page);
  const halo = await page.locator('.lamp-halo').first().evaluate((el) => {
    const s = getComputedStyle(el);
    const kf = (document.getAnimations().find((a) => (a as CSSAnimation).animationName === 'lamp-breathe')!.effect as KeyframeEffect).getKeyframes().map((f) => Number(f.opacity));
    return { duration: parseFloat(s.animationDuration), name: s.animationName, kf };
  });
  expect(halo.name).toBe('lamp-breathe');
  expect(halo.duration).toBeGreaterThanOrEqual(3);
  expect(Math.max(...halo.kf) - Math.min(...halo.kf)).toBeLessThanOrEqual(0.15 + 1e-9);
  const flame = await page.locator('.lamp-flame').first().evaluate((el) => parseFloat(getComputedStyle(el).animationDuration));
  expect(flame).toBeGreaterThanOrEqual(3);
});

test('减少动态：灯静止发光，没有呼吸、摇曳和小星', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await seedSave(page, saveWithArchive(12));
  await ready(page);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await expect(page.locator('.lamp-halo').first()).toBeVisible();
  await context.close();
});

test('送走一只：飞行最后 0.5 秒才多一盏灯，亮起时有一两颗小星；删除未完成的不增不减；刷新一致', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await ready(page);
  await create(page, 'Remove me');
  await create(page, 'Keep me');
  await expect(page.locator('.ghost-enter')).toHaveCount(0);
  // 删除未完成的：灯数不变
  await openGhost(ghosts(page).first());
  await card(page).getByRole('button', { name: 'Say goodbye' }).click();
  await page.getByRole('dialog').getByRole('button').first().click();
  await expect(ghosts(page)).toHaveCount(1, { timeout: 5000 });
  await expect(lamps(page)).toHaveCount(0);
  // 完成并送走剩下的那只
  const ghost = ghosts(page).first();
  await openGhost(ghost);
  await setCriteria(page, 'Done');
  await addStep(page, 'one');
  await card(page).getByRole('checkbox').nth(0).check();
  await expect(ghost).not.toHaveAttribute('data-chore', /.*/, { timeout: 4000 });
  // 用观察器记下每一次 DOM 变化时的阶段、灯数与小星数（比逐帧采样可靠）
  await page.evaluate(() => {
    const w = window as unknown as { __lamp: { phase: string | null; count: number; at: number; sparks: number }[] };
    w.__lamp = [];
    const t0 = performance.now();
    const note = () => {
      const c = document.querySelector('.celebration');
      w.__lamp.push({
        phase: c?.getAttribute('data-phase') ?? null,
        count: document.querySelectorAll('.warm-lamp').length,
        at: performance.now() - t0,
        sparks: document.querySelectorAll('.warm-lamp .lamp-sparks .fx-star').length,
      });
    };
    new MutationObserver(note).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-phase', 'class'] });
    note();
  });
  await card(page).getByRole('button', { name: 'Confirm complete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm complete' }).click();
  await expect(page.locator('.celebration')).toHaveAttribute('data-phase', 'gold', { timeout: 5000 });
  await expect(page.locator('.celebration')).toHaveCount(0, { timeout: 9000 });
  await expect(lamps(page)).toHaveCount(1);
  const log = await page.evaluate(() => (window as unknown as { __lamp: { phase: string | null; count: number; at: number; sparks: number }[] }).__lamp);
  const lit = log.find((f) => f.count === 1)!;
  const flyStart = log.find((f) => f.phase === 'fly')!;
  const end = log.filter((f) => f.phase !== null).pop()!;
  // 点亮发生在飞行的最后约 0.5 秒：离飞行开始约 1.3 秒，离序列结束约 0.5 秒
  expect(lit.at - flyStart.at).toBeGreaterThan(1000);
  expect(end.at - lit.at).toBeLessThan(900);
  expect(log.filter((f) => f.phase !== null && f.phase !== 'fly').every((f) => f.count === 0)).toBe(true);
  expect(Math.max(...log.map((f) => f.sparks))).toBeGreaterThanOrEqual(1);
  expect(Math.max(...log.map((f) => f.sparks))).toBeLessThanOrEqual(2);
  // 不快闪：灯数单调、只增不减
  for (let i = 1; i < log.length; i++) expect(log[i]!.count).toBeGreaterThanOrEqual(log[i - 1]!.count);
  await page.reload();
  await expect(lamps(page)).toHaveCount(1);
});

test('第 13 次送走灯数仍是 12', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedSave(page, saveWithArchive(12));
  await ready(page);
  await expect(lamps(page)).toHaveCount(12);
  await create(page, 'Thirteenth');
  const ghost = ghosts(page).first();
  await openGhost(ghost);
  await setCriteria(page, 'Done');
  await addStep(page, 'one');
  await card(page).getByRole('checkbox').nth(0).check();
  await card(page).getByRole('button', { name: 'Confirm complete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm complete' }).click();
  await expect(page.locator('.celebration')).toHaveCount(0, { timeout: 9000 });
  await expect(lamps(page)).toHaveCount(12);
  expect(await lampCount(page)).toBe('12');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ub:save')!).house.completedCount)).toBe(13);
  await page.reload();
  await expect(lamps(page)).toHaveCount(12);
});
