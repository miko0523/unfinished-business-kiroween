import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { forLanguage } from '../src/i18n/t';
import { en } from '../src/i18n/en';
import { zhCN } from '../src/i18n/zh-CN';
import { ready, create } from './helpers/app';
import { evidenceDir } from './helpers/evidence';
import { decodePngBuffer, pixelAt } from './helpers/pixels';
import { saveWithArchive, seedSave } from './helpers/save';

// Phase 14.1: keyboard, focus and semantic landmarks.
// These are automated accessibility-tree and behaviour checks in Chromium. They are NOT a human screen-reader or
// audio acceptance: nothing here is spoken aloud, and no physical device or assistive technology was used.

const LANGS = ['en', 'zh-CN'] as const;
type Lang = (typeof LANGS)[number];
const copy = (lang: Lang) => (lang === 'en' ? en : zhCN);

async function seedLang(page: Page, lang: Lang, archived = 0) {
  const state = JSON.parse(saveWithArchive(archived));
  state.settings.lang = lang;
  await seedSave(page, JSON.stringify(state));
}

/** Count real pointer presses so the keyboard-only claim is checked, not assumed. */
async function countPointerPresses(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __pointer: number }).__pointer = 0;
    for (const type of ['pointerdown', 'mousedown', 'touchstart']) addEventListener(type, () => ((window as unknown as { __pointer: number }).__pointer += 1), true);
  });
}
const pointerPresses = (page: Page) => page.evaluate(() => (window as unknown as { __pointer: number }).__pointer);

const active = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    if (!a) return { tag: 'none', id: '', cls: '', name: '', floor: null as string | null, slot: null as string | null, inDialog: false };
    return {
      tag: a.tagName,
      id: a.id,
      cls: typeof a.className === 'string' ? a.className : '',
      name: a.getAttribute('aria-label') ?? (a.textContent ?? '').trim().slice(0, 50),
      floor: a.getAttribute('data-floor'),
      slot: a.getAttribute('data-slot'),
      inDialog: !!a.closest('dialog[open]'),
    };
  });
const matches = (page: Page, selector: string) => page.evaluate((s) => !!document.activeElement?.matches(s), selector);

/** Press Tab (or Shift+Tab) until the focused element matches; returns every stop passed on the way. */
async function tabTo(page: Page, selector: string, opts: { max?: number; back?: boolean } = {}) {
  const stops: Awaited<ReturnType<typeof active>>[] = [];
  for (let i = 0; i < (opts.max ?? 60); i++) {
    await page.keyboard.press(opts.back ? 'Shift+Tab' : 'Tab');
    stops.push(await active(page));
    if (await matches(page, selector)) return stops;
  }
  throw new Error(`Tab never reached ${selector}; saw ${JSON.stringify(stops.map((s) => s.cls || s.tag))}`);
}

/** Every Tab stop from the start of the document to the end (stops when focus leaves the page or wraps). */
async function allTabStops(page: Page) {
  // Reset the sequential-focus starting point to the top of the document, like a fresh page visit.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute('tabindex');
    window.scrollTo(0, 0);
  });
  const stops: Awaited<ReturnType<typeof active>>[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    const stop = await active(page);
    const key = JSON.stringify(stop);
    if (stop.tag === 'BODY' || seen.has(key)) break;
    seen.add(key);
    stops.push(stop);
  }
  return stops;
}

const status = (page: Page) => page.getByRole('status');

