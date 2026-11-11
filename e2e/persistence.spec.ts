import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { addStep, card, create, ghosts, openGhost, ready, setCriteria } from './helpers/app';

const TITLE = '整理书桌 <b>tidy</b> & more';

/** 记录每次 localStorage 写入的键与时间；可模拟写满。 */
async function watchStorage(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __writes: { k: string; t: number }[]; __full: boolean };
    w.__writes = [];
    w.__full = false;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (w.__full) throw new DOMException('full', 'QuotaExceededError');
      w.__writes.push({ k, t: performance.now() });
      return original.call(this, k, v);
    };
  });
}

const writes = (page: Page) => page.evaluate(() => (window as unknown as { __writes: { k: string }[] }).__writes.map((x) => x.k));
const setFull = (page: Page, on: boolean) => page.evaluate((v) => ((window as unknown as { __full: boolean }).__full = v), on);
const saved = (page: Page) => page.evaluate(() => localStorage.getItem('ub:save'));

/** 创建一只已经全部完成、等待确认的小幽灵并打开详情。 */
async function pendingGhost(page: Page, title = TITLE) {
  await create(page, title);
  const ghost = ghosts(page).first();
  await openGhost(ghost);
  await setCriteria(page, 'The desk is clear');
  await addStep(page, 'Stack the papers');
  await card(page).getByRole('checkbox').check();
  await expect(ghost).toHaveAttribute('data-pending', 'true');
  return ghost;
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('启动零写入；首次变更才写，且在 300ms 防抖之后', async ({ page }) => {
  await watchStorage(page);
  await ready(page);
  await page.waitForTimeout(800);
  expect(await writes(page)).toEqual([]);
  expect(await saved(page)).toBeNull();

  // 在页面内提交并计时，避免测试进程的延迟影响判断
  const delay = await page.evaluate(async () => {
    const w = window as unknown as { __writes: { t: number }[] };
    const input = document.querySelector<HTMLInputElement>('#create-title')!;
    input.value = 'Water the plants';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50)); // 让输入框的状态先落定
    document.querySelector<HTMLFormElement>('.create-form')!.requestSubmit();
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 900));
    return { count: w.__writes.length, delay: (w.__writes[0]?.t ?? 0) - t0 };
  });
  expect(delay.count).toBe(1);
  expect(delay.delay).toBeGreaterThanOrEqual(280);
  expect(delay.delay).toBeLessThan(700);
});

test('页面隐藏与 pagehide 立即补写，不等防抖', async ({ page }) => {
  await watchStorage(page);
  await ready(page);
  // 隐藏时补写的监听在首帧绘制之后才装上；先等这一帧过去，免得事件来得比监听还早。
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
  const counts = await page.evaluate(async () => {
    const w = window as unknown as { __writes: unknown[] };
    const make = async (title: string) => {
      const input = document.querySelector<HTMLInputElement>('#create-title')!;
      input.value = title;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 50)); // 让输入框的状态先落定
      document.querySelector<HTMLFormElement>('.create-form')!.requestSubmit();
    };
    await make('First');
    const afterCreate = w.__writes.length;
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const afterHidden = w.__writes.length;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await new Promise((r) => setTimeout(r, 50));
    await make('Second');
    window.dispatchEvent(new Event('pagehide'));
    return [afterCreate, afterHidden, w.__writes.length];
  });
  expect(counts).toEqual([0, 1, 2]);
  const parsed = JSON.parse((await saved(page))!);
  expect(parsed.tasks.map((t: { title: string }) => t.title)).toEqual(['First', 'Second']);
});

test('刷新后保留；确认完成后立刻刷新，直接是最终状态', async ({ page }) => {
  await ready(page);
  await pendingGhost(page);
  await expect.poll(() => saved(page)).toContain('Stack the papers');

  await page.reload();
  await expect(ghosts(page)).toHaveCount(1);
  const ghost = ghosts(page).first();
  await expect(ghost).toHaveAttribute('data-pending', 'true');
  await openGhost(ghost);
  await expect(card(page).getByRole('heading', { name: TITLE })).toBeVisible();
  await expect(card(page)).toContainText('The desk is clear');
  await expect(card(page)).toContainText('1 of 1 done');

  // 确认后立即刷新：同步写入已经落盘
  await card(page).getByRole('button', { name: 'Confirm complete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm complete' }).click();
  await expect(ghosts(page)).toHaveCount(0);
  await page.reload();
  await expect(ghosts(page)).toHaveCount(0);
  await expect(page.locator('.warm-lamp')).toHaveCount(1);
  await page.locator('.archive-book').click();
  await expect(page.locator('.archive-entry')).toHaveCount(1);
  await expect(page.locator('main')).not.toContainText('tidy');
  await page.locator('.archive-entry').getByRole('button', { name: 'Show the title' }).click();
  await page.reload();
  await expect(page.locator('.archive-entry')).toContainText('tidy');
});

