import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { REVEAL_ORDER } from '../src/house/reveal';
import { ghostOutlinePath } from '../src/house/ghostShape';
import { en } from '../src/i18n/en';
import { zhCN } from '../src/i18n/zh-CN';
import { ready, create, openGhost, card, setCriteria, addStep } from './helpers/app';
import { seedSave, saveWithArchive } from './helpers/save';

// Playwright creates a disposable context for each test. Never attach a personal profile.
const directory = `artifacts/collection/screenshots/${process.env.COLLECTION_ARTIFACT_RUN ?? `run-${Date.now()}`}`;
async function shot(page: Page, name: string) {
  await mkdir(directory, { recursive: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('ub:save')!));

async function book(page: Page) {
  await page.goto('/#/archive');
  await expect(page.locator('.collection-grid li')).toHaveCount(12);
}

/** Check the eyes' real screen rectangles against the actual opaque tile rectangles. */
async function faceCover(page: Page) {
  return page.locator('.reveal-picture').evaluate((svg) => {
    const tiles = [...svg.querySelectorAll('.mist-tile')].map((tile) => ({
      cell: Number(tile.getAttribute('data-cell')),
      open: tile.getAttribute('data-open') === 'true',
      opacity: Number(getComputedStyle(tile).opacity),
      fill: getComputedStyle(tile.querySelector('rect')!).fill,
      r: tile.querySelector('rect')!.getBoundingClientRect(),
    }));
    return [...svg.querySelectorAll('.ghost-eyes ellipse')].map((eye) => {
      const r = eye.getBoundingClientRect();
      const tile = tiles.find((t) => r.left > t.r.left && r.right < t.r.right && r.top > t.r.top && r.bottom < t.r.bottom);
      return { cell: tile?.cell, covered: !!tile && !tile.open && tile.opacity === 1 && tile.fill === 'rgb(217, 212, 201)', bounds: [r.x, r.y, r.width, r.height] };
    });
  });
}

for (const width of [1280, 320]) for (const lang of ['en', 'zh-CN'] as const) {
  test(`${width} ${lang}: old saves unlock twelve distinct stamps, real face cells stay last, original screenshots`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: width === 320 ? 812 : 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    // Independent origins are not needed: all writes here belong to this disposable context.
    await seedSave(page, saveWithArchive(0));
    for (const count of [0, 5, 10, 11, 12, 13]) {
      await ready(page);
      const state = JSON.parse(saveWithArchive(count)); state.settings.lang = lang;
      await page.evaluate((s) => localStorage.setItem('ub:save', JSON.stringify(s)), state);
      await page.reload();
      await book(page);
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await expect(page.locator('.archive-entry')).toHaveCount(count);
      await expect(page.locator('.collection-grid [data-unlocked="true"]')).toHaveCount(Math.min(count, 12));
      await expect(page.locator('.mist-tile[data-open="true"]')).toHaveCount(Math.min(count, 12));
      expect(await page.locator('.mist-tile[data-open="true"]').evaluateAll((tiles) => tiles.map((t) => Number(t.getAttribute('data-cell'))).sort((a, b) => a - b)))
        .toEqual(REVEAL_ORDER.slice(0, Math.min(count, 12)).sort((a, b) => a - b));
      const face = await faceCover(page);
      expect(face.map((e) => e.cell)).toEqual([5, 6]);
      expect(face.map((e) => e.covered)).toEqual(count <= 10 ? [true, true] : count === 11 ? [false, true] : [false, false]);
      expect(await page.locator('.collection-grid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(4);
      expect(await page.locator('.reveal-picture').evaluate((el) => el.getBoundingClientRect().width / el.getBoundingClientRect().height)).toBeCloseTo(4 / 3, 1);
      expect(await page.content()).not.toContain('Secret task');
      expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
      const paths = await page.locator('.collection-grid .stamp-object').evaluateAll((els) => els.map((el) => el.getAttribute('d')));
      expect(new Set(paths).size).toBe(12);
      if ([0, 10, 11, 12, 13].includes(count)) {
        await shot(page, `${width}-${lang}-book-${count}`);
        await page.locator('.reveal-picture').screenshot({ path: `${directory}/${width}-${lang}-reveal-${count}.png` });
      }
    }
    await context.close();
  });
}

test('guarantee survives refresh; invalid input and storage rejection do not spend it; successful creation is saved before refresh', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedSave(page, saveWithArchive(12));
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if ((window as any).__rejectWelcome && k === 'ub:save' && JSON.parse(v).tasks.length > 0) throw new DOMException('test quota', 'QuotaExceededError');
      return original.call(this, k, v);
    };
    Math.random = () => .99;
  });
  await ready(page);
  const original = await saved(page);
  await page.reload();
  await page.getByRole('button', { name: en['create.submit'], exact: true }).click();
  expect(await saved(page)).toEqual(original);
  await page.evaluate(() => { (window as any).__rejectWelcome = true; });
  await create(page, 'Private welcome');
  await expect(page.locator('.create-error')).toHaveText(en['create.error.save']);
  await expect(page.getByLabel(en['create.label'])).toHaveValue('Private welcome');
  await expect(page.locator('[data-ghost]')).toHaveCount(0);
  expect(await saved(page)).toEqual(original);
  await page.evaluate(() => { (window as any).__rejectWelcome = false; });
  await page.getByRole('button', { name: en['create.submit'], exact: true }).click();
  const committed = await saved(page);
  expect(committed.collection).toEqual({ lanternWelcomed: true });
  expect(committed.tasks[0].ghostKind).toBe('lantern');
  expect(committed.archive).toEqual(original.archive);
  await expect(page.locator('.warm-lamps')).toHaveAttribute('data-welcoming', 'true');
  await expect(page.locator('.warm-lamp')).toHaveCount(12);
  expect(committed.house.completedCount).toBe(12);
  await page.reload();
  await expect(page.locator('[data-ghost] .ghost-sprite')).toHaveAttribute('data-kind', 'lantern');
  await expect(page.locator('.warm-lamps')).toHaveAttribute('data-welcoming', 'false');
  expect(await saved(page)).toEqual(committed);
  await create(page, 'Ordinary after guarantee');
  expect((await saved(page)).tasks.map((t: any) => t.ghostKind)).toEqual(['lantern', 'ordinary']);
});