for (const lang of LANGS) {
  test(`${lang}: the whole flow works with the keyboard alone (create, clarify, check, undo, confirm, farewell, archive)`, async ({ page }) => {
    const t = forLanguage(lang);
    const c = copy(lang);
    await countPointerPresses(page);
    await seedLang(page, lang);
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);

    // Create: Tab to the field, type, Enter.
    await tabTo(page, '#create-title');
    await page.keyboard.type('Plan the garden');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-ghost]')).toHaveCount(1);
    await expect(status(page)).toHaveText(t('create.movedIn'));

    // Open the card from the ghost button; focus moves to the card heading.
    await tabTo(page, '[data-ghost]');
    await page.keyboard.press('Enter');
    await expect(page.locator('.task-card h2')).toBeFocused();

    // Clarify: criteria, then a step.
    await tabTo(page, '#criteria');
    await page.keyboard.type('The beds are weeded');
    await tabTo(page, '.criteria button[type="submit"]', { max: 4 });
    await page.keyboard.press('Enter');
    await expect(page.locator('.criteria-text')).toHaveText('The beds are weeded');
    await tabTo(page, '#step-new');
    await page.keyboard.type('Pull the weeds');
    await page.keyboard.press('Enter');
    await expect(page.locator('.step-check span')).toHaveText('Pull the weeds');
    await expect(status(page)).toContainText(t('live.state', { state: t('state.white') }));

    // Check, uncheck (undo) and check again; every change is announced.
    await tabTo(page, '.step-check input');
    await page.keyboard.press('Space');
    await expect(status(page)).toContainText(t('state.pending'));
    await expect(status(page)).toContainText(t('live.progress', { done: 1, total: 1 }));
    await page.keyboard.press('Space');
    await expect(status(page)).toHaveText(t('live.erase', { done: 0, total: 1 }) + ' ' + t('live.state', { state: t('state.white') }));
    await page.keyboard.press('Space');
    await expect(status(page)).toContainText(t('live.state', { state: t('state.pending') }));

    // Pending confirmation: the confirm button opens a dialog; focus goes in, Tab stays in, Escape returns focus.
    await tabTo(page, '.pending-box .primary');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    expect((await active(page)).inDialog).toBe(true);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect((await active(page)).inDialog).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Shift+Tab');
      expect((await active(page)).inDialog).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.pending-box .primary')).toBeFocused();

    // Confirm with a note, then skip the animation with the keyboard.
    await page.keyboard.press('Enter');
    await expect(page.locator('#confirm-memo')).toBeFocused();
    await page.keyboard.type('Weeds are gone');
    await tabTo(page, '.dialog .primary', { max: 4 });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(status(page)).toContainText(t('live.flew'));
    await expect(status(page)).toContainText(t('live.lamp'));
    await tabTo(page, '.skip-animation');
    await page.keyboard.press('Enter');
    await expect(page.locator('.celebration')).toHaveCount(0);
    await expect(status(page)).toHaveText(t('live.farewellDone'));
    // Focus did not fall into the void when the confirm button disappeared.
    expect((await active(page)).tag).not.toBe('BODY');
    await expect(page.locator('.warm-lamp')).toHaveCount(1);

    // The footer entry opens the archive; the heading takes focus; the title toggle works with Space.
    await tabTo(page, '.footer-link');
    await expect(page.locator('.footer-link')).toHaveText(c['lobby.archive']);
    await page.keyboard.press('Enter');
    await expect(page.locator('#archive-title')).toBeFocused();
    await expect(page.locator('.archive-entry')).toHaveCount(1);
    await expect(page.locator('.archive-memo')).toHaveText('Weeds are gone');
    await tabTo(page, '.archive-title-toggle');
    await page.keyboard.press('Space');
    await expect(page.locator('.archive-title-line')).toHaveText('Plan the garden');
    // Two ways back, with different names: the top link ("Back to the house") and the footer link ("Close the Archive").
    await tabTo(page, '.footer-link');
    await expect(page.locator('.footer-link')).toHaveText(c['archive.close']);
    await expect(page.getByRole('link', { name: c['archive.back'] })).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/$/);
    expect(await pointerPresses(page)).toBe(0);
  });
}

