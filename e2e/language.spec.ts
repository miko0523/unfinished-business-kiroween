import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/en';
import { zhCN } from '../src/i18n/zh-CN';
import { emptyState } from '../src/domain/types';
import { serializeSave } from '../src/persistence/serialize';
import { copyIssues } from '../tests/helpers/copyScan';
import { ready } from './helpers/app';

type Probe = { __languageWrites: string[]; __languageReads: number };
const writes = (page: Page) => page.evaluate(() => (window as unknown as Probe).__languageWrites);
const selected = (page: Page, language: 'en' | 'zh-CN') => page.getByRole('button', { name: language === 'en' ? 'English' : '简体中文', exact: true });

// 每个用例使用 Playwright 新建的隔离 context；只在其中种测试存档，不接触日常浏览器。
async function probe(page: Page, seed: string | null = null, unavailable = false) {
  await page.addInitScript(({ seed, unavailable }) => {
    const set = Storage.prototype.setItem;
    if (seed !== null && localStorage.getItem('ub:save') === null) set.call(localStorage, 'ub:save', seed);
    const w = window as unknown as Probe;
    w.__languageWrites = [];
    w.__languageReads = 0;
    for (const key of ['language', 'languages']) Object.defineProperty(navigator, key, {
      configurable: true, get() { w.__languageReads++; return key === 'language' ? 'zh-CN' : ['zh-CN']; },
    });
    Storage.prototype.setItem = function (key, value) {
      w.__languageWrites.push(`${this === localStorage ? 'local' : 'session'}:set:${key}`);
      if (unavailable) throw new DOMException('unavailable', 'SecurityError');
      return set.call(this, key, value);
    };
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) { w.__languageWrites.push(`remove:${key}`); return remove.call(this, key); };
    const clear = Storage.prototype.clear;
    Storage.prototype.clear = function () { w.__languageWrites.push('clear'); return clear.call(this); };
    if (unavailable) {
      Storage.prototype.getItem = function () { throw new DOMException('unavailable', 'SecurityError'); };
    }
  }, { seed, unavailable });
}

async function flush(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
}

