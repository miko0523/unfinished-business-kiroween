import { expect, test, type Page } from '@playwright/test';
import { addStep, card, create, ghosts, openGhost, ready, setCriteria } from './helpers/app';

interface Frame {
  card: [number, number, number, number];
  floor: [number, number, number, number];
  scale: number;
  viewport: [number, number];
  body: [number, number, number, number];
  hands: [number, number, number, number][];
  eyes: [number, number, number, number];
  text: string;
  memo: string | null;
  sealOpacity: number;
  sealSize: number;
  sealStroke: string;
  sealPaths: number;
  visibility: string;
}

/** 走完一遍确认流程，同时每一帧记录盖章卡、幽灵、所在楼层墙面的真实几何。 */
async function celebrate(page: Page, memo?: string): Promise<Frame[]> {
  await ready(page);
  await create(page, 'Secret plan');
  const ghost = ghosts(page).first();
  await openGhost(ghost);
  await setCriteria(page, 'Done looks like this');
  await addStep(page, 'One');
  await card(page).getByRole('checkbox').nth(0).check();
  await expect(ghost).toHaveAttribute('data-pending', 'true');
  await expect(ghost).not.toHaveAttribute('data-chore', /.*/, { timeout: 5000 });
  await card(page).getByRole('button', { name: 'Confirm complete' }).click();
  const dialog = page.getByRole('dialog');
  if (memo) await dialog.getByRole('textbox').fill(memo);
  await page.evaluate(() => {
    const frames: unknown[] = [];
    (window as unknown as { __frames: unknown[] }).__frames = frames;
    const rect = (el: Element) => {
      const b = el.getBoundingClientRect();
      return [b.left, b.top, b.right, b.bottom];
    };
    const tick = () => {
      const c = document.querySelector('.stamp-page') as HTMLElement | null;
      const body = document.querySelector('.celebration-ghost .ghost-body');
      const floor = document.querySelector('.static-layer [data-module="floor-01"]');
      if (c && body && floor && c.style.visibility === 'visible') {
        const seal = c.querySelector('.stamp-seal') as SVGElement | null;
        const sr = seal?.getBoundingClientRect();
        frames.push({
          card: rect(c),
          floor: rect(floor),
          scale: floor.getBoundingClientRect().width / 801,
          viewport: [innerWidth, innerHeight],
          body: rect(body),
          hands: [...document.querySelectorAll('.celebration-ghost .ghost-hand ellipse')].map(rect),
          eyes: rect(document.querySelector('.celebration-ghost .ghost-eyes')!),
          text: (c.querySelector('.stamp-text') as HTMLElement).innerText,
          memo: (c.querySelector('.stamp-memo') as HTMLElement | null)?.innerText ?? null,
          sealOpacity: seal ? Number(getComputedStyle(seal).opacity) : 0,
          sealSize: sr ? Math.min(sr.width, sr.height) : 0,
          sealStroke: seal ? getComputedStyle(seal.querySelector('circle')!).stroke : '',
          sealPaths: seal ? seal.querySelectorAll('circle,path').length : 0,
          visibility: c.style.visibility,
        });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await dialog.getByRole('button', { name: 'Confirm complete' }).click();
  await expect(page.locator('.celebration')).toHaveAttribute('data-phase', 'stamp', { timeout: 5000 });
  await expect(page.locator('.celebration')).toHaveAttribute('data-phase', 'fly', { timeout: 4000 });
  return page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);
}

type B = [number, number, number, number];
const intersects = (a: B, b: B) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

for (const width of [1280, 320]) {
  test(`盖章卡（${width} 宽）：在幽灵身边（它站在小舞台上），不压脸不越界，文案是那句圆满，卡上真实留下章印`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    const frames = await celebrate(page, 'So proud');
    expect(frames.length).toBeGreaterThan(5);
    // 确认时它站在抽屉上沿的小舞台上，卡片就放在它身边：整张在视口里，也在旧宅舞台里
    for (const f of frames) {
      expect(f.card[2] - f.card[0]).toBeGreaterThan(60);
      expect(f.card[0]).toBeGreaterThanOrEqual(0);
      expect(f.card[2]).toBeLessThanOrEqual(f.viewport[0]);
      expect(f.card[1]).toBeGreaterThanOrEqual(0);
      expect(intersects(f.card, f.body)).toBe(false);
      expect(intersects(f.card, f.eyes)).toBe(false);
      for (const h of f.hands) expect(intersects(f.card, h as B)).toBe(false);
      expect(f.text).toMatch(/^A little ghost, complete on \d{4}-\d{2}-\d{2}$/);
      expect(f.text).not.toContain('Steps');
      expect(f.text).not.toContain('Secret plan');
      expect(f.memo).toBe('So proud');
    }
    // 章落下后，卡上留下可见的章印：完全不透明、有尺寸、是 SVG 图形
    const inked = frames.filter((f) => f.sealOpacity >= 0.99);
    expect(inked.length).toBeGreaterThan(2);
    for (const f of inked) {
      expect(f.sealSize).toBeGreaterThanOrEqual(width === 320 ? 22 : 30);
      expect(f.sealPaths).toBeGreaterThanOrEqual(3);
      expect(f.sealStroke).not.toBe('none');
    }
  });
}

test('盖章卡：减少动态下直接显示，章印同样可见，没有章落下的动作与星星', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 320, height: 900 } });
  const page = await context.newPage();
  await ready(page);
  await create(page, 'Quiet plan');
  const ghost = ghosts(page).first();
  await openGhost(ghost);
  await setCriteria(page, 'Done');
  await addStep(page, 'One');
  await card(page).getByRole('checkbox').nth(0).check();
  await card(page).getByRole('button', { name: 'Confirm complete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm complete' }).click();
  const stamp = page.locator('.stamp-page');
  await expect(stamp).toBeVisible();
  await expect(stamp.locator('.stamp-seal')).toBeVisible();
  expect(await stamp.locator('.stamp-seal').evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
  expect(await stamp.locator('.stamp-tool').evaluate((el) => getComputedStyle(el).display)).toBe('none');
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await context.close();
});