test('full legacy house keeps the guarantee; existing residents keep ordinary identity', async ({ page }) => {
  const state = JSON.parse(saveWithArchive(12));
  state.tasks = Array.from({ length: 10 }, (_, i) => ({ id: `old-${i}`, ghostNo: i + 1, title: 'Existing', criteria: '', steps: [], slot: { floor: 2 + Math.floor(i / 2), slot: i % 2 }, createdAt: '2026-11-09T00:00:00.000Z' }));
  state.house.grownFloors = 6; state.nextGhostNo = 11;
  await seedSave(page, JSON.stringify(state));
  await ready(page);
  await create(page, 'Waiting');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await saved(page)).toEqual(state);
  await expect(page.locator('[data-ghost] .ghost-sprite[data-kind="ordinary"]')).toHaveCount(10);
});

for (const width of [1280, 320]) for (const lang of ['en', 'zh-CN'] as const) {
  test(`${width} ${lang}: lantern identity, full body, props, state semantics and 13th real confirmation`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const state = JSON.parse(saveWithArchive(12)); state.settings.lang = lang;
    const t = lang === 'en' ? en : zhCN;
    await seedSave(page, JSON.stringify(state));
    await ready(page);
    await page.getByLabel(t['create.label']).fill('A private title');
    await page.getByRole('button', { name: t['create.submit'], exact: true }).click();
    const ghost = page.locator('[data-ghost]');
    await expect(ghost).toHaveAttribute('data-state', 'gray');
    await expect(ghost).toHaveAccessibleName(new RegExp(t['collection.resident']));
    await expect(ghost.locator('.ghost-body')).toHaveAttribute('fill', '#F4813B');
    await expect(ghost.locator('.ghost-body')).toHaveAttribute('stroke', '#FFFFFF');
    expect(await ghost.locator('.ghost-eyes ellipse').first().evaluate((el) => getComputedStyle(el).fill)).toBe('rgb(255, 255, 255)');
    await expect(ghost.locator('.lantern-crown')).toHaveCount(1);
    await expect(ghost.locator('.ghost-wisp')).toHaveCount(0);
    await expect(ghost.locator('.ghost-hand-right .carried-lantern')).toHaveCount(1);
    expect(await ghost.locator('.ghost-outline').getAttribute('d')).toBe(ghostOutlinePath(0));
    await expect(ghost.locator('.ghost-outline')).toHaveCount(1);
    await shot(page, `${width}-${lang}-lantern-home`);
    if (width === 1280 && lang === 'en') {
      const original = await ghost.locator('.ghost-sprite').evaluate((el) => {
        const svg = el.cloneNode(true) as SVGSVGElement;
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('width', '560'); svg.setAttribute('height', '720');
        return svg.outerHTML;
      });
      await writeFile(`${directory}/lantern-ghost-original.svg`, original);
    }
    await openGhost(ghost);
    const detail = page.getByRole('complementary', { name: t['card.label'] });
    await expect(detail.locator('.card-state')).toContainText(t['state.gray']);
    await detail.getByLabel(t['criteria.label']).fill('Done');
    await detail.getByRole('button', { name: t['criteria.save'], exact: true }).click();
    await detail.getByLabel(t['steps.add.label']).fill('One step');
    await detail.getByRole('button', { name: t['steps.add.submit'], exact: true }).click();
    await expect(ghost).toHaveAttribute('data-state', 'white');
    await detail.getByRole('checkbox').check();
    await expect(ghost).toHaveAttribute('data-state', 'green');
    await expect(detail.locator('.card-state')).toContainText(t['state.pending']);
    expect((await saved(page)).archive).toHaveLength(12);
    await expect(ghost.locator('.ghost-body')).toHaveAttribute('fill', '#F4813B');
    await shot(page, `${width}-${lang}-lantern-pending`);
    await detail.getByRole('checkbox').uncheck();
    await expect(ghost).toHaveAttribute('data-state', 'white');
    await expect(detail.getByRole('button', { name: t['confirm.button'], exact: true })).toHaveCount(0);
    await detail.getByRole('checkbox').check();
    await detail.getByRole('button', { name: t['confirm.button'], exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: t['confirm.yes'], exact: true }).click();
    await page.getByRole('button', { name: t['celebrate.skip'] }).click();
    expect((await saved(page)).archive).toHaveLength(13);
    expect((await saved(page)).archive.at(-1).ghostKind).toBe('lantern');
    await expect(page.locator('.warm-lamp')).toHaveCount(12);
    await book(page);
    expect(await page.content()).not.toContain('A private title');
    await expect(page.locator('.archive-entry')).toHaveCount(13);
    await expect(page.locator('.archive-entry').first().locator('.stamp-seal')).toHaveAttribute('data-stamp', 'envelope');
  });
}