for (const lang of LANGS) {
  test(`${lang}: Tab order is header, create form, residents high-to-low and left-to-right, lobby book, card, archive entry`, async ({ page }) => {
    const c = copy(lang);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      const w = window as unknown as { __focusLog: string[] };
      w.__focusLog = [];
      addEventListener('focusin', (e) => {
        const el = e.target as HTMLElement;
        w.__focusLog.push(`${Math.round(performance.now())}:${el.tagName}.${String(el.className).split(' ')[0]}${el.dataset?.floor ? `@${el.dataset.floor}/${el.dataset.slot}` : ''}`);
      }, true);
    });
    await seedLang(page, lang);
    await ready(page);
    for (const name of ['One', 'Two', 'Three', 'Four', 'Five']) {
      await page.locator('#create-title').fill(name);
      await page.locator('#create-title').press('Enter');
    }
    await expect(page.locator('[data-ghost]')).toHaveCount(5);

    // Without a card.
    const plain = await allTabStops(page);
    const kinds = plain.map((s) => (s.cls.includes('ghost-button') ? 'ghost' : s.cls.includes('archive-book') ? 'book' : s.cls.includes('footer-link') ? 'footer' : s.id === 'create-title' ? 'create' : s.cls.includes('keep-copy') ? 'keep' : s.cls.includes('demo-try') ? 'try' : s.tag === 'BUTTON' && s.name === c['language.en'] ? 'lang' : s.tag === 'BUTTON' && s.name === c['language.zh-CN'] ? 'lang' : s.cls.includes('sound-switch') ? 'sound' : s.name === c['create.submit'] ? 'submit' : s.cls));
    expect(kinds).toEqual(['lang', 'lang', 'sound', 'keep', 'try', 'create', 'submit', 'ghost', 'ghost', 'ghost', 'ghost', 'ghost', 'book', 'footer']);
    const ghostStops = plain.filter((s) => s.cls.includes('ghost-button')).map((s) => [Number(s.floor), Number(s.slot)]);
    expect(ghostStops).toEqual([[4, 0], [3, 0], [3, 1], [2, 0], [2, 1]]);

    // Screen positions agree with the tab order: higher floors are higher on screen, left slot is left of right slot.
    const rects = await page.locator('[data-ghost]').evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      return { floor: Number(el.getAttribute('data-floor')), slot: Number(el.getAttribute('data-slot')), cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    }));
    for (const a of rects) for (const b of rects) {
      if (a.floor > b.floor) expect(a.cy).toBeLessThan(b.cy);
      if (a.floor === b.floor && a.slot < b.slot) expect(a.cx).toBeLessThan(b.cx);
    }

    // With a card open, the card comes after the lobby book and before the archive entry.
    await page.locator('[data-ghost]').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.task-card')).toBeVisible();
    // The card moves focus to its heading when it mounts; wait for that so it cannot land in the middle of the tab walk.
    await expect(page.locator('.task-card h2')).toBeFocused();
    const withCard = await allTabStops(page);
    const names = withCard.map((s) => s.cls);
    const bookAt = names.findIndex((n) => n.includes('archive-book'));
    const closeAt = names.findIndex((n) => n.includes('card-close'));
    const footerAt = names.findIndex((n) => n.includes('footer-link'));
    expect(bookAt, `tab stops with card open: ${JSON.stringify(withCard.map((s) => s.cls || s.tag))}; focus log: ${JSON.stringify(await page.evaluate(() => (window as unknown as { __focusLog: string[] }).__focusLog.slice(-30)))}`).toBeGreaterThan(-1);
    expect(closeAt).toBeGreaterThan(bookAt);
    expect(footerAt).toBe(names.length - 1);
    expect(withCard.slice(0, 6).map((s) => s.tag)).not.toContain('ASIDE');

    // One button per ghost: unique accessible names, one tab stop each, nothing focusable inside.
    const semantics = await page.locator('[data-ghost]').evaluateAll((els) => els.map((el) => ({
      tag: el.tagName,
      type: el.getAttribute('type'),
      name: el.getAttribute('aria-label') ?? '',
      pressed: el.getAttribute('aria-pressed'),
      inner: el.querySelectorAll('a[href], button, input, select, textarea, [tabindex]').length,
    })));
    expect(semantics.every((s) => s.tag === 'BUTTON' && s.type === 'button' && s.inner === 0 && (s.pressed === 'true' || s.pressed === 'false'))).toBe(true);
    expect(new Set(semantics.map((s) => s.name)).size).toBe(5);
    expect(await page.locator('[role="button"][data-ghost], [data-ghost] [role="button"]').count()).toBe(0);
    expect(await page.locator('.residents button').count()).toBe(5);
    expect(await page.locator('ul[role="list"] > li.resident-floor').count()).toBe(3);
  });
}

