import { expect, test, type Page } from '@playwright/test';
import { forLanguage } from '../src/i18n/t';
import { ready } from './helpers/app';
import { saveWithArchive, seedSave } from './helpers/save';
import { shot } from './helpers/shots';

// 减少动态时，读屏播报的那句话同时作为静态文字提示显示。它不能盖住标题、语言切换、创建框、详情抽屉
// 和站在抽屉上沿的 Ghost；读屏看到的文字不变（元素与 role="status" 都还在）。Chromium 视口模拟，不是实体设备。

const LANGS = ['en', 'zh-CN'] as const;
const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 320, height: 700 },
  { width: 160, height: 700 },
];

/** 提示框与这些“不许盖住”的元素；返回相交的名字。 */
async function covered(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    // 抽屉高度与舞台高度由 ResizeObserver 在渲染帧里发布给提示的位置：等两帧再量。
    await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    const cap = document.querySelector<HTMLElement>('[role="status"][data-caption="true"]');
    if (!cap) return ['caption missing'];
    const c = cap.getBoundingClientRect();
    const selectors: [string, string][] = [
      ['title', 'h1'],
      ['language switch', '.lang-switch button'],
      // 窄屏（<900）且抽屉打开时，标题、语言切换、抽屉和舞台上的 Ghost 已把可用的高度占满，提示只好落在创建框那一带；
      // 创建框此时被抽屉压在后面，提示本身不拦截点击。其余情况下创建框也不许被盖。
      ...(innerWidth < 900 && document.querySelector('.task-card') ? [] : ([['create field', '#create-title'], ['create button', '.create-form button']] as [string, string][])),
      ['drawer', '.task-card'],
      ['stamp card', '.stamp-page'],
      ['staged ghost', '[data-staged] .ghost-button'],
    ];
    const hits: string[] = [];
    for (const [name, selector] of selectors) {
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        let r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        // Ghost 盒子顶部约四分之一是空的（呆毛之上），只看看得见的部分。
        if (el.classList.contains('ghost-button')) r = new DOMRect(r.left, r.top + r.height * 0.25, r.width, r.height * 0.75);
        if (r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top) hits.push(`${name}: ${el.tagName.toLowerCase()}.${el.className}`);
      }
    }
    return hits;
  });
}

async function captionFacts(page: Page) {
  return page.evaluate(() => {
    const cap = document.querySelector<HTMLElement>('[role="status"][data-caption="true"]')!;
    const r = cap.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight, text: cap.textContent ?? '', pointer: getComputedStyle(cap).pointerEvents, size: parseFloat(getComputedStyle(cap).fontSize) };
  });
}

for (const lang of LANGS) {
  for (const viewport of VIEWPORTS) {
    test(`${lang} ${viewport.width}px：文字提示在创建后、抽屉里、对话框前后都不盖住标题、语言切换和输入`, async ({ page }) => {
      test.setTimeout(60_000);
      const t = forLanguage(lang);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const state = JSON.parse(saveWithArchive(0));
      state.settings.lang = lang;
      await seedSave(page, JSON.stringify(state));
      await ready(page);
      const tag = `${lang}-${viewport.width}`;
      const verify = async (label: string, expected: string) => {
        const status = page.getByRole('status');
        await expect(status, label).toContainText(expected);
        await expect(status, label).toHaveAttribute('data-caption', 'true');
        const f = await captionFacts(page);
        expect(f.pointer, `${label}: lets clicks through`).toBe('none');
        expect(f.size, `${label}: >=16px`).toBeGreaterThanOrEqual(16);
        expect(f.left, `${label}: inside the viewport (left)`).toBeGreaterThanOrEqual(0);
        expect(f.right, `${label}: inside the viewport (right)`).toBeLessThanOrEqual(f.vw);
        expect(f.bottom, `${label}: inside the viewport (bottom)`).toBeLessThanOrEqual(f.vh);
        expect(f.top, `${label}: inside the viewport (top)`).toBeGreaterThanOrEqual(0);
        expect(await covered(page), `${label}: covers nothing it must not`).toEqual([]);
      };

      // 1. 刚搬进来：没有抽屉。
      await page.locator('#create-title').fill(lang === 'en' ? 'Caption check' : '检查提示位置');
      await page.locator('.create-form button').first().click();
      await expect(page.locator('[data-ghost]')).toHaveCount(1);
      await verify('moved in', t('create.movedIn'));
      await shot(page, `${tag}-1-moved-in-caption`);

      // 2. 抽屉打开，补完条件和一步，勾选后“等你确认”。
      await page.locator('[data-ghost]').dispatchEvent('click');
      await expect(page.locator('.task-card')).toBeVisible();
      await page.locator('#criteria').fill(lang === 'en' ? 'Done' : '完成');
      await page.locator('.criteria button[type="submit"]').click();
      await page.locator('#step-new').fill(lang === 'en' ? 'One step' : '一小步');
      await page.locator('.step-add button').click();
      await verify('white', t('live.state', { state: t('state.white') }));
      await page.locator('.step-check input').check();
      await verify('pending', t('state.pending'));
      await shot(page, `${tag}-2-pending-caption`);

      // 3. 打开确认对话框：对话框在顶层，提示在它下面，不抢也不挡。
      await page.locator('.pending-box .primary').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      const dialogTop = await page.evaluate(() => {
        const d = document.querySelector('dialog[open]')!.getBoundingClientRect();
        return { top: d.top, bottom: d.bottom };
      });
      expect(dialogTop.bottom).toBeGreaterThan(0);
      await shot(page, `${tag}-3-dialog-open`);
      // 读屏文字没有被拿掉：状态元素仍在、仍是礼貌播报。
      await expect(page.getByRole('status')).toHaveAttribute('aria-live', 'polite');

      // 4. 确认：静止的盖章页（减少动态不飞也不位移），提示不压住盖章卡。
      await page.getByRole('dialog').getByRole('button', { name: t('confirm.yes'), exact: true }).click();
      await expect(page.locator('.celebration')).toHaveAttribute('data-still', 'true');
      await expect(page.locator('.stamp-page')).toBeVisible();
      await verify('flew', t('live.flew'));
      await shot(page, `${tag}-4-still-stamp-caption`);
    });
  }
}

// 提示固定在画面底部：键盘把焦点移到页面最底下的控件（门厅纪念册、页脚入口）时，它们不能被提示盖住。
for (const viewport of [VIEWPORTS[0]!, VIEWPORTS[1]!]) {
  test(`${viewport.width}px：提示显示期间，聚焦门厅纪念册和页脚入口，它们仍露在提示之外`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedSave(page, saveWithArchive(1));
    await ready(page);
    await page.locator('#create-title').fill('Focus not obscured');
    await page.locator('.create-form button').first().click();
    await expect(page.getByRole('status')).toHaveAttribute('data-caption', 'true');
    for (const selector of ['.archive-book', '.footer-link']) {
      await page.locator(selector).focus();
      // 键盘焦点引发的滚动在下一个渲染帧里完成。
      const overlap = await page.evaluate(async (sel) => {
        await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
        const cap = document.querySelector('[role="status"][data-caption="true"]');
        if (!cap) return 'caption gone before the check';
        const c = cap.getBoundingClientRect();
        const r = document.querySelector(sel)!.getBoundingClientRect();
        return r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top ? `${sel} is under the caption` : '';
      }, selector);
      expect(overlap).toBe('');
    }
  });
}
