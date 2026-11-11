import { expect, test, type Browser, type Page } from '@playwright/test';
import { saveWithArchive, saveWithMemos, seedSave } from './helpers/save';

// The memorial book's compact horizontal entries, the two-line memo clamp with Read more / Show less, and the section
// nav at the top. All data is synthetic; the long text stands in for a long handwritten memo, it is not anyone's save.

const SIZES = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '320x640', width: 320, height: 640 },
] as const;

const NAV = { entries: 'archive-entries-title', stamps: 'collection-title', mist: 'reveal-title' } as const;

async function open(browser: Browser, raw: string, size: { width: number; height: number }, opts: { reducedMotion?: 'reduce' | 'no-preference' } = {}) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, reducedMotion: opts.reducedMotion ?? 'no-preference' });
  const page = await context.newPage();
  await seedSave(page, raw);
  await page.goto('/#/archive');
  await expect(page.locator('.archive .book')).toBeVisible();
  return { context, page };
}

const inView = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= -1 && r.top < innerHeight && r.bottom > 0 && r.left >= -1 && r.right <= innerWidth + 1;
  });

for (const size of SIZES) for (const count of [0, 6, 12, 30]) {
  test(`${size.name} with ${count} entries: the three nav entries are visible at the top and each jumps to its section`, async ({ browser }) => {
    const { context, page } = await open(browser, saveWithArchive(count), size);
    const nav = page.locator('.archive-nav');
    await expect(nav).toBeVisible();
    const buttons = nav.getByRole('button');
    await expect(buttons).toHaveCount(3);
    // Visible in the very first viewport, without scrolling, at a comfortable touch size.
    expect(await page.evaluate(() => scrollY)).toBe(0);
    for (const b of await buttons.all()) {
      expect(await b.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; })).toBe(true);
      const box = (await b.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(await b.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    // The stamp entry shows the real earned count over 12.
    await expect(buttons.nth(0)).toContainText(`(${count})`);
    await expect(buttons.nth(1)).toContainText(`${Math.min(count, 12)}/12`);

    for (const [key, id] of Object.entries(NAV)) {
      await page.evaluate(() => scrollTo(0, 0));
      await nav.locator(`[data-target="${key}"]`).click();
      await expect.poll(() => inView(page, `#${id}`), { message: `${key} heading scrolls into view` }).toBe(true);
      await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe(id);
      expect(page.url()).toMatch(/#\/archive$/);
    }
    await page.reload();
    await expect(page.locator('.archive .book')).toBeVisible();
    expect(page.url()).toMatch(/#\/archive$/);
    await expect(page.locator('.archive-nav .archive-nav-link')).toHaveCount(3);
    await context.close();
  });
}

for (const size of SIZES) {
  test(`${size.name}: with reduced motion the nav jumps at once, and by keyboard (Enter and Space)`, async ({ browser }) => {
    const { context, page } = await open(browser, saveWithArchive(12), size, { reducedMotion: 'reduce' });
    await page.locator('.archive-nav [data-target="mist"]').click();
    // No waiting: an instant jump has already landed on the very next evaluation.
    expect(await inView(page, `#${NAV.mist}`)).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe(NAV.mist);

    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('.archive-nav [data-target="stamps"]').focus();
    await page.keyboard.press('Enter');
    expect(await inView(page, `#${NAV.stamps}`)).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe(NAV.stamps);

    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('.archive-nav [data-target="entries"]').focus();
    await page.keyboard.press('Space');
    expect(await inView(page, `#${NAV.entries}`)).toBe(true);
    expect(page.url()).toMatch(/#\/archive$/);
    await context.close();
  });

  test(`${size.name}: nav keyboard focus is clear but not a thick black box`, async ({ browser }) => {
    const { context, page } = await open(browser, saveWithArchive(3), size);
    await page.keyboard.press('Tab'); // back link
    await page.locator('.archive-nav [data-target="entries"]').focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const ring = await page.locator('.archive-nav [data-target="entries"]').evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), color: s.outlineColor };
    });
    expect(ring.style).toBe('solid');
    expect(ring.width).toBeGreaterThanOrEqual(2);
    expect(ring.width).toBeLessThanOrEqual(3);
    expect(ring.color).not.toBe('rgb(0, 0, 0)');
    await context.close();
  });
}

