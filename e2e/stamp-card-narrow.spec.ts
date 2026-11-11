import { expect, test, type Page } from '@playwright/test';
import { forLanguage } from '../src/i18n/t';
import { saveWithArchive, seedSave } from './helpers/save';
import { shot } from './helpers/shots';

// 盖章卡在很窄的屏（160 宽 = 320 的 200% 缩放）上原来被挤成约 53px 宽、500 多 px 高的细条，还伸出视口。
// 现在身体两侧放不下时，卡片整行展开放在幽灵头顶上方。这里在 160、200、320、1280 宽、中英文下核对：
// 卡片完整在视口里、字不被挤窄、不压幽灵，跳过按钮（正常动态）仍能点到。Chromium 视口模拟，不是实体设备。

const WIDTHS = [160, 200, 320, 1280];
const LANGS = ['en', 'zh-CN'] as const;

async function confirmOne(page: Page, lang: (typeof LANGS)[number]) {
  const state = JSON.parse(saveWithArchive(0));
  state.settings.lang = lang;
  await seedSave(page, JSON.stringify(state));
  await page.goto('/');
  await page.waitForFunction(() => [...document.querySelectorAll('.static-layer img')].every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0));
  await page.locator('#create-title').fill(lang === 'en' ? 'Narrow stamp' : '窄屏盖章');
  await page.locator('.create-form button').first().click();
  await page.locator('[data-ghost]').dispatchEvent('click');
  await page.locator('#criteria').fill(lang === 'en' ? 'Done' : '完成');
  await page.locator('.criteria button[type="submit"]').click();
  await page.locator('#step-new').fill(lang === 'en' ? 'One' : '一步');
  await page.locator('.step-add button').click();
  await page.locator('.step-check input').check();
  await page.locator('.pending-box .primary').click();
  await page.getByRole('dialog').locator('.primary').click();
}

/** 当前画面上盖章卡与周边的几何：全部是视口坐标。 */
function measure(page: Page) {
  return page.evaluate(() => {
    const rect = (el: Element | null) => {
      const r = el?.getBoundingClientRect();
      return r ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null;
    };
    const card = document.querySelector<HTMLElement>('.stamp-page')!;
    const text = card.querySelector<HTMLElement>('.stamp-text')!;
    // 幽灵看得见的部分：身体加两只手（外框的空白处不算）。
    const parts = [document.querySelector('.celebration-ghost .ghost-body'), ...document.querySelectorAll('.celebration-ghost .ghost-hand ellipse')].filter((e): e is Element => !!e).map((e) => e.getBoundingClientRect());
    const ghost = { l: Math.min(...parts.map((r) => r.left)), t: Math.min(...parts.map((r) => r.top)), r: Math.max(...parts.map((r) => r.right)), b: Math.max(...parts.map((r) => r.bottom)) };
    const skip = document.querySelector<HTMLElement>('.skip-animation');
    const skipBox = skip?.getBoundingClientRect();
    return {
      card: rect(card)!,
      ghost,
      side: card.dataset.side,
      lines: Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight)),
      font: parseFloat(getComputedStyle(text).fontSize),
      vw: document.documentElement.clientWidth,
      vh: innerHeight,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      skip: skip ? { box: rect(skip)!, hit: document.elementFromPoint(skipBox!.left + skipBox!.width / 2, skipBox!.top + skipBox!.height / 2) === skip } : null,
    };
  });
}

for (const lang of LANGS) {
  for (const width of WIDTHS) {
    for (const motion of ['reduce', 'no-preference'] as const) {
      test(`${lang} ${width}px ${motion === 'reduce' ? '减少动态' : '正常动态'}：盖章卡完整在视口里、字不被挤窄、不压幽灵`, async ({ page }) => {
        test.setTimeout(60_000);
        const t = forLanguage(lang);
        await page.setViewportSize({ width, height: 700 });
        await page.emulateMedia({ reducedMotion: motion });
        await confirmOne(page, lang);
        const celebration = page.locator('.celebration');
        await expect(celebration).toHaveAttribute('data-phase', 'stamp', { timeout: 8000 });
        await expect(page.locator('.stamp-page')).toBeVisible();
        // 等盖章卡摆放完成（visibility 由摆放函数最后设成 visible）。
        await expect(page.locator('.stamp-page')).toHaveCSS('visibility', 'visible');
        const m = await measure(page);

        expect(m.card.l, '左').toBeGreaterThanOrEqual(0);
        expect(m.card.r, '右').toBeLessThanOrEqual(m.vw);
        expect(m.card.t, '上').toBeGreaterThanOrEqual(0);
        expect(m.card.b, '下').toBeLessThanOrEqual(m.vh);
        expect(m.card.r - m.card.l, '宽度够读').toBeGreaterThanOrEqual(Math.min(120, m.vw - 16));
        expect(m.card.b - m.card.t, '不是一条细长的柱子').toBeLessThanOrEqual(m.vh * 0.5);
        expect(m.lines, '那句话最多几行').toBeLessThanOrEqual(5);
        expect(m.font).toBeGreaterThanOrEqual(16);
        expect(m.overflowX, '没有横向滚动').toBeLessThanOrEqual(0);
        const overlap = m.card.l < m.ghost.r && m.ghost.l < m.card.r && m.card.t < m.ghost.b && m.ghost.t < m.card.b;
        expect(overlap, '不压幽灵').toBe(false);
        await expect(page.locator('.stamp-text')).toHaveText(t('archive.entry', { date: await page.locator('.stamp-text').innerText().then((s) => /\d{4}-\d{2}-\d{2}/.exec(s)![0]) }));
        if (m.side === 'above') expect(m.card.b, '放在头顶上方').toBeLessThanOrEqual(m.ghost.t + 1);

        if (motion === 'no-preference') {
          // 正常动态：跳过按钮在视口里、点得到（盖章期间它没被卡片或别的东西盖住）。
          expect(m.skip, '有跳过按钮').not.toBeNull();
          expect(m.skip!.hit, '跳过按钮点得到').toBe(true);
          expect(m.skip!.box.l).toBeGreaterThanOrEqual(0);
          expect(m.skip!.box.r).toBeLessThanOrEqual(m.vw);
          expect(m.skip!.box.t).toBeGreaterThanOrEqual(0);
        }
        await shot(page, `${lang}-${width}-stamp-card-${motion === 'reduce' ? 'still' : 'motion'}`);
      });
    }
  }
}