for (const lang of LANGS) {
  test(`${lang}: landmarks, one h1, no skipped heading levels in the house, card, dialog and archive; role snapshot`, async ({ page }) => {
    const c = copy(lang);
    await seedLang(page, lang, 2);
    await ready(page);
    await page.locator('#create-title').fill('Heading check');
    await page.locator('#create-title').press('Enter');
    await expect(page.locator('[data-ghost]')).toHaveCount(1);
    const headings = () => page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => (h as HTMLElement).getClientRects().length > 0 || h.closest('dialog[open]')).map((h) => Number(h.tagName[1])));
    const expectOutline = (levels: number[]) => {
      expect(levels.filter((l) => l === 1)).toHaveLength(1);
      expect(levels[0]).toBe(1);
      levels.forEach((level, i) => { if (i > 0) expect(level - levels[i - 1]!).toBeLessThanOrEqual(1); });
    };
    expectOutline(await headings());

    await page.locator('[data-ghost]').dispatchEvent('click');
    await expect(page.locator('.task-card')).toBeVisible();
    expectOutline(await headings());

    // Landmarks and the role snapshot of the house view.
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('contentinfo')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: c['footer.nav'] })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('complementary', { name: c['card.label'] })).toHaveCount(1);
    const snapshot = await page.locator('body').ariaSnapshot();
    for (const line of ['- banner:', `- heading "${c['app.title']}" [level=1]`, '- main:', '- contentinfo:', `- navigation "${c['footer.nav']}":`, `- complementary "${c['card.label']}":`, `- list "${c['residents.label']}"`, '- status']) {
      expect(snapshot, line).toContain(line);
    }
    await mkdir(`${evidenceDir('measurement')}/aria`, { recursive: true });
    await writeFile(`${evidenceDir('measurement')}/aria/${lang}-house-aria-snapshot.txt`, snapshot);

    // Dialog headings stay in order too (the Keep-a-copy dialog is a level-2 section under the page title).
    await page.getByRole('button', { name: c['keep.button'], exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expectOutline(await headings());
    await expect(page.getByRole('dialog')).toHaveAccessibleName(c['keep.title']);
    await page.keyboard.press('Escape');

    // Archive route.
    await page.goto('/#/archive');
    await expect(page.locator('#archive-title')).toBeVisible();
    expectOutline(await headings());
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: c['footer.nav'] })).toHaveCount(1);
    await expect(page.getByRole('contentinfo')).toHaveCount(1);
    await expect(page.getByRole('contentinfo').getByRole('link')).toHaveText(c['archive.close']);
    await expect(page.getByRole('link', { name: c['archive.back'] })).toHaveCount(1); // no duplicate accessible name
    const archiveSnapshot = await page.locator('body').ariaSnapshot();
    for (const line of ['- banner:', '- main:', '- contentinfo:', `- navigation "${c['footer.nav']}":`, `- link "${c['archive.close']}"`, `- link "${c['archive.back']}"`]) expect(archiveSnapshot, line).toContain(line);
    await writeFile(`${evidenceDir('measurement')}/aria/${lang}-archive-aria-snapshot.txt`, archiveSnapshot);
  });
}

test('dialogs: focus goes in, stays in, and returns to the trigger; a missing trigger falls back to a safe place', async ({ page }) => {
  await ready(page);
  // Keep-a-copy dialog: keyboard open, trap, Escape returns focus to the button.
  await tabTo(page, '.keep-copy');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect((await active(page)).inDialog).toBe(true);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect((await active(page)).inDialog).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('.keep-copy')).toBeFocused();

  // The trigger vanishes while the dialog is open: focus lands on the create field, never on <body>.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('.keep-copy').evaluate((el) => el.remove());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#create-title')).toBeFocused();

  // The ghost that opened a card vanishes: closing the card also falls back instead of losing focus.
  await create(page, 'Vanishing trigger');
  await page.locator('[data-ghost]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.task-card h2')).toBeFocused();
  await page.locator('[data-ghost]').evaluate((el) => el.remove());
  await page.keyboard.press('Escape');
  await expect(page.locator('.task-card')).toHaveCount(0);
  await expect(page.locator('#create-title')).toBeFocused();

  // On the archive route there is no create field: the page title takes the focus.
  await page.goto('/#/archive');
  await expect(page.locator('#archive-title')).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 0));
});

test('confirming moves focus to the create field instead of losing it with the removed confirm button', async ({ page }) => {
  await seedSave(page, saveWithArchive(0));
  await ready(page);
  await create(page, 'Quiet confirm');
  await page.locator('[data-ghost]').dispatchEvent('click');
  await page.getByLabel(en['criteria.label']).fill('Done');
  await page.getByRole('button', { name: en['criteria.save'], exact: true }).click();
  await page.getByLabel(en['steps.add.label']).fill('Only step');
  await page.getByRole('button', { name: en['steps.add.submit'], exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: en['confirm.button'], exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: en['confirm.yes'], exact: true }).click();
  await page.getByRole('button', { name: en['celebrate.skip'], exact: true }).click();
  await expect(page.locator('#create-title')).toBeFocused();
});