// ---- memos -------------------------------------------------------------------------------------------------------

const LONG_EN = 'I finally did the thing I kept putting off. It was small. I made tea, then sat with the cat for a long while, feeling light and proud.';
const LONG_ZH = '啊'.repeat(120);
const LONG_WORD = 'a'.repeat(140);
const MULTI = 'one\ntwo\nthree\nfour\nfive';
const UNICODE = 'café ☕ 你好 🌙 𝒳 — “quoted” & <b>not bold</b>';
const SHORT = 'Short and sweet.';

// The save format allows memos up to 140 characters; keep the fixtures inside that.
const MEMOS = [SHORT, '', '   \n  ', 'null', LONG_EN, LONG_ZH, LONG_WORD, MULTI, UNICODE];
const LONG_ONES = [LONG_EN, LONG_ZH, LONG_WORD, MULTI];
const FLAT_ONES = [SHORT, 'null', UNICODE];

const entryWith = (page: Page, memo: string) => page.locator('.archive-entry').filter({ has: page.locator('.archive-memo', { hasText: memo.split('\n')[0]!.slice(0, 20) }) }).first();

for (const lang of ['en', 'zh-CN'] as const) for (const size of SIZES) {
  test(`${lang} ${size.name}: memos clamp to two lines, Read more shows all of the text, Show less goes back, nothing is lost`, async ({ browser }) => {
    const raw = saveWithMemos(MEMOS, lang);
    const { context, page } = await open(browser, raw, size);
    const entries = page.locator('.archive-entry');
    await expect(entries).toHaveCount(MEMOS.length);
    // Blank and empty memos leave no empty paragraph behind.
    expect(await page.locator('.archive-memo').count()).toBe(MEMOS.length - 2);

    const lineBox = (memo: string) => entryWith(page, memo).locator('.archive-memo').evaluate((el) => {
      const s = getComputedStyle(el);
      return { client: el.clientHeight, scroll: el.scrollHeight, line: parseFloat(s.lineHeight), font: parseFloat(s.fontSize), text: el.textContent };
    });

    for (const memo of FLAT_ONES) {
      const e = entryWith(page, memo);
      const m = await lineBox(memo);
      expect(m.text).toBe(memo);
      expect(m.font).toBeGreaterThanOrEqual(16);
      expect(m.client).toBeLessThanOrEqual(m.line * 2 + 1);
      expect(await e.locator('.archive-memo-toggle').count(), `no toggle for ${JSON.stringify(memo)}`).toBe(0);
    }
    // The handwritten word "null" is just a word: shown as written.
    await expect(page.locator('.archive-memo', { hasText: /^null$/ })).toHaveCount(1);

    for (const memo of LONG_ONES) {
      const e = entryWith(page, memo);
      const memoEl = e.locator('.archive-memo');
      const toggle = e.locator('.archive-memo-toggle');
      const before = await lineBox(memo);
      expect(before.text).toBe(memo);
      expect(before.client).toBeLessThanOrEqual(before.line * 2 + 1);
      expect(before.scroll).toBeGreaterThan(before.client + 1);
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      const memoId = await memoEl.getAttribute('id');
      expect(memoId).toBeTruthy();
      await expect(toggle).toHaveAttribute('aria-controls', memoId!);
      expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(toggle).toHaveText(lang === 'en' ? 'Read more' : '展开');

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(toggle).toHaveText(lang === 'en' ? 'Show less' : '收起');
      const open = await lineBox(memo);
      expect(open.text).toBe(memo);
      expect(open.scroll).toBeLessThanOrEqual(open.client + 1); // everything is visible
      expect(open.client).toBeGreaterThan(before.client);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      const after = await lineBox(memo);
      expect(after.client).toBe(before.client);
      expect(after.text).toBe(memo);
    }

    // Display only: the saved memos are untouched.
    const stored = await page.evaluate(() => (JSON.parse(localStorage.getItem('ub:save')!) as { archive: { memo: string }[] }).archive.map((x) => x.memo));
    expect([...stored].sort()).toEqual([...MEMOS].sort());
    await context.close();
  });
}

