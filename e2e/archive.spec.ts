import { expect, test } from '@playwright/test';
import { ready } from './helpers/app';
import { saveWithArchive, seedSave } from './helpers/save';

const entries = (page: import('@playwright/test').Page) => page.locator('.archive-entry');
const openBook = async (page: import('@playwright/test').Page) => {
  if (!/#\/archive$/.test(page.url())) await page.locator('.archive-book').click();
  await expect(page).toHaveURL(/#\/archive$/);
  await expect(page.locator('.archive .book')).toBeVisible();
};

test('空书：温暖的话，不催促，没有任何条目', async ({ page }) => {
  await ready(page);
  await openBook(page);
  await expect(page.locator('.archive-empty')).toContainText('waiting, wide open');
  await expect(entries(page)).toHaveCount(0);
  const text = (await page.locator('.archive').innerText()).toLowerCase();
  for (const w of ['hurry', 'overdue', 'late', 'streak', 'failed', 'guilty']) expect(text).not.toContain(w);
});

test('旧书：封面有薄灰，翻开时扬起少量灰尘；一行两列；每格是章加原绘本文案', async ({ page }) => {
  await seedSave(page, saveWithArchive(5));
  await ready(page);
  await openBook(page);
  await expect(page.locator('.book-cover')).toBeVisible();
  const cover = await page.locator('.book-cover').evaluate((el) => getComputedStyle(el, '::after').backgroundImage);
  expect(cover).toContain('gradient'); // 薄灰
  expect(await page.locator('.book-dust .dust').count()).toBeGreaterThanOrEqual(4);
  expect(await page.locator('.book-dust .dust').count()).toBeLessThanOrEqual(8);
  // 灰尘在扬起（有运行中的动画），之后散去
  expect(await page.evaluate(() => document.getAnimations().filter((a) => (a as CSSAnimation).animationName === 'dust-puff').length)).toBeGreaterThan(0);

  await expect(entries(page)).toHaveCount(5);
  const cols = await page.locator('.archive-list').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(cols).toBe(2);
  // 一行两列：前两格同一行，第三格在下一行
  const boxes = await entries(page).evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
  expect(Math.abs(boxes[0]![1]! - boxes[1]![1]!)).toBeLessThan(2);
  expect(boxes[0]![0]!).toBeLessThan(boxes[1]![0]!);
  expect(boxes[2]![1]!).toBeGreaterThan(boxes[0]![3]! - 1);
  for (const e of await entries(page).all()) {
    await expect(e.locator('.archive-seal svg')).toBeVisible();
    await expect(e.locator('.archive-line')).toHaveText(/^A little ghost, complete on \d{4}-\d{2}-\d{2}$/);
    await expect(e).not.toContainText('Steps done');
  }
});

test('按确认时间倒序；最新那枚的章最后落下，其余早已在页上', async ({ page }) => {
  await seedSave(page, saveWithArchive(4));
  await ready(page);
  await openBook(page);
  const dates = await entries(page).locator('.archive-line').allInnerTexts();
  expect(dates[0]).toContain('2026-10-04'); // 最后确认的在最前
  expect(dates[3]).toContain('2026-10-01');
  await expect(entries(page).first()).toHaveAttribute('data-landing', 'true');
  await expect(page.locator('.archive-entry[data-landing]')).toHaveCount(1);
  // 一开始最新的章还没落下，其余的已经是不透明的；之后它才落下
  const op = () => entries(page).evaluateAll((els) => els.map((el) => Number(getComputedStyle(el.querySelector('.stamp-seal')!).opacity)));
  const early = await op();
  expect(early[0]).toBeLessThan(1);
  for (const o of early.slice(1)) expect(o).toBe(1);
  await expect.poll(async () => (await op())[0], { timeout: 4000 }).toBe(1);
});

test('标题：默认不在任何地方出现；逐条显示或隐藏并保存，刷新后保留；隐藏时不泄漏', async ({ page }) => {
  await seedSave(page, saveWithArchive(3));
  await ready(page);
  await openBook(page);
  const html = () => page.evaluate(() => document.documentElement.outerHTML);
  const secret = /Secret task/;
  expect(await html()).not.toMatch(secret); // DOM 文本、aria、alt、title 全在里面
  expect(await page.title()).not.toMatch(secret);
  expect(page.url()).not.toMatch(secret);
  // 显示第二条（倒序后是 Secret task 1）
  await entries(page).nth(1).getByRole('button', { name: 'Show the title' }).click();
  await expect(entries(page).nth(1)).toContainText('Secret task 1');
  await expect(entries(page).nth(0)).not.toContainText('Secret task');
  expect((await html()).match(/Secret task/g)).toHaveLength(1);
  // 写进存档
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ub:save')!).archive.filter((e: { titleVisible: boolean }) => e.titleVisible).length)).toBe(1);
  await page.reload();
  await openBook(page);
  await expect(entries(page).nth(1)).toContainText('Secret task 1');
  await expect(entries(page).nth(0)).not.toContainText('Secret task');
  // 再次隐藏：全部消失，也不留在 aria 或属性里
  await entries(page).nth(1).getByRole('button', { name: 'Hide the title' }).click();
  expect(await html()).not.toMatch(secret);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ub:save')!).archive.every((e: { titleVisible: boolean }) => !e.titleVisible))).toBe(true);
  await page.reload();
  await openBook(page);
  expect(await html()).not.toMatch(secret);
  expect(page.url()).toMatch(/#\/archive$/);
});

test('留言作为纯文本显示，不解释 HTML', async ({ page }) => {
  await seedSave(page, saveWithArchive(2));
  await ready(page);
  await openBook(page);
  await expect(entries(page).first().locator('.archive-memo')).toHaveText('The last <b>one</b> & dear');
  expect(await entries(page).first().locator('.archive-memo b').count()).toBe(0);
});

test('320 宽：单列横排条目，章与字清楚，没有水平滚动，条目多时在页面里纵向滚动', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await seedSave(page, saveWithArchive(20));
  await ready(page);
  await openBook(page);
  expect(await page.locator('.archive-list').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const first = (await entries(page).first().boundingBox())!;
  expect(first.width).toBeGreaterThan(240);
  const seal = (await entries(page).first().locator('.archive-seal').boundingBox())!;
  expect(seal.width).toBeGreaterThanOrEqual(44);
  // Horizontal entry: the text sits to the right of the seal, not under it, and has room to read.
  const line = (await entries(page).first().locator('.archive-line').boundingBox())!;
  expect(line.x).toBeGreaterThanOrEqual(seal.x + seal.width - 1);
  expect(line.width).toBeGreaterThan(150);
  const size = await entries(page).first().locator('.archive-line').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
  for (const b of await entries(page).first().getByRole('button').all()) {
    const r = (await b.boundingBox())!;
    expect(r.height).toBeGreaterThanOrEqual(44);
  }
  expect((await page.evaluate(() => document.documentElement.scrollHeight)) > 640).toBe(true);
});

test('减少动态：不扬灰，章直接在页上', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await seedSave(page, saveWithArchive(3));
  await ready(page);
  await openBook(page);
  expect(await page.locator('.book-dust .dust').evaluateAll((els) => els.map((el) => getComputedStyle(el).display))).toEqual(Array(6).fill('none'));
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  for (const e of await entries(page).all()) {
    expect(await e.locator('.stamp-seal').evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
  }
  await context.close();
});