test('确认时写入失败：回滚、不放动画、可重试；空间回来后确认成功', async ({ page }) => {
  await watchStorage(page);
  await ready(page);
  const ghost = await pendingGhost(page, 'Sort the shelf');
  await expect.poll(() => saved(page)).toContain('Sort the shelf');
  const before = await saved(page);

  await setFull(page, true);
  await card(page).getByRole('button', { name: 'Confirm complete' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirm complete' }).click();
  await expect(dialog).toContainText("The stamp didn't land this time");
  await expect(ghosts(page)).toHaveCount(1);
  await expect(page.locator('.celebration')).toHaveCount(0);
  await expect(page.locator('.warm-lamp')).toHaveCount(0);
  expect(await saved(page)).toBe(before);

  await setFull(page, false);
  await dialog.getByRole('button', { name: 'Confirm complete' }).click();
  await expect(ghosts(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.warm-lamp')).toHaveCount(1);
  expect(ghost).toBeDefined();
});

test('存储写满：内存里的东西还在，温柔提示，导出入口突出，说明先出现，文件可解析', async ({ page }) => {
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await watchStorage(page);
  await ready(page);
  await setFull(page, true);
  await create(page, TITLE);
  await expect(page.getByText("I couldn't tuck things away this time. Keep a copy so nothing gets lost.")).toBeVisible({ timeout: 3000 });
  await expect(ghosts(page)).toHaveCount(1);
  const keep = page.getByRole('button', { name: 'Keep a copy' });
  await expect(keep).toHaveClass(/loud/);
  expect(await saved(page)).toBeNull();

  // 说明先于下载
  await keep.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('This keepsake takes all your words with it, titles, steps and notes.');
  expect(downloads).toEqual([]);
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Pack the keepsake' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^unfinished-business-\d{8}\.json$/);
  const bytes = readFileSync((await download.path())!);
  const file = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  expect(file.schema_version).toBe(1);
  expect(file.tasks).toHaveLength(1);
  expect(file.tasks[0].title).toBe(TITLE);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 空间回来后，下一次变更把内存里的东西补写进去，文件与存档文本一致
  await setFull(page, false);
  await create(page, 'Another one');
  await expect.poll(() => saved(page)).toContain('Another one');
  const [second] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await keep.click();
      await page.getByRole('dialog').getByRole('button', { name: 'Pack the keepsake' }).click();
    })(),
  ]);
  const text = readFileSync((await second.path())!, 'utf8');
  expect(text).toBe(await saved(page));
});

test('“不用了”不会下载；页面上没有导入入口', async ({ page }) => {
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await ready(page);
  await page.getByRole('button', { name: 'Keep a copy' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(downloads).toEqual([]);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/import|upload|restore/i);
});

test('读到不能用的存档：原文一个字节都不动，什么操作都不写任何键', async ({ page }) => {
  await watchStorage(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('ub:save', '{"schema_version":2,"hello":"old notebook"}'));
  await ready(page);
  // 读不了的存档先停在恢复界面；玩家主动选了空白页，才进入房子
  await expect(page.getByRole('heading', { name: 'The old notebook got smudged' })).toBeVisible();
  expect(await writes(page)).toEqual([]);
  await page.getByRole('button', { name: 'Carry on with a blank page' }).click();
  await expect(page.getByText('Just for now: nothing will be tucked away this time.').first()).toBeVisible();

  await create(page, 'Still works in memory');
  await expect(ghosts(page)).toHaveCount(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
  });
  await page.waitForTimeout(800);
  expect(await writes(page)).toEqual([]);
  expect(await saved(page)).toBe('{"schema_version":2,"hello":"old notebook"}');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['ub:save']);
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/ub:|schema|localStorage|old notebook/);
});
