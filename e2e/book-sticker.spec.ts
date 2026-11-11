import { expect, test, type Browser, type Page } from '@playwright/test';
import { REVEAL_ORDER } from '../src/house/reveal';
import { create, ready } from './helpers/app';
import { evidenceShot } from './helpers/evidence';
import { blockLuma, decodePngBuffer, luma, pixelAt } from './helpers/pixels';
import { NATURAL_NOTES, saveWithArchive, saveWithNaturalArchive, seedSave } from './helpers/save';

// Visual repair checks for the memorial book: the 4x3 reveal is a tilted pasted sticker across both pages, the gutter
// lies behind content (never over the seal grid), and the lantern glow is a feathered halo. Every check measures real
// geometry or real pixels from disposable synthetic contexts. Human visual approval is separate.

async function openBook(browser: Browser, width: number, lang: 'en' | 'zh-CN', count: number, extra: { deviceScaleFactor?: number } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width === 320 ? 812 : 900 }, reducedMotion: 'reduce', ...extra });
  const page = await context.newPage();
  await seedSave(page, saveWithNaturalArchive(count, lang));
  await page.goto('/#/archive');
  await expect(page.locator('.reveal-picture')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  return { context, page };
}

const shotPixels = async (page: Page) => decodePngBuffer(await page.screenshot({ fullPage: true }));

/** Bounding box in page coordinates (what a full-page screenshot uses). */
const pageBox = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
  });

