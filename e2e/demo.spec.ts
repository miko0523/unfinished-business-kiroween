import { expect, test, type Page } from '@playwright/test';
import { BAD_SAVES } from '../tests/helpers/badSaves';
import { card, create, ghosts, openGhost, ready } from './helpers/app';

const OLD_BACKUP = 'ub:backup:2026-10-01';

/** 记录每一次存储写入与删除（键名）。 */
async function watchStorage(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __ops: string[] };
    w.__ops = [];
    const set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      w.__ops.push(`set:${k}`);
      return set.call(this, k, v);
    };
    Storage.prototype.removeItem = function (k: string) {
      w.__ops.push(`remove:${k}`);
      return remove.call(this, k);
    };
  });
}
const ops = (page: Page) => page.evaluate(() => (window as unknown as { __ops: string[] }).__ops);
const resetOps = (page: Page) => page.evaluate(() => void ((window as unknown as { __ops: string[] }).__ops.length = 0));
/** 全部存储内容，按键排序后逐字符可比。 */
const dump = (page: Page) => page.evaluate(() => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));

const tryButton = (page: Page) => page.getByRole('button', { name: 'Try sample' });
const exitButton = (page: Page) => page.locator('.demo-bar').getByRole('button', { name: 'Exit demo' });
const NOTICE = 'You are visiting a sample ghost. Your own house stays untouched.';

/** 先建一只真实的幽灵并等它落盘，再放一份旧备份；之后的写入计数从零开始。 */
async function seedRealHouse(page: Page) {
  await watchStorage(page);
  await ready(page);
  await create(page, 'Real chore');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ub:save') ?? '')).toContain('Real chore');
  await page.evaluate((k) => localStorage.setItem(k, 'older backup text'), OLD_BACKUP);
  await resetOps(page);
}

test('30 秒脚本：Try sample → 勾一步 → 取消 → 重新勾三步 → 等你确认 → 确认 → 纪念册 → Exit demo；真实存档逐字符不变', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await seedRealHouse(page);
  const before = await dump(page);
  expect(before).toContain('Real chore');
  expect(before).toContain(OLD_BACKUP);

  // 之后的所有动画和计时都由页面时钟推进；总时长以它的读数为准。
  await page.clock.install();
  const t0 = await page.evaluate(() => Date.now());
  const run = (ms: number) => page.clock.runFor(ms);

  await tryButton(page).click(); // 0s
  await expect(page.locator('.demo-bar')).toContainText(NOTICE);
  await expect(exitButton(page)).toBeFocused();
  const ghost = ghosts(page);
  await expect(ghost).toHaveCount(1);
  await expect(ghost).toHaveAttribute('data-state', 'white');
  expect(await ghost.getAttribute('aria-label')).toContain('Tidy the desk');
  expect(await ghost.getAttribute('aria-label')).toContain('floor 2');
  await openGhost(ghost);
  await expect(card(page).getByRole('heading', { name: 'Tidy the desk' })).toBeVisible();
  await expect(card(page)).toContainText('The desk is clear');
  await expect(card(page).getByRole('checkbox')).toHaveCount(3);

  await card(page).getByRole('checkbox').nth(0).check(); // 勾一步，变绿
  await expect(ghost).toHaveAttribute('data-chore', 'sweep');
  await run(2500);
  await expect(ghost).toHaveAttribute('data-state', 'green');
  await card(page).getByRole('checkbox').nth(0).uncheck(); // 取消，橡皮擦
  await expect(ghost).toHaveAttribute('data-anim', 'erase');
  await run(2500);
  await expect(card(page)).toContainText('0 of 3 done');
  for (const [i, chore] of (['sweep', 'water', 'window'] as const).entries()) {
    await card(page).getByRole('checkbox').nth(i).check();
    await expect(ghost).toHaveAttribute('data-chore', chore);
    await run(2500);
  }
  await expect(ghost).toHaveAttribute('data-pending', 'true');
  await expect(card(page)).toContainText('Ready to confirm');

  await card(page).getByRole('button', { name: 'Confirm complete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm complete' }).click();
  for (const phase of ['gold', 'wave', 'stamp', 'fly']) {
    await expect(page.locator('.celebration')).toHaveAttribute('data-phase', phase);
    await run(1200);
  }
  await run(1500);
  await expect(page.locator('.celebration')).toHaveCount(0);
  await expect(page.locator('.warm-lamp')).toHaveCount(1);

  await page.locator('.archive-book').click();
  await expect(page).toHaveURL(/#\/archive$/);
  await expect(page.locator('.archive-entry')).toHaveCount(1);
  await expect(exitButton(page)).toBeVisible(); // 示例的纪念册里也能退出
  await exitButton(page).click();

  const elapsed = (await page.evaluate(() => Date.now())) - t0;
  expect(elapsed).toBeLessThanOrEqual(30_000);

  // 回到真实的房子，原样
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.demo-bar')).toHaveCount(0);
  await expect(tryButton(page)).toBeFocused();
  await expect(ghosts(page)).toHaveCount(1);
  expect(await ghosts(page).first().getAttribute('aria-label')).toContain('Real chore');
  await expect(page.locator('.warm-lamp')).toHaveCount(0);
  await page.clock.resume();
  await page.waitForTimeout(800); // 过了保存的防抖时间，也没有任何写入
  expect(await ops(page)).toEqual([]);
  expect(await dump(page)).toBe(before);
  expect(errors).toEqual([]);
});