/** Measure the real focus ring: diff a screenshot with and without focus; the ring must be >=3px with >=3:1 contrast. */
async function expectVisibleRing(page: Page, target: Locator, label: string) {
  await target.scrollIntoViewIfNeeded();
  await page.keyboard.press('Shift'); // keyboard modality, so :focus-visible applies to the programmatic focus
  await target.focus();
  const info = await target.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { x: b.left, y: b.top, w: b.width, h: b.height, width: parseFloat(s.outlineWidth), style: s.outlineStyle, offset: parseFloat(s.outlineOffset) };
  });
  expect(info.style, label).toBe('solid');
  expect(info.width, label).toBeGreaterThanOrEqual(3);
  const pad = 12;
  const clip = { x: Math.max(0, info.x - pad), y: Math.max(0, info.y + info.h / 2 - 3), width: pad + 2, height: 6 };
  const withRing = decodePngBuffer(await page.screenshot({ clip }));
  await target.evaluate((el) => (el as HTMLElement).blur());
  const without = decodePngBuffer(await page.screenshot({ clip }));
  const luminance = ([r, g, b]: number[]) => {
    const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
  };
  // Ring pixels = pixels the focus state changed. Two-tone rings (dark inner, white outer) are used on the painted
  // house, whose backdrop varies pixel by pixel, so the rule is: at least 3px of the ring (the thickness of the
  // outline itself) must stand out from the surface underneath by 3:1.
  const row = 3;
  let changed = 0;
  let strong = 0;
  for (let x = 0; x < withRing.width; x++) {
    const a = pixelAt(withRing, x, row);
    const b = pixelAt(without, x, row);
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 30) continue;
    changed++;
    const [l1, l2] = [luminance(a), luminance(b)];
    if ((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) >= 3) strong++;
  }
  expect(changed, `${label}: ring pixels drawn`).toBeGreaterThanOrEqual(3);
  expect(strong, `${label}: ring pixels with >=3:1 contrast against the surface underneath`).toBeGreaterThanOrEqual(3);
}

test('focus rings are at least 3px, solid and visibly contrasted on the real surfaces they sit on', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedSave(page, saveWithArchive(1));
  await ready(page);
  await create(page, 'Ring check');
  await expectVisibleRing(page, page.locator('.lang-switch button').first(), 'language switch');
  await expectVisibleRing(page, page.locator('.keep-copy'), 'keep a copy');
  await expectVisibleRing(page, page.locator('#create-title'), 'create field');
  await expectVisibleRing(page, page.locator('[data-ghost]'), 'ghost button');
  await expectVisibleRing(page, page.locator('.archive-book'), 'lobby book');
  await expectVisibleRing(page, page.locator('.footer-link'), 'footer link');
  await page.locator('[data-ghost]').dispatchEvent('click');
  await expect(page.locator('.task-card')).toBeVisible();
  await expectVisibleRing(page, page.locator('.task-card .card-close'), 'card close');
  await expectVisibleRing(page, page.locator('#criteria'), 'criteria field');
  await page.locator('.task-card .card-close').click();
  await page.goto('/#/archive');
  await expect(page.locator('.archive-title-toggle')).toBeVisible();
  await expectVisibleRing(page, page.locator('.archive-title-toggle'), 'archive title toggle');
  await expectVisibleRing(page, page.locator('.archive-back'), 'archive back link');
});

for (const lang of LANGS) {
  test(`${lang}: the recovery screen keeps header, main and one h1; it has no footer navigation because there is nowhere to go yet`, async ({ page }) => {
    const c = copy(lang);
    await page.addInitScript((raw) => localStorage.setItem('ub:save', raw), '{ not readable');
    await page.goto('/');
    await expect(page.locator('.recovery')).toBeVisible();
    if (lang === 'zh-CN') await page.getByRole('button', { name: zhCN['language.zh-CN'], exact: true }).click();
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(c['recovery.title']);
    await expect(page.getByRole('contentinfo')).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    const snapshot = await page.locator('body').ariaSnapshot();
    for (const line of ['- banner:', '- main:', `- heading "${c['recovery.title']}" [level=2]`]) expect(snapshot, line).toContain(line);
    await mkdir(`${evidenceDir('measurement')}/aria`, { recursive: true });
    await writeFile(`${evidenceDir('measurement')}/aria/${lang}-recovery-aria-snapshot.txt`, snapshot);
    // Keyboard round trip: Tab reaches the three options in order, then the dialog traps and returns.
    await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute('tabindex'); });
    const stops: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const a = await active(page);
      stops.push(a.name);
      if (a.name === c['recovery.fresh.button']) break;
    }
    // The header comes first: the two language buttons and the sound switch.
    expect(stops.slice(0, 3)).toEqual([c['language.en'], c['language.zh-CN'], c['sound.label']]);
    expect(stops.slice(3)).toEqual([c['recovery.copy.button'], c['recovery.blank.button'], c['recovery.fresh.button']]);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    expect((await active(page)).inDialog).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.recovery-options li').nth(2).getByRole('button')).toBeFocused();
  });
}