test('a long memo toggles from the keyboard (Enter and Space) and the page stays on the archive', async ({ browser }) => {
  const { context, page } = await open(browser, saveWithMemos([LONG_EN]), SIZES[1]);
  const toggle = page.locator('.archive-memo-toggle');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(page.url()).toMatch(/#\/archive$/);
  await context.close();
});

test('expanding a memo and showing a title are separate: the title stays private until asked, in both orders', async ({ browser }) => {
  const hiddenTitle = 'ZEBRA-PRIVATE-TITLE';
  const { context, page } = await open(browser, saveWithMemos([LONG_EN], 'en', () => hiddenTitle), SIZES[0]);
  const html = () => page.content();
  const more = page.locator('.archive-memo-toggle');
  const titleToggle = page.locator('.archive-title-toggle:not(.archive-memo-toggle)');

  expect(await html()).not.toContain(hiddenTitle);
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  expect(await html()).not.toContain(hiddenTitle); // expanding the memo never reveals the title
  await expect(titleToggle).toHaveAttribute('aria-pressed', 'false');

  await titleToggle.click();
  await expect(page.locator('.archive-title-line')).toHaveText(hiddenTitle);
  await expect(more).toHaveAttribute('aria-expanded', 'true'); // showing the title keeps the memo open
  await more.click();
  await expect(page.locator('.archive-title-line')).toHaveText(hiddenTitle); // collapsing the memo keeps the title shown

  await titleToggle.click();
  expect(await html()).not.toContain(hiddenTitle);
  await expect(page.locator('.archive-memo')).toHaveText(LONG_EN);
  await context.close();
});

for (const lang of ['en', 'zh-CN'] as const) for (const size of SIZES) {
  test(`${lang} ${size.name}: entries are small horizontal rows (seal left of the text) and long text never scrolls the page sideways`, async ({ browser }) => {
    const { context, page } = await open(browser, saveWithMemos([LONG_WORD, LONG_ZH, SHORT, '', 'null', MULTI, LONG_EN, UNICODE], lang), size);
    for (const e of await page.locator('.archive-entry').all()) {
      const seal = (await e.locator('.archive-seal').boundingBox())!;
      const line = (await e.locator('.archive-line').boundingBox())!;
      expect(seal.width).toBeGreaterThanOrEqual(44);
      expect(seal.width).toBeLessThanOrEqual(52);
      expect(line.x).toBeGreaterThanOrEqual(seal.x + seal.width - 1);
      expect(Math.abs(line.y - seal.y)).toBeLessThan(24); // the date line starts beside the seal, not under it
    }
    const cols = await page.locator('.archive-list').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(size.width === 1280 ? 2 : 1);
    // Open every long memo at once: still no horizontal scrolling.
    for (const t of await page.locator('.archive-memo-toggle').all()) await t.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    for (const b of await page.locator('.archive-entry button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await context.close();
  });
}

test('compact entries: gaps between rows stay small and entries are shorter than before (measured, not promised)', async ({ browser }) => {
  const { context, page } = await open(browser, saveWithMemos(Array.from({ length: 6 }, () => SHORT)), SIZES[0]);
  const boxes = await page.locator('.archive-entry').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left }; }));
  const rowGap = boxes[2]!.top - boxes[0]!.bottom;
  expect(rowGap).toBeGreaterThanOrEqual(8);
  expect(rowGap).toBeLessThanOrEqual(20);
  expect(boxes[1]!.left).toBeGreaterThan(boxes[0]!.left);
  expect(boxes[0]!.bottom - boxes[0]!.top).toBeLessThan(130);
  await context.close();
});
