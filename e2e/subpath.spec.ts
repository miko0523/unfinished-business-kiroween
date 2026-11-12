import { expect, test, type Page } from '@playwright/test';
import type { Server } from 'node:http';
import { addStep, card, create, ghosts, openGhost, ready, setCriteria } from './helpers/app';
import { saveWithArchive, seedSave } from './helpers/save';
import { SUBPATH_PREFIX, startSubpathServer, stopServer } from './helpers/subpath-server';

// 根路径与 /unfinished-business/ 子路径各走一遍缩减主线：
// 图片（含预载的未来楼层与灯笼）、存档（刷新后还在）、纪念册（hash 路由，直接打开也行）。
// 每个测试使用 Playwright 自带的隔离浏览器上下文和合成存档（已完成 4 件，所以再完成一件就会挂上灯笼图片），不碰任何真实玩家数据。

async function reducedMainline(page: Page, appPath: string, origin: string, prefix: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requests: string[] = [];
  const bad: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('response', (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // 合成存档：4 条纪念，页面一加载就读到它。
  await seedSave(page, saveWithArchive(4));

  // 图片：门厅、一层住宅、屋顶都解码出来了。
  await ready(page, appPath);
  await expect(page.locator('.static-layer img')).toHaveCount(3);
  await expect(page.locator('.house')).toHaveAttribute('data-floor-preload', 'ready', { timeout: 20_000 });

  // 三只幽灵：长出三楼，预载的楼层图片在这个前缀下能显示。
  for (const t of ['Sub one', 'Sub two', 'Sub three']) await create(page, t);
  await expect(page.locator('.house')).toHaveAttribute('data-grown-floors', '3');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const img = document.querySelector<HTMLImageElement>('.static-layer img[data-module="floor-02"]');
        return !!img && img.complete && img.naturalWidth > 0;
      }),
    )
    .toBe(true);
  await expect(page.locator('.static-plate')).toHaveCount(0);

  // 缩减主线：条件、一个步骤、勾选、确认。
  const ghost = ghosts(page).first();
  await openGhost(ghost);
  await setCriteria(page, 'The path works');
  await addStep(page, 'Walk it once');
  await card(page).getByRole('checkbox').check();
  await expect(ghost).toHaveAttribute('data-pending', 'true');
  await card(page).getByRole('button', { name: 'Confirm complete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm complete' }).click();
  await expect(ghosts(page)).toHaveCount(2);
  await expect(page.locator('.celebration')).toHaveCount(0, { timeout: 8000 });

  // 第 5 盏暖灯起是挂着的灯笼图片（派生组件 lantern.png）。
  const lantern = page.locator('.warm-lamp img.lamp-lantern').first();
  await expect(lantern).toBeVisible();
  await expect.poll(() => lantern.evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)).toBe(true);

  // 存档：写在这个源下，刷新后还在。
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ub:save') ?? 'null'));
  expect(saved.archive).toHaveLength(5);
  expect(saved.tasks).toHaveLength(2);
  expect(saved.house.grownFloors).toBe(3);

  // 纪念册：点进去，刷新仍在；直接用带 hash 的子路径地址打开也在。
  await page.locator('.archive-book').click();
  await expect(page).toHaveURL(new RegExp(`${prefix}#/archive$`));
  await expect(page.locator('.archive-entry')).toHaveCount(5);
  await page.reload();
  await expect(page.locator('.archive-entry')).toHaveCount(5);
  // 回到房子（只是 hash 变化），再真正刷新一次：存档把房子和住客原样带回来。
  await page.goto(`${origin}${prefix}`);
  await page.reload();
  await expect(page.locator('.house')).toHaveAttribute('data-grown-floors', '3');
  await expect(ghosts(page)).toHaveCount(2);
  // 直接用带 hash 的地址打开纪念册。
  await page.goto(`${origin}${prefix}#/archive`);
  await page.reload();
  await expect(page.locator('.archive-entry')).toHaveCount(5);

  // 所有请求都在本源、本前缀之下，没有 4xx/5xx。
  const pngs = requests.filter((u) => u.endsWith('.png'));
  expect(pngs.length).toBeGreaterThanOrEqual(8); // 门厅/一层/屋顶 + 四个预载楼层 + 灯笼
  for (const u of requests) {
    if (u.startsWith('data:')) continue;
    const url = new URL(u);
    expect(url.origin, u).toBe(origin);
    expect(url.pathname.startsWith(prefix), u).toBe(true);
  }
  expect(pngs.some((u) => u.includes('/assets/dollhouse/components/lantern.png'))).toBe(true);
  expect(bad).toEqual([]);
  expect(errors).toEqual([]);
}