test('post-guarantee controlled random chooses below .05 and preserves identity through reload', async ({ page }) => {
  const state = JSON.parse(saveWithArchive(12)); state.collection = { lanternWelcomed: true };
  await seedSave(page, JSON.stringify(state));
  await page.addInitScript(() => { Math.random = () => .049999; });
  await ready(page);
  await create(page, 'Chance lantern');
  const resident = (await saved(page)).tasks[0];
  expect(resident.ghostKind).toBe('lantern');
  await page.reload();
  expect((await saved(page)).tasks[0]).toEqual(resident);
});

test('normal-motion welcome pulses only acquired lamps and ends without changing counts', async ({ page }) => {
  await seedSave(page, saveWithArchive(12));
  await ready(page);
  await create(page, 'Lantern');
  await expect(page.locator('.warm-lamps')).toHaveAttribute('data-welcoming', 'true');
  expect(await page.locator('.warm-lamp').first().evaluate((el) => getComputedStyle(el).animationName)).toBe('lantern-welcome');
  await expect(page.locator('.warm-lamps')).toHaveAttribute('data-welcoming', 'false', { timeout: 4000 });
  expect((await saved(page)).house.completedCount).toBe(12);
  await expect(page.locator('.warm-lamp')).toHaveCount(12);
  await book(page);
  await expect(page.locator('.mist-tile').first()).toHaveCSS('transition-duration', '0.65s');
});