for (const width of [1280, 320]) for (const lang of ['en', 'zh-CN'] as const) for (const count of [0, 5, 12]) {
  test(`${width} ${lang} count ${count}: tilted opaque sticker spans both pages and hides the gutter; seal grid has none`, async ({ browser }) => {
    const { context, page } = await openBook(browser, width, lang, count);
    const book = await pageBox(page, '.book');
    const center = book.x + book.width / 2;

    // Geometry: a slight tilt, wide enough to span both open pages, with a paper shadow, opaque paper and a curl.
    const angle = await page.locator('.sticker-wrap').evaluate((el) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return (Math.atan2(m.b, m.a) * 180) / Math.PI;
    });
    expect(angle).toBeLessThan(-0.6);
    expect(angle).toBeGreaterThan(-2.5);
    const bed = await pageBox(page, '.sticker-bed');
    const sticker = await pageBox(page, '.reveal-sticker');
    expect(bed.width / book.width).toBeGreaterThan(0.85);
    expect(sticker.x).toBeGreaterThan(book.x);
    expect(sticker.x + sticker.width).toBeLessThan(book.x + book.width);
    expect(sticker.x).toBeLessThan(center - book.width * 0.3);
    expect(sticker.x + sticker.width).toBeGreaterThan(center + book.width * 0.3);
    const paper = await page.locator('.reveal-sticker').evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, clip: s.clipPath };
    });
    expect(paper.bg).toBe('rgb(255, 250, 235)');
    expect(paper.clip).toMatch(/^polygon\(/);
    expect(paper.clip.split(',').length).toBe(5);
    expect(await page.locator('.sticker-wrap').evaluate((el) => (getComputedStyle(el).filter.match(/drop-shadow/g) ?? []).length)).toBe(2);
    // The curl sits in the cut bottom-right corner (layout coordinates, so the tilt does not disturb the check).
    const curl = await page.locator('.sticker-curl').evaluate((el) => {
      const s = getComputedStyle(el);
      return { position: s.position, right: s.right, bottom: s.bottom, width: s.width, height: s.height };
    });
    expect(curl).toEqual({ position: 'absolute', right: '0px', bottom: '0px', width: '30px', height: '30px' });

    // Structure: the collection grid and the sticker are outside the spread that owns the gutter.
    expect(await page.locator('.book-spread .collection-page, .book-spread .sticker-bed').count()).toBe(0);
    expect(await page.locator('.book-spread').evaluate((el) => getComputedStyle(el, '::before').backgroundImage)).toContain('linear-gradient');

    // Pixels. The gutter is visible where it should be (cover band) ...
    const img = await shotPixels(page);
    const cover = await pageBox(page, '.book-cover');
    const coverY = cover.y + 6;
    const spineLuma = luma(pixelAt(img, center, coverY));
    const sideLuma = (luma(pixelAt(img, center - 60, coverY)) + luma(pixelAt(img, center + 60, coverY))) / 2;
    expect(sideLuma - spineLuma).toBeGreaterThan(15);

    // ... absent on the plain collection page ...
    const plain = await pageBox(page, '.book-plain');
    const plainY = plain.y + plain.height - 6;
    // Block averages (two stripe periods tall), not single pixels: the page texture makes one pixel depend on y-phase.
    for (const dx of [-60, 60]) expect(Math.abs(blockLuma(img, center, plainY) - blockLuma(img, center + dx, plainY))).toBeLessThan(2.5);

    // ... and hidden by the opaque sticker paper where it crosses: sample the paper margin along the tilted top edge
    // at the gutter's own screen x, and 55px to either side.
    const row = await page.locator('.reveal-picture').evaluate((svg, gutterX) => {
      const m = (svg as unknown as SVGSVGElement).getScreenCTM()!;
      const y = -3.5 / m.a;
      const onBand = new DOMPoint(200, y).matrixTransform(m);
      const x0 = new DOMPoint(gutterX - scrollX, onBand.y).matrixTransform(m.inverse()).x;
      const at = (dx: number) => {
        const q = new DOMPoint(x0 + dx / m.a, y).matrixTransform(m);
        return [q.x + scrollX, q.y + scrollY] as [number, number];
      };
      return { left: at(-55), here: at(0), right: at(55) };
    }, center);
    expect(Math.abs(row.here[0] - center)).toBeLessThan(1);
    const here = luma(pixelAt(img, ...row.here));
    expect(here).toBeGreaterThan(240);
    expect(Math.abs(here - luma(pixelAt(img, ...row.left)))).toBeLessThan(2.5);
    expect(Math.abs(here - luma(pixelAt(img, ...row.right)))).toBeLessThan(2.5);

    // The complete ghost portrait stays inside the picture, with all accessories.
    const inside = await page.locator('.reveal-picture').evaluate((svg) => {
      const frame = svg.getBoundingClientRect();
      const parts = ['.ghost-outline', '.lantern-crown', '.carried-lantern', '.ghost-hand-right', '.ghost-hand-left', '.ghost-eyes'];
      return parts.map((selector) => {
        const el = svg.querySelector(selector);
        const r = el?.getBoundingClientRect();
        return { selector, found: !!r, inside: !!r && r.left >= frame.left && r.right <= frame.right && r.top >= frame.top && r.bottom <= frame.bottom };
      });
    });
    expect(inside.every((p) => p.found && p.inside)).toBe(true);
    expect(await page.locator('.mist-tile').count()).toBe(12);
    expect(await page.locator('.mist-tile[data-open="true"]').evaluateAll((tiles) => tiles.map((t) => Number(t.getAttribute('data-cell'))).sort((a, b) => a - b)))
      .toEqual(REVEAL_ORDER.slice(0, count).sort((a, b) => a - b));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    // Presentation images use natural notes in the matching language.
    if (count > 0) {
      const memos = await page.locator('.archive-memo').allTextContents();
      expect(memos.length).toBeGreaterThan(0);
      for (const memo of memos) expect(NATURAL_NOTES[lang] as readonly string[]).toContain(memo);
    }
    expect(await page.content()).not.toContain('&lt;b&gt;');
    if ([0, 5, 12].includes(count)) await evidenceShot(page, 'presentation', `${width}-${lang}-book-${count}`);
    await context.close();
  });
}

