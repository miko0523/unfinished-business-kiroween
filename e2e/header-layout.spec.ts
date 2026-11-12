import { expect, test } from '@playwright/test';
import { forLanguage } from '../src/i18n/t';
import { ready } from './helpers/app';

// 窄屏页头的真实布局回归（阶段 18 第二轮）：页头多了小喇叭以后，320 与 360 宽下它曾独自掉到第二行，页头从 46px 变 98px。
// 这里直接量盒子：页头高度、喇叭与语言按钮是否同一行、是否贴右、触控区、文字是否被截断、有没有水平滚动。

interface Box { x: number; y: number; w: number; h: number }

const CASES = [
  // 360：标题、语言、喇叭同一行；英文标题折成两行（46px），中文一行（44px，由按钮撑起）。
  { width: 360, lang: 'en', maxHeight: 48, oneRow: true },
  { width: 360, lang: 'zh-CN', maxHeight: 48, oneRow: true },
  // 320：放不下一行。标题独占第一行，语言与喇叭作为一组在第二行；比原来的 98px 矮。
  { width: 320, lang: 'en', maxHeight: 84, oneRow: false },
  { width: 320, lang: 'zh-CN', maxHeight: 84, oneRow: false },
] as const;

for (const c of CASES) {
  test(`页头 ${c.width} 宽 ${c.lang}：喇叭不独占一行、无水平滚动、按钮 ≥44px、文字不截断`, async ({ page }) => {
    await page.setViewportSize({ width: c.width, height: 800 });
    await ready(page);
    if (c.lang === 'zh-CN') {
      await page.getByRole('button', { name: '简体中文', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    }
    const copy = forLanguage(c.lang);
    await expect(page.locator('.app-header h1')).toHaveText(copy('app.title'));

    const m = await page.evaluate(() => {
      const box = (el: Element): Box => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const header = document.querySelector('.app-header')!;
      const h1 = header.querySelector('h1')!;
      const langs = [...header.querySelectorAll('.lang-switch button')];
      const sound = header.querySelector('.sound-switch')!;
      return {
        header: box(header),
        h1: box(h1),
        h1Clipped: h1.scrollWidth > h1.clientWidth + 0.5,
        langs: langs.map((b) => ({ box: box(b), clipped: b.scrollWidth > b.clientWidth + 0.5, text: b.textContent })),
        sound: box(sound),
        buttons: [...header.querySelectorAll('button')].map((b) => ({ name: b.getAttribute('aria-label') ?? b.textContent, ...box(b) })),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });

    // 无水平滚动，页头不出视口。
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
    expect(m.header.x + m.header.w).toBeLessThanOrEqual(c.width + 0.5);

    // 页头高度：不再是 98px。
    expect(m.header.h).toBeLessThanOrEqual(c.maxHeight);

    // 喇叭和语言按钮在同一行（竖直方向重合），在它们右边，贴着页头右缘。
    expect(m.langs).toHaveLength(2);
    for (const l of m.langs) {
      expect(Math.abs(l.box.y + l.box.h / 2 - (m.sound.y + m.sound.h / 2))).toBeLessThan(2);
      expect(l.box.x + l.box.w).toBeLessThanOrEqual(m.sound.x);
    }
    expect(Math.abs(m.sound.x + m.sound.w - (m.header.x + m.header.w))).toBeLessThan(1);

    if (c.oneRow) {
      // 一整行：喇叭在页头第一行，标题与它竖直方向重合。
      expect(m.sound.y - m.header.y).toBeLessThan(4);
      expect(m.h1.y).toBeLessThan(m.sound.y + m.sound.h);
      expect(m.h1.x + m.h1.w).toBeLessThanOrEqual(m.langs[0]!.box.x);
    } else {
      // 两行：标题在第一行、一行放下；语言与喇叭整组在它下面。
      expect(m.h1.y + m.h1.h).toBeLessThanOrEqual(m.sound.y);
      expect(m.h1.h).toBeLessThan(32);
    }

    // 触控区与文字。
    for (const b of m.buttons) {
      expect(b.w, b.name ?? '').toBeGreaterThanOrEqual(44);
      expect(b.h, b.name ?? '').toBeGreaterThanOrEqual(44);
    }
    expect(m.h1Clipped).toBe(false);
    for (const l of m.langs) expect(l.clipped, l.text ?? '').toBe(false);
    expect(m.langs.map((l) => l.text)).toEqual([copy('language.en'), copy('language.zh-CN')]);
  });
}