test('根路径：缩减主线（图片、存档、纪念册）', async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  await reducedMainline(page, '/', new URL(baseURL!).origin, '/');
});

test.describe('子路径 /unfinished-business/', () => {
  let server: Server;
  let origin = '';
  test.beforeAll(async () => {
    ({ server, origin } = await startSubpathServer());
  });
  test.afterAll(async () => {
    await stopServer(server);
  });

  test('缩减主线：图片、存档与纪念册都在子路径下工作', async ({ page }) => {
    test.setTimeout(90_000);
    await reducedMainline(page, origin + SUBPATH_PREFIX, origin, SUBPATH_PREFIX);
  });

  // 发起人在里程碑 C 要走的那条路：从 Try sample 开始，再自己创建一只，切换语言，刷新。在子路径下，所有请求都在本源本前缀内。
  test('发起人的体验路径：Try sample → 退出 → 自己创建 → 切到中文 → 刷新（请求都在前缀内、无 4xx）', async ({ page }) => {
    test.setTimeout(90_000);
    const requests: string[] = [];
    const bad: string[] = [];
    const errors: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    page.on('response', (r) => r.status() >= 400 && bad.push(`${r.status()} ${r.url()}`));
    page.on('pageerror', (e) => errors.push(String(e)));

    await ready(page, origin + SUBPATH_PREFIX);
    await page.getByRole('button', { name: 'Try sample' }).click();
    await expect(page.locator('.demo-bar')).toBeVisible();
    await expect(ghosts(page)).toHaveCount(1);
    await page.locator('.demo-bar').getByRole('button', { name: 'Exit demo' }).click();
    await expect(page.locator('.demo-bar')).toHaveCount(0);
    // 示例没有碰真实存档。
    expect(await page.evaluate(() => localStorage.getItem('ub:save'))).toBeNull();

    await create(page, 'My own first ghost');
    await expect(ghosts(page)).toHaveCount(1);
    await page.getByRole('button', { name: /switch to 简体中文/ }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ub:save') ?? '{}').settings?.lang)).toBe('zh-CN');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(ghosts(page)).toHaveCount(1);
    await expect(page.locator('.house')).toHaveAttribute('data-floor-preload', 'ready', { timeout: 20_000 });

    for (const u of requests) {
      if (u.startsWith('data:')) continue;
      const url = new URL(u);
      expect(url.origin, u).toBe(origin);
      expect(url.pathname.startsWith(SUBPATH_PREFIX), u).toBe(true);
    }
    expect(bad).toEqual([]);
    expect(errors).toEqual([]);
  });

  // GitHub Pages 的真实地址在子路径下：内嵌音频模块必须留在前缀内并能真正起播。
  test('声音：在子路径下打开，内嵌音频模块从前缀内延迟加载（无 4xx），进入播放状态', async ({ page }) => {
    const audioModules: { url: string; status: number; type: string }[] = [];
    const bad: string[] = [];
    const errors: string[] = [];
    page.on('response', (r) => {
      if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
      if (/\/assets\/embeddedAudio-[^/]+\.js(?:\?|$)/.test(r.url())) {
        audioModules.push({ url: r.url(), status: r.status(), type: r.headers()['content-type'] ?? '' });
      }
    });
    page.on('pageerror', (e) => errors.push(String(e)));

    await ready(page, origin + SUBPATH_PREFIX);
    const sw = page.getByRole('button', { name: 'Music and sounds' });
    await expect(sw).toHaveAttribute('data-sound-state', 'off');
    await sw.click();
    await expect(sw).toHaveAttribute('data-sound-state', 'playing', { timeout: 15_000 });
    await expect(sw).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => audioModules.length, { timeout: 10_000 }).toBe(1);

    for (const a of audioModules) {
      const url = new URL(a.url);
      expect(url.origin, a.url).toBe(origin);
      expect(url.pathname.startsWith(`${SUBPATH_PREFIX}assets/embeddedAudio-`), a.url).toBe(true);
      expect(a.status, a.url).toBe(200);
      expect(a.type, a.url).toMatch(/javascript/);
    }
    expect(bad).toEqual([]);
    expect(errors).toEqual([]);
  });
});
