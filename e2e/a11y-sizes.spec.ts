import { expect, test, type Browser, type Page } from '@playwright/test';
import { forLanguage } from '../src/i18n/t';
import { ready } from './helpers/app';
import { evidenceShot } from './helpers/evidence';
import { saveWithNaturalArchive, seedSave } from './helpers/save';
import { ghostOverlap, sizes, type SizeReport } from './helpers/sizes';

// Phase 14.3: targets >= 44x44, text >= 16px, contrast, reflow. Measured in Chromium with emulated viewports:
// 160 CSS px stands in for a 320px-wide screen at 200% zoom. This is NOT physical-device, real-zoom or full-WCAG evidence.

const LANGS = ['en', 'zh-CN'] as const;
type Lang = (typeof LANGS)[number];
const VIEWPORTS = [160, 320, 899, 900, 1280, 2560] as const;
const heightFor = (w: number) => (w <= 320 ? 812 : w >= 2560 ? 1400 : 900);

const SCENE_EXCEPTIONS: string[] = []; // none: even the compact farewell stamp card now keeps 16px text

function expectClean(report: SizeReport, label: string) {
  expect(report.overflow, `${label}: horizontal overflow`).toEqual({ scrollWidth: report.overflow.innerWidth, innerWidth: report.overflow.innerWidth, widest: [] });
  expect(report.offscreen, `${label}: controls outside the viewport sideways`).toEqual([]);
  expect(report.smallTargets, `${label}: targets under 44x44`).toEqual([]);
  expect(report.smallText, `${label}: text under 16px`).toEqual([]);
  expect(report.lowTextContrast, `${label}: text contrast under 4.5:1`).toEqual([]);
  expect(report.lowControlContrast, `${label}: control boundary under 3:1`).toEqual([]);
  expect(report.lowPlaceholder, `${label}: placeholder under 4.5:1`).toEqual([]);
}

/** One audit = overflow, off-screen controls, 44x44 targets (ghosts by real hit-testing), 16px text, contrast. No element is exempt. */
const audit = async (page: Page, label: string, extraAllow: string[] = []) => {
  const report = await sizes(page, [...SCENE_EXCEPTIONS, ...extraAllow]);
  expectClean(report, label);
  return report;
};

