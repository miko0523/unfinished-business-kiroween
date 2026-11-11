import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { addStep, card, create, ghosts, openGhost, ready, setCriteria } from './helpers/app';

// 离线可用（R12.4）：不使用 Service Worker。产品在首屏之后趁空闲自己预载还没长出的楼层图片；
// 测试只等待产品报告的预载状态（.house[data-floor-preload]），从不自己去访问未来楼层的图片。

const FUTURE = /\/assets\/dollhouse\/[12]x\/floor-0[2-5]\.png$/;
const futureModules = ['floor-02', 'floor-03', 'floor-04', 'floor-05'];

function record(context: BrowserContext) {
  const all: string[] = [];
  const failed: string[] = [];
  context.on('request', (r) => all.push(r.url()));
  context.on('requestfailed', (r) => failed.push(r.url()));
  return { all, failed };
}

const foreign = (urls: string[], origin: string) => urls.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:') && new URL(u).origin !== origin);

/** 页面里每个已显示的楼层模块图片都真的解码出来了，且没有退成纯色底板。 */
async function imagesHealthy(page: Page, ids: string[]) {
  for (const id of ids) {
    await expect
      .poll(() => page.evaluate((m) => {
        const img = document.querySelector<HTMLImageElement>(`.static-layer img[data-module="${m}"]`);
        return !!img && img.complete && img.naturalWidth > 0;
      }, id), { message: id })
      .toBe(true);
  }
  await expect(page.locator('.static-plate')).toHaveCount(0);
}

test('断网前等预载完成；断网后 3 只幽灵长出三楼，主线走完，整个过程没有非同源请求', async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const seen = record(context);

  await ready(page);
  const origin = new URL(page.url()).origin;
  const house = page.locator('.house');
  // 此刻页面只显示门厅、一层住宅和屋顶：未来楼层不在页面里，测试也没有碰它们。
  await expect(page.locator('.static-layer img')).toHaveCount(3);
  await expect(house).toHaveAttribute('data-floor-preload', /^(loading|ready)$/);

  // 离线前需要完成的状态：产品报告预载 ready。
  await expect(house).toHaveAttribute('data-floor-preload', 'ready', { timeout: 20_000 });
  const preloaded = seen.all.filter((u) => FUTURE.test(u));
  expect(preloaded.map((u) => /floor-0\d/.exec(u)![0]).sort(), '产品为四个未来楼层各取了一张').toEqual(futureModules);
  await expect(page.locator('.static-layer img')).toHaveCount(3); // 预载不改变画面
  await expect(ghosts(page)).toHaveCount(0);

  await context.setOffline(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  const probe = await page.evaluate(() => fetch(`${location.origin}/__offline_probe__`).then(() => 'reached', () => 'unreachable'));
  expect(probe, '断网确实生效').toBe('unreachable');
  const mark = seen.all.length;
  const failedMark = seen.failed.length;

  // 3 只幽灵，三楼长出来。
  await create(page, 'Offline one');
  await create(page, 'Offline two');
  await create(page, 'Offline three');
  await expect(house).toHaveAttribute('data-grown-floors', '3');
  await expect(page.locator('.static-layer [data-module]')).toHaveCount(4);
  await imagesHealthy(page, ['lobby', 'floor-01', 'floor-02', 'roof']);

  // 主线：第一只幽灵走完（缩减版：一个完成条件、一个步骤、勾选、确认）。
  const ghost = ghosts(page).first();
  await openGhost(ghost);
  await setCriteria(page, 'The offline house stands');
  await addStep(page, 'Light one lamp');
  await expect(ghost).toHaveAttribute('data-state', 'white');
  await card(page).getByRole('checkbox').check();
  await expect(ghost).toHaveAttribute('data-pending', 'true');
  await card(page).getByRole('button', { name: 'Confirm complete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm complete' }).click();
  await expect(ghosts(page)).toHaveCount(2);
  await expect(page.locator('.celebration')).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('.warm-lamp')).toHaveCount(1);
  await page.locator('.archive-book').click();
  await expect(page).toHaveURL(/#\/archive$/);
  await expect(page.locator('.archive-entry')).toHaveCount(1);
  await page.getByRole('link', { name: 'Back to the house' }).click();

  // 继续长到六层：其余三个未来楼层同样不靠网络。
  for (let i = 4; i <= 10; i++) await create(page, `Offline ${i}`);
  await expect(house).toHaveAttribute('data-grown-floors', '6');
  await imagesHealthy(page, ['lobby', 'floor-01', 'floor-02', 'floor-03', 'floor-04', 'floor-05', 'roof']);

  expect(foreign(seen.all, origin), '整个过程没有非同源请求').toEqual([]);
  expect(seen.all.slice(mark).filter((u) => /\.png$/.test(u)), '断网后没有再为图片发请求').toEqual([]);
  expect(seen.failed.slice(failedMark), '断网后没有失败的请求').toEqual([]);
  expect(errors).toEqual([]);
});

test('预载没取到时：状态如实报告 partial，长出的那层用纯色底板，幽灵仍可点开，没有技术提示', async ({ page, context }) => {
  await context.route(FUTURE, (route) => route.abort());
  await ready(page);
  const house = page.locator('.house');
  await expect(house).toHaveAttribute('data-floor-preload', 'partial', { timeout: 20_000 });
  for (const t of ['One', 'Two', 'Three']) await create(page, t);
  await expect(house).toHaveAttribute('data-grown-floors', '3');
  await expect(page.locator('.static-plate[data-module="floor-02"]')).toHaveCount(1);
  await openGhost(ghosts(page).first());
  await expect(card(page)).toBeVisible();
  const text = (await page.locator('body').innerText()).toLowerCase();
  for (const w of ['error', 'failed', 'network', 'offline', 'png']) expect(text).not.toContain(w);
});

// 预载用的 srcset/sizes 与显示时完全一样：不同像素比与窗口宽度下，浏览器为将来楼层选的文件，就是之后真正显示的文件，且只取一次。
for (const { name, viewport, deviceScaleFactor, scale } of [
  { name: '桌面 1x', viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, scale: '1x' },
  { name: '桌面 2x', viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, scale: '2x' },
  { name: '窄屏 2x', viewport: { width: 320, height: 700 }, deviceScaleFactor: 2, scale: '1x' },
]) {
  test.describe(`预载与显示选同一个文件：${name}`, () => {
    test.use({ viewport, deviceScaleFactor });
    test('长出三楼时直接用预载的文件，不再发第二次请求', async ({ page, context }) => {
      const seen = record(context);
      await ready(page);
      await expect(page.locator('.house')).toHaveAttribute('data-floor-preload', 'ready', { timeout: 20_000 });
      const wanted = new RegExp(`/assets/dollhouse/${scale}/floor-0[2-5]\\.png$`);
      expect(seen.all.filter((u) => FUTURE.test(u)).every((u) => wanted.test(u))).toBe(true);
      for (const t of ['One', 'Two', 'Three']) await create(page, t);
      await expect(page.locator('.house')).toHaveAttribute('data-grown-floors', '3');
      await imagesHealthy(page, ['floor-02']);
      const shown = await page.locator('.static-layer img[data-module="floor-02"]').evaluate((img) => (img as HTMLImageElement).currentSrc);
      expect(shown.endsWith(`/assets/dollhouse/${scale}/floor-02.png`)).toBe(true);
      expect(seen.all.filter((u) => u === shown), '同一文件只请求一次').toHaveLength(1);
    });
  });
}
