import { expect, test, type Page } from '@playwright/test';
import { ready } from './helpers/app';
import { decodePngBuffer, pixelAt } from './helpers/pixels';
import { saveWithArchive, seedSave } from './helpers/save';
import { shot } from './helpers/shots';

// 程序移来的标题（纪念册标题、详情卡标题）只是落脚点，不是控件：
// 页面刚打开或用指针点进来时不留焦点框；用键盘进来时才画不小于 3px、对比度合格的柔和金色焦点。
// Chromium 视口模拟，不是真人读屏或实体设备。

const LANGS = ['en', 'zh-CN'] as const;
const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 320, height: 700 },
];

async function seed(page: Page, lang: (typeof LANGS)[number]) {
  const state = JSON.parse(saveWithArchive(3));
  state.settings.lang = lang;
  await seedSave(page, JSON.stringify(state));
}

const ringOf = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), offset: parseFloat(s.outlineOffset), color: s.outlineColor, shadow: s.boxShadow, focused: document.activeElement === el };
  });

const luminance = ([r, g, b]: number[]) => {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
};
const contrast = (a: number[], b: number[]) => {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/** 轮廓所在位置、没有焦点时画面上的颜色（取标题左侧外沿）。 */
async function surfaceUnderRing(page: Page, selector: string, ring: { width: number; offset: number }) {
  // 书翻开时有一段淡入：等书自己的动画演完，量到的才是封面本色（只等它自己的，天空里的萤火是循环的）。
  await page.evaluate(() => Promise.all((document.querySelector('.book')?.getAnimations() ?? []).map((a) => a.finished.catch(() => undefined))));
  const box = (await page.locator(selector).boundingBox())!;
  const x = Math.max(0, Math.floor(box.x - ring.offset - ring.width / 2));
  const y = Math.floor(box.y + box.height / 2);
  const focused = await page.locator(selector).evaluate((el) => document.activeElement === el);
  if (focused) await page.locator(selector).evaluate((el) => (el as HTMLElement).blur());
  const img = decodePngBuffer(await page.screenshot({ clip: { x, y, width: 2, height: 2 } }));
  const [r, g, b] = pixelAt(img, 0, 0);
  if (focused) await page.locator(selector).evaluate((el) => (el as HTMLElement).focus());
  return [r, g, b];
}

for (const lang of LANGS) {
  for (const viewport of VIEWPORTS) {
    test.describe(`${lang} ${viewport.width}px`, () => {
      test.use({ viewport });
      const tag = `${lang}-${viewport.width}`;

      test('纪念册标题：直接打开与指针点进来都没有焦点框；键盘进来有 ≥3px、≥3:1 的金色焦点，且不再是深色粗框', async ({ page }) => {
        await seed(page, lang);

        // 1. 直接打开地址：没有任何输入，脚本把焦点放到标题上。
        await ready(page, '/#/archive');
        await expect(page.locator('#archive-title')).toBeFocused();
        let ring = await ringOf(page, '#archive-title');
        expect(ring.style, 'direct open: no outline').toBe('none');
        expect(ring.shadow, 'direct open: no glow').toBe('none');
        await shot(page, `${tag}-archive-title-direct-open`);

        // 2. 指针：从房子里点页脚的入口进来。
        await page.goto('/#/');
        await expect(page.locator('.footer-link')).toBeVisible();
        await page.locator('.footer-link').click();
        await expect(page.locator('#archive-title')).toBeFocused();
        ring = await ringOf(page, '#archive-title');
        expect(ring.style, 'pointer entry: no outline').toBe('none');
        expect(ring.shadow, 'pointer entry: no glow').toBe('none');
        await shot(page, `${tag}-archive-title-pointer-entry`);

        // 3. 键盘：Tab 到页脚入口再按回车。
        await page.goto('/#/');
        await page.reload();
        await expect(page.locator('.footer-link')).toBeVisible();
        await page.locator('.footer-link').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#archive-title')).toBeFocused();
        ring = await ringOf(page, '#archive-title');
        expect(ring.style, 'keyboard entry: solid outline').toBe('solid');
        expect(ring.width, 'keyboard entry: at least 3px').toBeGreaterThanOrEqual(3);
        const ringColor = /rgb\((\d+), (\d+), (\d+)\)/.exec(ring.color)!.slice(1, 4).map(Number);
        const under = await surfaceUnderRing(page, '#archive-title', ring);
        expect(contrast(ringColor, under), `keyboard entry: ring ${ring.color} against the surface ${under}`).toBeGreaterThanOrEqual(3);
        // 柔和：不是原来的近黑色粗框，是金色（红 > 蓝，且不暗到发黑）。
        expect(ringColor[0]! > ringColor[2]! + 40 && ringColor[0]! > 100, `gold-ish outline, got ${ring.color}`).toBe(true);
        await shot(page, `${tag}-archive-title-keyboard-entry`);
      });

      test('详情卡标题：点开时没有焦点框，键盘打开才有；可操作的控件仍然有焦点框', async ({ page }) => {
        await seed(page, lang);
        await ready(page);
        await page.locator('#create-title').fill(lang === 'en' ? 'Heading ring' : '标题焦点');
        await page.locator('.create-form button').first().click();
        await page.locator('[data-ghost]').dispatchEvent('click');
        await expect(page.locator('.task-card h2')).toBeFocused();
        const ring = await ringOf(page, '.task-card h2');
        expect(ring.style, 'pointer-less open: no outline on the card title').toBe('none');
        // 控件不受影响：键盘到“关闭”按钮仍是 ≥3px 的实线轮廓。
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        const active = await page.evaluate(() => document.activeElement?.className ?? '');
        expect(active).toMatch(/move-out|card-close|card-/);
        const control = await ringOf(page, '.task-card :focus');
        expect(control.style).toBe('solid');
        expect(control.width).toBeGreaterThanOrEqual(3);
        // 键盘模式下，再把焦点程序化地放回标题：这时才画柔和金色焦点。
        await page.locator('.task-card h2').evaluate((el) => (el as HTMLElement).focus());
        const keyboardRing = await ringOf(page, '.task-card h2');
        expect(keyboardRing.style).toBe('solid');
        expect(keyboardRing.width).toBeGreaterThanOrEqual(3);
      });
    });
  }
}
