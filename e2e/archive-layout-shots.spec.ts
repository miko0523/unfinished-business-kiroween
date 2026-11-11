import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { SHOTS_DIR, shot } from './helpers/shots';
import { NATURAL_NOTES, saveWithMemos, seedSave } from './helpers/save';

// Raw review pictures of the memorial book: 1280x720 and 320x640, English and Chinese, with short, empty and long memos.
// Written only when SHOTS_DIR is set (a fresh folder inside the local ignored area); a normal run writes nothing.
// It also measures how many entries sit fully above the fold, so the numbers are measured rather than promised.

const SIZES = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '320x640', width: 320, height: 640 },
] as const;

const LONG = {
  en: [
    'I finally did the thing I kept putting off. It was small. I made tea, then sat with the cat for a long while, feeling light and proud.',
    'Cleared the whole desk, found three pens, two receipts and a letter I forgot to send. Sent it. Then wiped the desk and sat down happily.',
  ],
  'zh-CN': [
    '啊'.repeat(120),
    '终于把拖了很久的那件事做完了，其实很小。做完以后泡了一杯茶，抱着猫坐了好久，整个人都轻轻的，也有一点点骄傲。还顺手把桌子擦了一遍。',
  ],
} as const;

const scenarios = (lang: 'en' | 'zh-CN') => ({
  short: Array.from({ length: 6 }, (_, i) => NATURAL_NOTES[lang][i]!),
  empty: Array.from({ length: 6 }, () => ''),
  long: Array.from({ length: 6 }, (_, i) => (i % 3 === 0 ? LONG[lang][0] : i % 3 === 1 ? LONG[lang][1] : NATURAL_NOTES[lang][i]!)),
});

const report: Record<string, unknown> = {};

for (const lang of ['en', 'zh-CN'] as const) for (const size of SIZES) for (const [scenario, memos] of Object.entries(scenarios(lang))) {
  test(`${lang} ${size.name} ${scenario}: raw archive pictures and fold measurement`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await seedSave(page, saveWithMemos(memos, lang));
    await page.goto('/#/archive');
    await expect(page.locator('.archive-entry')).toHaveCount(6);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    const fold = await page.locator('.archive-entry').evaluateAll((els) => {
      const boxes = els.map((el) => el.getBoundingClientRect());
      return { fullyAboveFold: boxes.filter((r) => r.bottom <= innerHeight).length, startedAboveFold: boxes.filter((r) => r.top < innerHeight).length, heights: boxes.map((r) => Math.round(r.height)) };
    });
    const overflowToggles = await page.locator('.archive-memo-toggle').count();
    report[`${lang}-${size.name}-${scenario}`] = { ...fold, overflowToggles, scrollHeight: await page.evaluate(() => document.documentElement.scrollHeight) };

    const base = `${size.name}-${lang}-${scenario}`;
    await shot(page, `${base}-top`);
    await shot(page, `${base}-full`, true);
    if (scenario === 'long') {
      for (const t of await page.locator('.archive-memo-toggle').all()) await t.click();
      await page.mouse.move(0, 0);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await shot(page, `${base}-expanded-top`);
    }
    await context.close();
  });
}

test.afterAll(async () => {
  if (!SHOTS_DIR) return;
  await mkdir(SHOTS_DIR, { recursive: true });
  await writeFile(`${SHOTS_DIR}/fold-measurements.json`, JSON.stringify(report, null, 2));
});