test('closing and reopening the tab retains both the unspent guarantee and committed identity', async ({ page, context }) => {
  await seedSave(page, saveWithArchive(12));
  await ready(page);
  await page.close();
  const reopened = await context.newPage();
  await ready(reopened);
  expect((await saved(reopened)).collection).toBeUndefined();
  await create(reopened, 'First lantern');
  const state = await saved(reopened);
  await reopened.close();
  const again = await context.newPage();
  await ready(again);
  expect(await saved(again)).toEqual(state);
  await expect(again.locator('[data-ghost] .ghost-sprite')).toHaveAttribute('data-kind', 'lantern');
});

test('a real unlocked collection is absent in the sample, and returning preserves the guarantee', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedSave(page, saveWithArchive(12));
  await ready(page);
  const original = await saved(page);
  await page.getByRole('button', { name: en['demo.try'], exact: true }).click();
  await page.locator('.archive-book').click();
  await expect(page.locator('.collection-grid [data-unlocked="true"]')).toHaveCount(0);
  await expect(page.locator('.mist-tile[data-open="true"]')).toHaveCount(0);
  await shot(page, 'sample-isolated-book');
  expect(await saved(page)).toEqual(original);
  await page.getByRole('button', { name: en['demo.exit'], exact: true }).click();
  expect(await saved(page)).toEqual(original);
  await create(page, 'Real guarantee');
  expect((await saved(page)).tasks[0].ghostKind).toBe('lantern');
});

for (const mode of ['recovery', 'unavailable'] as const) {
  test(`${mode}: the whole collection and lantern run in memory with zero writes`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 812 });
    const raw = '{ illegible test page';
    await page.addInitScript(({ mode, raw }) => {
      const original = Storage.prototype.setItem;
      if (mode === 'recovery') original.call(localStorage, 'ub:save', raw);
      (window as any).__collectionWrites = [];
      Storage.prototype.setItem = function (key, value) {
        (window as any).__collectionWrites.push(key);
        return original.call(this, key, value);
      };
      if (mode === 'unavailable') Storage.prototype.getItem = function () { throw new DOMException('test unavailable', 'SecurityError'); };
    }, { mode, raw });
    await ready(page);
    if (mode === 'recovery') await page.getByRole('button', { name: en['recovery.blank.button'], exact: true }).click();
    for (let i = 0; i < 12; i++) {
      await create(page, 'Memory task');
      await openGhost(page.locator('[data-ghost]'));
      await setCriteria(page, 'Done'); await addStep(page, 'Step');
      await card(page).getByRole('checkbox').check();
      await card(page).getByRole('button', { name: en['confirm.button'], exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: en['confirm.yes'], exact: true }).click();
      await page.getByRole('button', { name: en['celebrate.skip'], exact: true }).click();
    }
    await create(page, 'Memory lantern');
    await expect(page.locator('[data-ghost] .ghost-sprite')).toHaveAttribute('data-kind', 'lantern');
    await page.locator('.archive-book').click();
    await expect(page.locator('.archive-entry')).toHaveCount(12);
    await expect(page.locator('.mist-tile[data-open="true"]')).toHaveCount(12);
    await shot(page, `${mode}-memory-book`);
    expect(await page.evaluate(() => (window as any).__collectionWrites)).toEqual([]);
    if (mode === 'recovery') expect(await page.evaluate(() => localStorage.getItem('ub:save'))).toBe(raw);
  });
}