test('Reduced Motion：同样的循环，庆祝静止展示盖章页，真实存档不变', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedRealHouse(page);
  const before = await dump(page);
  await tryButton(page).click();
  const ghost = ghosts(page);
  await openGhost(ghost);
  await card(page).getByRole('checkbox').nth(0).check();
  await card(page).getByRole('checkbox').nth(0).uncheck();
  for (let i = 0; i < 3; i++) await card(page).getByRole('checkbox').nth(i).check();
  await expect(ghost).toHaveAttribute('data-pending', 'true');
  await card(page).getByRole('button', { name: 'Confirm complete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm complete' }).click();
  await expect(page.locator('.stamp-page')).toContainText('A little ghost, complete on');
  expect(await page.evaluate(() => document.getAnimations().some((a) => (a as CSSAnimation).effect && (a.effect as KeyframeEffect).target?.classList.contains('celebration-ghost')))).toBe(false);
  await expect(page.locator('.warm-lamp')).toHaveCount(1);
  await exitButton(page).click();
  await expect(page.locator('.demo-bar')).toHaveCount(0);
  await page.waitForTimeout(600);
  expect(await ops(page)).toEqual([]);
  expect(await dump(page)).toBe(before);
});

test('确认框打开时退出：对话框里就有 Exit demo；退出后没有残留，焦点回到 Try sample', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedRealHouse(page);
  const before = await dump(page);
  await tryButton(page).click();
  await openGhost(ghosts(page));
  for (let i = 0; i < 3; i++) await card(page).getByRole('checkbox').nth(i).check();
  await card(page).getByRole('button', { name: 'Confirm complete' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Exit demo' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(tryButton(page)).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.isConnected)).toBe(true);
  await page.waitForTimeout(500);
  expect(await ops(page)).toEqual([]);
  expect(await dump(page)).toBe(before);
  expect(errors).toEqual([]);
});

test('抽屉打开、手机宽度下滚动后，Exit demo 仍在可见区域', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await tryButton(page).click();
  await openGhost(ghosts(page));
  await expect(card(page)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(exitButton(page)).toBeInViewport();
  const box = (await exitButton(page).boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await exitButton(page).click();
  await expect(card(page)).toHaveCount(0);
});

test('在示例纪念册里退出：地址回到进入前的样子，真实页面不停在示例的页面上', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedRealHouse(page);
  // 进入前正停在真实纪念册
  await page.locator('.archive-book').click();
  await expect(page).toHaveURL(/#\/archive$/);
  await tryButton(page).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('.archive')).toHaveCount(0);
  await page.locator('.archive-book').click();
  await expect(page.locator('.archive')).toBeVisible();
  await expect(page.locator('.archive-entry')).toHaveCount(0);
  await exitButton(page).click();
  await expect(page).toHaveURL(/#\/archive$/);
  await expect(page.locator('.archive')).toBeVisible();
  await expect(page.locator('.demo-bar')).toHaveCount(0);
  expect(await ops(page)).toEqual([]);
});

test('恢复界面不显示 Try sample', async ({ page }) => {
  await watchStorage(page);
  await page.goto('/');
  await page.evaluate((raw) => localStorage.setItem('ub:save', raw), Object.values(BAD_SAVES)[0]!);
  await resetOps(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'The old notebook got smudged' })).toBeVisible();
  await expect(tryButton(page)).toHaveCount(0);
  await expect(page.locator('.demo-bar')).toHaveCount(0);
  expect(await ops(page)).toEqual([]);
});

test('内存模式：可以进入示例，退出后仍是内存模式，原来的内容还在，不写任何键', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
  });
  await ready(page);
  await create(page, 'Only in memory');
  await expect(page.locator('.storage-notice')).toBeVisible();
  const notice = await page.locator('.storage-notice').innerText();
  await tryButton(page).click();
  await expect(page.locator('.demo-bar')).toContainText(NOTICE);
  await expect(page.locator('.storage-notice')).toHaveCount(0);
  await exitButton(page).click();
  await expect(page.locator('.storage-notice')).toHaveText(notice);
  await expect(ghosts(page)).toHaveCount(1);
  expect(await ghosts(page).first().getAttribute('aria-label')).toContain('Only in memory');
});