async function cleanTextAndLayout(page: Page) {
  const generated = await page.evaluate(() => {
    const attributes = [...document.querySelectorAll('*')].flatMap((el) =>
      ['aria-label', 'aria-description', 'alt', 'title', 'placeholder'].map((name) => el.getAttribute(name) ?? ''));
    return [document.body.innerText, document.title, ...attributes].join('\n');
  });
  expect(copyIssues(generated)).toEqual([]);
  expect(generated).not.toMatch(/\{(?:floor|side|state|done|total|date|max|length)\}/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // 正文和按钮不能横向溢出各自容器；不把可纵向滚动的抽屉误判为溢出。
  const clipped = await page.locator('button:not([data-ghost]):not(.archive-book), .recovery p, .archive-line, .card-state').evaluateAll((els) =>
    els.filter((el) => el.getClientRects().length && el.scrollWidth > el.clientWidth + 2).map((el) => el.textContent));
  expect(clipped).toEqual([]);
}

async function snapshot(page: Page, name: string) {
  if (await page.locator('dialog').count()) await expect(page.locator('dialog')).toBeVisible();
  await cleanTextAndLayout(page);
  const directory = join('artifacts', 'phase13', 'screenshots');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${Date.now()}-${name}.png`), fullPage: true });
}

test('首次访问无视中文浏览器偏好，正常模式双向切换后刷新保留，只写主存档', async ({ page }) => {
  await probe(page);
  await ready(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(selected(page, 'en')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as unknown as Probe).__languageReads)).toBe(0);
  expect(await writes(page)).toEqual([]);
  await page.getByLabel(en['create.label']).fill('My original words');
  await selected(page, 'zh-CN').click();
  await expect(page.getByLabel(zhCN['create.label'])).toHaveValue('My original words');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page).toHaveTitle(zhCN['app.title']);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ub:save') ?? '{}').settings?.lang)).toBe('zh-CN');
  expect(await writes(page)).toEqual(['local:set:ub:save']);
  await page.reload();
  await expect(selected(page, 'zh-CN')).toHaveAttribute('aria-pressed', 'true');
  await selected(page, 'en').click();
  // 不等防抖就刷新，也会由 pagehide 补写。
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ub:save')!).settings.lang)).toBe('en');
  expect(await page.evaluate(() => (window as unknown as Probe).__languageReads)).toBe(0);
});

test('恢复界面和从恢复进入的内存模式，语言切换、操作和刷新都零存储写入', async ({ page }) => {
  const raw = '{ smudged notebook';
  await probe(page, raw);
  await page.goto('/');
  await selected(page, 'zh-CN').click();
  await expect(page.getByRole('heading', { name: zhCN['recovery.title'] })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await flush(page);
  expect(await writes(page)).toEqual([]);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await selected(page, 'zh-CN').click();
  await page.getByRole('button', { name: zhCN['recovery.blank.button'] }).click();
  await expect(page.getByLabel(zhCN['create.label'])).toBeVisible();
  await selected(page, 'en').click();
  await selected(page, 'zh-CN').click();
  await page.getByLabel(zhCN['create.label']).fill('Just this page');
  await page.getByRole('button', { name: zhCN['create.submit'] }).click();
  await flush(page);
  await page.waitForTimeout(400); // 越过保存防抖，确保没有延迟写入。
  expect(await writes(page)).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('ub:save'))).toBe(raw);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['ub:save']);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: en['recovery.title'] })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(await writes(page)).toEqual([]);
});

test('存储完全不可用时，切换语言不尝试写入', async ({ page }) => {
  await probe(page, null, true);
  await ready(page);
  await selected(page, 'zh-CN').click();
  await expect(page.getByText(zhCN['notice.unsaved'])).toBeVisible();
  await selected(page, 'en').click();
  await flush(page);
  await page.waitForTimeout(400);
  expect(await writes(page)).toEqual([]);
});

test('示例继承当前语言，示例中切换零写入，返回真实房子恢复原语言', async ({ page }) => {
  await probe(page);
  await ready(page);
  await selected(page, 'zh-CN').click();
  await flush(page);
  await page.getByRole('button', { name: zhCN['demo.try'] }).click();
  await expect(page.locator('[data-ghost]')).toHaveAccessibleName(/整理书桌/);
  const before = await writes(page);
  await selected(page, 'en').click();
  await flush(page);
  expect(await writes(page)).toEqual(before);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('[data-ghost]')).toHaveAccessibleName(/Tidy the desk/);
  await page.getByRole('button', { name: en['demo.exit'] }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(selected(page, 'zh-CN')).toHaveAttribute('aria-pressed', 'true');
});

for (const width of [1280, 320]) for (const lang of ['en', 'zh-CN'] as const) {
  const table = lang === 'en' ? en : zhCN;
  const label = `${width}-${lang}`;
  test(`${label}：创建、错误、澄清、步骤、确认、纪念册、导出和告别的文案与排版`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 320 ? 812 : 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await probe(page);
    await ready(page);
    await selected(page, lang).click();
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await snapshot(page, `${label}-home`);
    await page.getByRole('button', { name: table['create.submit'] }).click();
    await expect(page.getByRole('alert')).toContainText('80');
    await page.getByLabel(table['create.label']).fill('A little errand');
    await page.getByRole('button', { name: table['create.submit'] }).click();
    const ghost = page.locator('[data-ghost]');
    await ghost.dispatchEvent('click');
    await expect(ghost).toHaveAccessibleName(new RegExp(table['state.gray']));
    const card = page.getByRole('complementary', { name: table['card.label'] });
    await card.getByLabel(table['criteria.label']).fill('The desk is clear');
    await card.getByRole('button', { name: table['criteria.save'], exact: true }).click();
    await card.getByLabel(table['steps.add.label']).fill('One small step');
    await card.getByRole('button', { name: table['steps.add.submit'], exact: true }).click();
    await expect(ghost).toHaveAccessibleName(new RegExp(table['state.white']));
    await card.getByRole('checkbox').check();
    await expect(card.locator('.pending-badge')).toHaveText(table['state.pending']);
    await snapshot(page, `${label}-card`);
    await card.getByRole('checkbox').uncheck();
    await expect(page.locator('[aria-live]')).toContainText(table['live.erase'].replace('{done}', '0').replace('{total}', '1'));
    await card.getByRole('checkbox').check();
    await card.getByRole('button', { name: table['confirm.button'], exact: true }).click();
    await page.getByLabel(table['confirm.memo.label']).fill('A lovely day');
    await snapshot(page, `${label}-confirm`);
    await page.locator('dialog').getByRole('button', { name: table['confirm.yes'], exact: true }).click();
    await expect(ghost).toHaveCount(0);
    await page.getByRole('button', { name: table['celebrate.skip'] }).click();
    await page.getByRole('button', { name: table['lobby.archive'] }).click();
    await expect(page.locator('.archive-line')).toHaveText(table['archive.entry'].replace('{date}', await page.evaluate(() => JSON.parse(localStorage.getItem('ub:save')!).archive[0].completedOn)));
    await expect(page.getByText('A little errand', { exact: true })).toHaveCount(0);
    await snapshot(page, `${label}-archive`);
    await page.getByRole('button', { name: table['archive.show'] }).click();
    await expect(page.getByText('A little errand', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: table['archive.back'] }).click();
    await page.getByRole('button', { name: table['keep.button'], exact: true }).click();
    await snapshot(page, `${label}-export`);
    await page.getByRole('button', { name: table['keep.no'], exact: true }).click();
    await page.getByLabel(table['create.label']).fill('A gentle goodbye');
    await page.getByRole('button', { name: table['create.submit'] }).click();
    await page.locator('[data-ghost]').dispatchEvent('click');
    await card.getByRole('button', { name: table['moveOut.button'] }).click();
    await snapshot(page, `${label}-goodbye`);
    await page.getByRole('button', { name: table['moveOut.no'], exact: true }).click();
    expect(errors).toEqual([]);
  });

  test(`${label}：恢复界面、重新开始确认与满员提示的文案与排版`, async ({ page, browser }) => {
    await page.setViewportSize({ width, height: width === 320 ? 812 : 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await probe(page, '{ smudged notebook');
    await page.goto('/');
    await selected(page, lang).click();
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await snapshot(page, `${label}-recovery`);
    await page.getByRole('button', { name: table['recovery.fresh.button'] }).click();
    await snapshot(page, `${label}-fresh-confirm`);
    expect(await writes(page)).toEqual([]);
    // 满员场景另建隔离页和合法夹具，不动本页的旧本子。
    const fullContext = await browser.newContext({ reducedMotion: 'reduce' });
    const fullPage = await fullContext.newPage();
    await fullPage.setViewportSize({ width, height: width === 320 ? 812 : 900 });
    const state = emptyState();
    state.settings.lang = lang;
    state.house.grownFloors = 6;
    state.tasks = Array.from({ length: 10 }, (_, i) => ({ id: `resident-${i}`, ghostNo: i + 1, title: `Gentle errand ${i + 1}`,
      criteria: '', steps: [], slot: { floor: (2 + Math.floor(i / 2)) as 2 | 3 | 4 | 5 | 6, slot: (i % 2) as 0 | 1 }, createdAt: '2026-11-09T08:00:00.000Z' }));
    state.nextGhostNo = 11;
    await fullPage.addInitScript((raw) => localStorage.setItem('ub:save', raw), serializeSave(state));
    await ready(fullPage);
    await fullPage.getByLabel(table['create.label']).fill('Waiting with a suitcase');
    await fullPage.getByRole('button', { name: table['create.submit'] }).click();
    await expect(fullPage.locator('#full-house-text')).toHaveText(table['create.error.houseFull']);
    await snapshot(fullPage, `${label}-full-house`);
    await fullPage.getByRole('button', { name: table['fullHouse.later'] }).click();
    await expect(fullPage.getByLabel(table['create.label'])).toHaveValue('Waiting with a suitcase');
    await fullContext.close();
  });
}