/** Contribution of the halo to each device pixel along a horizontal ray from the lamp centre, measured by diffing screenshots. */
async function haloProfile(page: Page, scope: string) {
  const halo = page.locator(`${scope} .lantern-halo`);
  await halo.scrollIntoViewIfNeeded();
  const box = await halo.evaluate((el) => {
    const r = el.getBoundingClientRect();
    // Start 14 sprite units from the flame, just outside the lamp body, and use the element's own screen scale.
    return { cx: r.left + r.width / 2 + scrollX, cy: r.top + r.height / 2 + scrollY, rx: r.width / 2, edge: 14 * (el as unknown as SVGGraphicsElement).getScreenCTM()!.a };
  });
  const dsf = await page.evaluate(() => devicePixelRatio);
  const clip = { x: box.cx, y: box.cy - 2, width: box.rx + 8, height: 4 };
  const withHalo = decodePngBuffer(await page.screenshot({ clip, fullPage: true }));
  await halo.evaluate((el) => (el.style.visibility = 'hidden'));
  const without = decodePngBuffer(await page.screenshot({ clip, fullPage: true }));
  await halo.evaluate((el) => (el.style.visibility = ''));
  const y = Math.round(withHalo.height / 2);
  const start = Math.round(box.edge * dsf);
  const contribution: number[] = [];
  const warm: number[][] = [];
  for (let x = start; x < withHalo.width; x++) {
    contribution.push(luma(pixelAt(withHalo, x, y)) - luma(pixelAt(without, x, y)));
    const a = pixelAt(withHalo, x, y);
    const b = pixelAt(without, x, y);
    warm.push([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
  }
  return { contribution, warm, dsf, radiusPx: box.rx };
}

function expectFeathered(p: { contribution: number[]; warm: number[][]; dsf: number }) {
  const c = p.contribution;
  expect(c.length).toBeGreaterThan(4 * p.dsf);
  // Visible near the flame, gone at the outer edge, and no hard step anywhere in between.
  expect(Math.max(...c.slice(0, 6))).toBeGreaterThan(4);
  expect(Math.abs(c[c.length - 1]!)).toBeLessThan(1.5);
  const steps = c.slice(1).map((v, i) => Math.abs(v - c[i]!));
  expect(Math.max(...steps)).toBeLessThan(3);
  // Pale warm yellow: red and green are lifted more than blue.
  const first = p.warm.slice(0, 6).reduce((s, w) => [s[0]! + w[0]!, s[1]! + w[1]!, s[2]! + w[2]!], [0, 0, 0]);
  expect(first[0]!).toBeGreaterThan(first[2]!);
  expect(first[1]!).toBeGreaterThan(first[2]!);
}

for (const width of [1280, 320]) {
  test(`${width}: lantern glow is a feathered pale-yellow halo in the reveal portrait`, async ({ browser }) => {
    const { context, page } = await openBook(browser, width, 'en', 12, { deviceScaleFactor: 3 });
    const gradient = await page.locator('.reveal-picture .lantern-halo').evaluate((el) => {
      const id = /url\("?#([^")]+)"?\)/.exec(el.getAttribute('fill') ?? '')?.[1];
      const g = id ? document.getElementById(id) : null;
      return { kind: g?.tagName, stops: [...(g?.querySelectorAll('stop') ?? [])].map((s) => Number(s.getAttribute('stop-opacity'))) };
    });
    expect(gradient.kind).toBe('radialGradient');
    expect(gradient.stops.length).toBeGreaterThanOrEqual(4);
    expect(gradient.stops[gradient.stops.length - 1]).toBe(0);
    expect(gradient.stops).toEqual([...gradient.stops].sort((a, b) => b - a));
    expectFeathered(await haloProfile(page, '.reveal-picture'));
    await context.close();
  });

  test(`${width}: lantern glow is a feathered pale-yellow halo on the resident in the house`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', deviceScaleFactor: 3 });
    const page = await context.newPage();
    await seedSave(page, saveWithArchive(12));
    await ready(page);
    await create(page, 'Lantern resident');
    await expect(page.locator('[data-ghost] .ghost-sprite')).toHaveAttribute('data-kind', 'lantern');
    await page.waitForTimeout(300);
    expectFeathered(await haloProfile(page, '[data-ghost]'));
    await context.close();
  });
}