async function newPage(browser: Browser, width: number, lang: Lang, reduced = true) {
  const context = await browser.newContext({ viewport: { width, height: heightFor(width) }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  const state = JSON.parse(saveWithNaturalArchive(0, lang));
  await seedSave(page, JSON.stringify(state));
  return { context, page };
}

/** Escape inside the open dialog, then wait until it is really gone (a second Escape can otherwise race the first). */
const closeDialog = async (page: Page) => {
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
};

const fastCreate = async (page: Page, title: string) => {
  await page.locator('#create-title').fill(title);
  await page.locator('#create-title').press('Enter');
};

test('viewport metadata allows zooming', async ({ page }) => {
  await ready(page);
  const content = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(content).toContain('width=device-width');
  expect(content).not.toMatch(/user-scalable\s*=\s*(no|0)/i);
  expect(content).not.toMatch(/maximum-scale/i);
  expect(content).not.toMatch(/minimum-scale\s*=\s*1(\.0)?\b.*maximum/i);
});

for (const lang of LANGS) for (const width of VIEWPORTS) {
  test(`${lang} ${width}px: house with a full ten-resident tower, a 50-step card, dialogs and archive stay within the size rules`, async ({ browser }) => {
    test.setTimeout(120_000);
    const t = forLanguage(lang);
    const { context, page } = await newPage(browser, width, lang);
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await audit(page, 'empty house');

    // Ten residents fill floors 2-6: both the lowest and the highest floor are measured.
    for (let i = 1; i <= 10; i++) await fastCreate(page, lang === 'en' ? `Resident ${i}` : `住客 ${i}`);
    await expect(page.locator('[data-ghost]')).toHaveCount(10);
    const focused = await audit(page, 'ten residents, focused view');
    expect(focused.counts.ghostsProbed, 'every ghost was hit-tested').toBe(10);
    if (width < 900) {
      await page.locator('.view-toggle').click();
      await expect(page.locator('.house')).toHaveAttribute('data-camera', 'panorama');
      const panorama = await audit(page, 'panorama (small house, hit areas probed)');
      expect(panorama.counts.ghostsProbed, 'every ghost was hit-tested in the panorama').toBe(10);
      if (width === 320) await evidenceShot(page, 'measurement', `${width}-${lang}-panorama-ten-residents`);
      await page.locator('.view-toggle').click();
    } else if (width === 1280 || width === 2560) {
      await evidenceShot(page, 'measurement', `${width}-${lang}-ten-residents`);
    }

    // Lowest and highest floor ghost: open each card.
    for (const which of ['last', 'first'] as const) {
      const ghost = which === 'first' ? page.locator('[data-ghost]').first() : page.locator('[data-ghost]').last();
      await ghost.dispatchEvent('click');
      await expect(page.locator('.task-card')).toBeVisible();
      await page.waitForTimeout(600); // the drawer's own settle-scroll runs at 450ms; measure after it so it cannot move the page under the probe
      await audit(page, `card for the ${which === 'first' ? 'top' : 'bottom'} floor`);
      if (which === 'last') {
        await page.locator('.task-card .card-close').click();
        await expect(page.locator('.task-card')).toHaveCount(0);
      }
    }

    // Top ghost card: criteria, then the maximum 50 steps.
    await page.locator('#criteria').fill(lang === 'en' ? 'All done' : '全部完成');
    await page.locator('.criteria button[type="submit"]').click();
    for (let i = 1; i <= 50; i++) {
      await page.locator('#step-new').fill(lang === 'en' ? `Step ${i}` : `步骤 ${i}`);
      await page.locator('#step-new').press('Enter');
    }
    await expect(page.locator('.step')).toHaveCount(50);
    await audit(page, 'card with 50 steps');
    for (const box of await page.locator('.step-check input').all()) await box.check();
    await expect(page.locator('.pending-box .primary')).toBeVisible();
    await audit(page, '50 steps, all done, ready to confirm');
    if (width === 1280 || width === 320) await evidenceShot(page, 'measurement', `${width}-${lang}-card-50-steps-ready`);

    // Dialogs.
    await page.locator('.pending-box .primary').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await audit(page, 'confirm dialog');
    if (width === 1280 || width === 320) await evidenceShot(page, 'measurement', `${width}-${lang}-confirm-dialog`, false);
    await closeDialog(page);
    await page.locator('.move-out').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await audit(page, 'say-goodbye dialog');
    await closeDialog(page);
    await page.locator('.task-card .card-close').click();
    await expect(page.locator('.task-card')).toHaveCount(0);
    await page.getByRole('button', { name: t('keep.button'), exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await audit(page, 'keep-a-copy dialog');
    await closeDialog(page);
    await fastCreate(page, lang === 'en' ? 'Eleventh' : '第十一个');
    await expect(page.getByRole('dialog')).toBeVisible();
    await audit(page, 'house-full notice');
    if (width === 1280 || width === 320) await evidenceShot(page, 'measurement', `${width}-${lang}-house-full`, false);
    await closeDialog(page);

    // Archive with natural notes (separate document state, same context).
    await page.evaluate((raw) => localStorage.setItem('ub:save', raw), saveWithNaturalArchive(12, lang));
    await page.goto('/#/archive');
    await page.reload();
    await expect(page.locator('.archive-entry')).toHaveCount(12);
    await audit(page, 'archive with twelve entries');
    await page.locator('.archive-title-toggle').first().click();
    await audit(page, 'archive with a title shown');
    if (width === 1280 || width === 320) await evidenceShot(page, 'measurement', `${width}-${lang}-archive-twelve-sizes`);
    await context.close();
  });
}

for (const lang of LANGS) for (const width of [160, 320, 900, 1280] as const) {
  test(`${lang} ${width}px: demo, storage notice and recovery screens stay within the size rules`, async ({ browser }) => {
    const t = forLanguage(lang);
    const { context, page } = await newPage(browser, width, lang);
    await ready(page);
    await page.getByRole('button', { name: t('demo.try'), exact: true }).click();
    await expect(page.locator('.demo-bar')).toBeVisible();
    await audit(page, 'demo bar');
    await page.locator('[data-ghost]').first().dispatchEvent('click');
    await expect(page.locator('.task-card')).toBeVisible();
    await audit(page, 'demo card');
    if (width === 1280 || width === 320) await evidenceShot(page, 'measurement', `${width}-${lang}-demo`);
    await page.close();

    // Recovery: an unreadable save.
    const broken = await context.newPage();
    await broken.addInitScript(() => localStorage.setItem('ub:save', '{ not readable'));
    await broken.goto('/');
    await expect(broken.locator('.recovery')).toBeVisible();
    if (lang === 'zh-CN') await broken.getByRole('button', { name: /switch to 简体中文/ }).click();
    await audit(broken, 'recovery');
    await broken.getByRole('button', { name: forLanguage(lang)('recovery.fresh.button'), exact: true }).click();
    await expect(broken.getByRole('dialog')).toBeVisible();
    await audit(broken, 'recovery confirm dialog');
    if (width === 1280 || width === 320) await evidenceShot(broken, 'measurement', `${width}-${lang}-recovery`, false);
    await closeDialog(broken);
    await broken.getByRole('button', { name: forLanguage(lang)('recovery.blank.button'), exact: true }).click();
    await expect(broken.locator('.storage-notice')).toBeVisible();
    await audit(broken, 'memory-mode notice');
    await context.close();
  });
}

test.describe('breakpoints and wide screens', () => {
  test('899 and 900 switch layout at exactly the documented line; 2560 keeps the house at its maximum width, centred', async ({ browser }) => {
    const wide = await newPage(browser, 900, 'en');
    const narrow = await newPage(browser, 899, 'en');
    const huge = await newPage(browser, 2560, 'en');
    for (const { page } of [wide, narrow, huge]) {
      await ready(page);
      await fastCreate(page, 'Layout');
    }
    expect(await narrow.page.locator('.view-toggle').count()).toBe(1);
    expect(await wide.page.locator('.view-toggle').count()).toBe(1);
    expect(await wide.page.locator('.sky-trees').count()).toBeGreaterThan(0);
    expect(await narrow.page.locator('.sky-trees').count()).toBe(0);
    const moon = (p: Page) => p.locator('.sky-moon').evaluate((el) => el.getBoundingClientRect().width);
    expect(await moon(wide.page)).toBeGreaterThan(await moon(narrow.page));
    // 两栏（左控制列 + 旧宅）整体居中。
    const house = await huge.page.locator('.house').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const side = document.querySelector('.app-header')!.getBoundingClientRect();
      return { width: r.width, left: side.left, right: innerWidth - r.right };
    });
    expect(house.width).toBeLessThanOrEqual(809);
    // 左列 320 + 间距 16 + 右列 809 = 1145 宽的一组，在 2560 里居中。
    expect(Math.abs(house.left - (2560 - 1145) / 2)).toBeLessThanOrEqual(2);
    for (const label of ['899', '900', '2560']) {
      const { page } = label === '899' ? narrow : label === '900' ? wide : huge;
      await audit(page, `${label}px house`);
    }
    await evidenceShot(huge.page, 'measurement', '2560-en-house');
    await Promise.all([wide, narrow, huge].map(({ context }) => context.close()));
  });

  test('body text of the default view is already 16px or more at 160 and 320 in normal motion too', async ({ browser }) => {
    for (const width of [160, 320]) {
      const { context, page } = await newPage(browser, width, 'en', false);
      await ready(page);
      await fastCreate(page, 'Normal motion');
      await audit(page, `normal motion ${width}`);
      await context.close();
    }
  });

  for (const width of [1280, 320] as const) {
    test(`${width}px: the still farewell stamp page keeps 16px text, compact layout included`, async ({ browser }) => {
      const { context, page } = await newPage(browser, width, 'en');
      await ready(page);
      await fastCreate(page, 'Stamp size');
      await page.locator('[data-ghost]').dispatchEvent('click');
      await page.locator('#criteria').fill('Done');
      await page.locator('.criteria button[type="submit"]').click();
      await page.locator('#step-new').fill('One');
      await page.locator('#step-new').press('Enter');
      await page.locator('.step-check input').check();
      await page.locator('.pending-box .primary').click();
      await page.getByRole('dialog').locator('.primary').click();
      await expect(page.locator('.stamp-page')).toBeVisible();
      expect(await page.locator('.stamp-page').getAttribute('data-compact')).toBe(width === 320 ? 'true' : 'false');
      expect(await page.locator('.stamp-page p').evaluateAll((ps) => ps.map((p) => parseFloat(getComputedStyle(p).fontSize)))).toEqual(expect.arrayContaining([16]));
      await audit(page, `${width} still stamp page`);
      await context.close();
    });
  }
});

// Real, non-overlapping hit areas. Each ghost is probed alone (the others' pointer events off), then the areas are
// compared, so z-order cannot hide an overlap. At rest (home anchors) the areas must be disjoint at every width.
for (const width of [160, 320, 900, 1280] as const) {
  for (const motion of ['reduce', 'no-preference'] as const) {
    test(`${width}px ${motion === 'reduce' ? 'reduced motion' : 'normal motion'}: five residents on three floors have disjoint 44x44 hit areas`, async ({ browser }) => {
      test.setTimeout(90_000);
      const { context, page } = await newPage(browser, width, 'en', motion === 'reduce');
      await ready(page);
      for (let i = 1; i <= 5; i++) await fastCreate(page, `Hit ${i}`);
      await expect(page.locator('[data-ghost]')).toHaveCount(5);
      await expect(page.locator('.ghost-enter')).toHaveCount(0);
      // Let any walking settle: normal motion below ~312px keeps residents at their homes, wider views may roam.
      await page.waitForTimeout(600);
      const roams = motion === 'no-preference' && width >= 312;
      const first = await audit(page, `${width} ${motion}: five residents`);
      expect(first.counts.ghostsProbed).toBe(5);
      if (!roams) {
        const result = await ghostOverlap(page);
        expect(result.ghosts).toBe(5);
        expect(result.areas.every((n) => n >= 44 * 44 / 4), `each probed area covers at least 44x44 (${result.areas.join(',')})`).toBe(true);
        expect(result.overlaps).toEqual([]);
      }
      if (width < 900) {
        await page.locator('.view-toggle').click();
        await expect(page.locator('.house')).toHaveAttribute('data-camera', 'panorama');
        await page.waitForTimeout(300);
        const pan = await audit(page, `${width} ${motion}: panorama`);
        expect(pan.counts.ghostsProbed).toBe(5);
        if (!roams) expect((await ghostOverlap(page)).overlaps).toEqual([]);
      }
      await context.close();
    });
  }
}
