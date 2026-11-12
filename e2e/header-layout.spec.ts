import { expect, test } from '@playwright/test';
import { forLanguage } from '../src/i18n/t';
import { ready } from './helpers/app';

// 窄屏页头的真实布局回归：标题在左，四个小图标（留一份副本、试试示例、语言、声音）靠右，全部同一行。
// 这里直接量盒子：按钮是否同一行、是否贴右、触控区、有没有水平滚动、创建框与旧宅是否被顶得太低。

interface Box { x: number; y: number; w: number; h: number }

const CASES = [
  { width: 390, lang: 'en', oneRow: true },
  { width: 390, lang: 'zh-CN', oneRow: true },
  { width: 375, lang: 'en', oneRow: true },
  { width: 375, lang: 'zh-CN', oneRow: true },
  { width: 360, lang: 'en', oneRow: true },
  { width: 360, lang: 'zh-CN', oneRow: true },
  // 320：标题至少还有 110px，仍是一行。
  { width: 320, lang: 'en', oneRow: true },
  { width: 320, lang: 'zh-CN', oneRow: true },
  // 更窄（< 300）放不下标题加一整组：整组落到第二行靠右，但组内四个按钮仍在同一行。
  { width: 280, lang: 'en', oneRow: false },
] as const;

for (const c of CASES) {
  test(`页头 ${c.width} 宽 ${c.lang}：四个图标同一行贴右、无水平滚动、点击区 ≥44px、名字完整`, async ({ page }) => {
    await page.setViewportSize({ width: c.width, height: 844 });
    await ready(page);
    const copy = forLanguage(c.lang);
    if (c.lang === 'zh-CN') {
      await page.getByRole('button', { name: forLanguage('en')('language.toZh'), exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    }
    await expect(page.locator('.app-header h1')).toHaveText(copy('app.title'));
    const names = [copy('keep.button'), copy('demo.try'), copy(c.lang === 'en' ? 'language.toZh' : 'language.toEn'), copy('sound.label')];
    for (const name of names) await expect(page.locator('.app-header').getByRole('button', { name, exact: true })).toHaveCount(1);

    const m = await page.evaluate(() => {
      const box = (el: Element): Box => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const header = document.querySelector('.app-header')!;
      const h1 = header.querySelector('h1')!;
      return {
        header: box(header),
        h1: box(h1),
        buttons: [...header.querySelectorAll('button')].map((b) => ({ name: b.getAttribute('aria-label') ?? '', ...box(b) })),
        form: box(document.querySelector('.create-form')!),
        house: box(document.querySelector('.house')!),
        topTools: box(document.querySelector('.top-tools') ?? header),
        topToolsShown: !!document.querySelector('.top-tools') && getComputedStyle(document.querySelector('.top-tools')!).display !== 'none',
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });

    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
    expect(m.header.x + m.header.w).toBeLessThanOrEqual(c.width + 0.5);
    expect(m.buttons).toHaveLength(4);
    // 四个按钮同一行（竖直中心一致）、从左到右依次排列、最后一个贴着页头右缘。
    const mid = (b: Box) => b.y + b.h / 2;
    for (const b of m.buttons) expect(Math.abs(mid(b) - mid(m.buttons[0]!)), b.name).toBeLessThan(1);
    for (let i = 1; i < 4; i++) expect(m.buttons[i]!.x).toBeGreaterThanOrEqual(m.buttons[i - 1]!.x + m.buttons[i - 1]!.w - 0.5);
    const last = m.buttons[3]!;
    expect(Math.abs(last.x + last.w - (m.header.x + m.header.w))).toBeLessThan(1);
    for (const b of m.buttons) {
      expect(b.w, b.name).toBeGreaterThanOrEqual(43.9);
      expect(b.h, b.name).toBeGreaterThanOrEqual(43.9);
    }
    if (c.oneRow) {
      // 整个页头就是一行按钮高：标题与按钮竖直方向重合，页头不超过两行标题的高度。
      expect(m.h1.y).toBeLessThan(m.buttons[0]!.y + m.buttons[0]!.h);
      expect(m.h1.x + m.h1.w).toBeLessThanOrEqual(m.buttons[0]!.x + 0.5);
      expect(m.header.h).toBeLessThanOrEqual(52);
    } else {
      expect(m.h1.y + m.h1.h).toBeLessThanOrEqual(m.buttons[0]!.y + 0.5);
    }
    // 没有存储问题时，空的提示行不占位；创建框是矮卡片。
    expect(m.topToolsShown).toBe(false);
    if (c.width >= 360) expect(m.form.h).toBeLessThanOrEqual(84);
    expect(m.form.h).toBeGreaterThan(0);
    if (c.width >= 360) expect(m.form.y + m.form.h).toBeLessThan(160);
    // 旧宅紧跟在创建框下面。
    expect(m.house.y).toBeLessThan(m.form.y + m.form.h + 16);
  });
}

// 笔记本（矮而宽）：两栏，起始的旧宅从屋顶到门厅整栋在首屏内，且是页面上最大的元素。
test('宽屏 1280×625：左控制列 + 右旧宅，首屏不滚动即可看到整栋起始旧宅', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 625 });
  await ready(page);
  const m = await page.evaluate(() => {
    const r = (sel: string) => {
      const b = document.querySelector(sel)!.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom, right: b.right };
    };
    return { house: r('.house'), form: r('.create-form'), header: r('.app-header'), scrollH: document.documentElement.scrollHeight, innerH: innerHeight };
  });
  expect(m.house.y).toBeGreaterThanOrEqual(0);
  expect(m.house.bottom).toBeLessThanOrEqual(m.innerH);
  expect(m.scrollH).toBeLessThanOrEqual(m.innerH);
  // 左列在旧宅左边，且旧宅是最大的块。
  expect(m.form.right).toBeLessThanOrEqual(m.house.x);
  expect(m.header.right).toBeLessThanOrEqual(m.house.x);
  expect(m.house.w * m.house.h).toBeGreaterThan(m.form.w * m.form.h * 4);
});
