import { expect, test, type Locator, type Page } from '@playwright/test';
import { addStep, card, create, ghosts, openGhost, ready, setCriteria } from './helpers/app';

// 抽屉上沿的小舞台：被选中的 Ghost 本体（同一个 DOM 元素）飞到抽屉上沿正中，关闭沿原路飞回。

const homeBox = (ghost: Locator) =>
  ghost.evaluate((el) => {
    const r = el.parentElement!.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

async function drawerTop(page: Page) {
  const d = (await card(page).boundingBox())!;
  return { top: d.y, cx: d.x + d.width / 2 };
}

async function expectOnStage(page: Page, ghost: Locator) {
  await expect
    .poll(
      async () => {
        const g = (await ghost.boundingBox())!;
        const d = await drawerTop(page);
        return Math.abs(g.x + g.width / 2 - d.cx) <= 2 && g.y + g.height <= d.top + 0.5 && g.y + g.height >= d.top - 3 && g.y >= 0;
      },
      { timeout: 4000 },
    )
    .toBe(true);
}

async function expectAtHome(ghost: Locator) {
  await expect
    .poll(
      async () => {
        const g = (await ghost.boundingBox())!;
        const h = await homeBox(ghost);
        return Math.abs(g.x - h.x) < 1.5 && Math.abs(g.y - h.y) < 1.5;
      },
      { timeout: 4000 },
    )
    .toBe(true);
}

test('选中：本体飞到抽屉上沿正中，屋里没有第二只；元素和焦点引用不变', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await ready(page);
  await create(page, 'One');
  await create(page, 'Two');
  await expect(page.locator('.ghost-enter')).toHaveCount(0);
  const first = ghosts(page).first();
  const handle = await first.elementHandle();
  await openGhost(first);
  await expectOnStage(page, first);
  // 唯一：全页仍然只有两个 Ghost 按钮、两个读屏按钮，没有复制品、没有影子
  await expect(ghosts(page)).toHaveCount(2);
  await expect(page.getByRole('list', { name: 'Residents' }).getByRole('button')).toHaveCount(2);
  await expect(page.locator('.ghost-sprite')).toHaveCount(2);
  await expect(page.locator('[data-staged]')).toHaveCount(1);
  // 同一个元素
  expect(await first.evaluate((el, h) => el === h, handle)).toBe(true);
  // 舞台不压住抽屉的标题与按钮
  const g = (await first.boundingBox())!;
  for (const b of await card(page).getByRole('button').all()) {
    const r = (await b.boundingBox())!;
    expect(r.y >= g.y + g.height - 0.5 || r.y + r.height <= g.y || r.x >= g.x + g.width || r.x + r.width <= g.x).toBe(true);
  }
  const head = (await card(page).getByRole('heading').first().boundingBox())!;
  expect(head.y).toBeGreaterThanOrEqual(g.y + g.height - 0.5);
});

test('舞台上勾选家务、擦除、表情、柔光照常；关闭沿原路回到选中前的位置，焦点回到同一个按钮', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await ready(page);
  await create(page, 'Chores');
  const ghost = ghosts(page).first();
  await openGhost(ghost);
  await setCriteria(page, 'Done looks like this');
  await addStep(page, 'a');
  await addStep(page, 'b');
  await expectOnStage(page, ghost);
  const before = await ghost.boundingBox();

  await card(page).getByRole('checkbox').nth(0).check();
  await expect(ghost).toHaveAttribute('data-chore', 'sweep');
  await expect(ghost.locator('.ghost-prop rect').first()).toBeVisible();
  await expect(ghost.locator('.ghost-eyes')).toHaveAttribute('data-expression', 'focused');
  await expect(ghost.locator('.ghost-halo')).toBeVisible();
  const during = await ghost.boundingBox();
  expect(Math.abs(during!.x - before!.x)).toBeLessThan(1); // 家务在原地演，不在屋里挪动
  expect(Math.abs(during!.y - before!.y)).toBeLessThan(1);
  await expect(ghost).not.toHaveAttribute('data-chore', /.*/, { timeout: 4000 });
  await card(page).getByRole('checkbox').nth(0).uncheck();
  await expect(ghost).toHaveAttribute('data-anim', 'erase');
  await expect(ghost.locator('.ghost-eyes')).toHaveAttribute('data-expression', 'puzzled');
  await expect(ghost).toHaveAttribute('data-anim', 'none', { timeout: 3000 });
  await expectOnStage(page, ghost);

  await card(page).getByRole('button', { name: 'Close' }).click();
  await expect(card(page)).toHaveCount(0);
  await expectAtHome(ghost);
  await expect(page.locator('[data-staged]')).toHaveCount(0);
  expect(await ghost.evaluate((el) => (el as HTMLElement).style.transform)).toBe('');
  await expect(ghost).toBeFocused();
});

test('改选：旧的飞回、新的飞来，任何时刻舞台上只有一份；稳定后只有新的在舞台上', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await ready(page);
  await create(page, 'A');
  await create(page, 'B');
  await expect(page.locator('.ghost-enter')).toHaveCount(0);
  const a = ghosts(page).first();
  const b = ghosts(page).nth(1);
  await openGhost(a);
  await expectOnStage(page, a);
  await openGhost(b);
  await expectOnStage(page, b);
  await expectAtHome(a);
  await expect(page.locator('[data-staged]')).toHaveCount(1);
  await expect(ghosts(page)).toHaveCount(2);
});

test('快速开关与改选：最后落在正确的位置，没有残留的舞台标记或动画', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await ready(page);
  await create(page, 'A');
  await create(page, 'B');
  await expect(page.locator('.ghost-enter')).toHaveCount(0);
  const a = ghosts(page).first();
  const b = ghosts(page).nth(1);
  for (let i = 0; i < 4; i++) {
    await a.dispatchEvent('click');
    await page.waitForTimeout(80);
    await b.dispatchEvent('click');
    await page.waitForTimeout(60);
    await page.evaluate(() => (document.querySelector('.card-close') as HTMLElement | null)?.click());
    await page.waitForTimeout(70);
  }
  await expect(card(page)).toHaveCount(0);
  await expectAtHome(a);
  await expectAtHome(b);
  await expect(page.locator('[data-staged]')).toHaveCount(0);
  for (const g of [a, b]) expect(await g.evaluate((el) => (el as HTMLElement).style.transform)).toBe('');
  await a.dispatchEvent('click');
  await expectOnStage(page, a);
  await expect(page.locator('[data-staged]')).toHaveCount(1);
});

test('窗口变化：舞台上的 Ghost 跟着抽屉走；页面滚动时仍站在抽屉上沿', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await ready(page);
  await create(page, 'Resize');
  const ghost = ghosts(page).first();
  await openGhost(ghost);
  await expectOnStage(page, ghost);
  await page.setViewportSize({ width: 900, height: 700 });
  await expectOnStage(page, ghost);
  await page.setViewportSize({ width: 360, height: 640 });
  await expectOnStage(page, ghost);
  await page.evaluate(() => window.scrollBy(0, 120));
  await expectOnStage(page, ghost);
  await expect(page.locator('[data-staged]')).toHaveCount(1);
});

test('视口太矮放不下舞台：Ghost 留在屋里，退回“滚动露出”的兜底', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 330 });
  await ready(page);
  await create(page, 'Short');
  const ghost = ghosts(page).first();
  await openGhost(ghost);
  await expect(card(page)).toBeVisible();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-staged]')).toHaveCount(0);
  await expectAtHome(ghost);
});

test('页面隐藏：飞行直接推进到终点，没有残留动画；回来后位置正确', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await ready(page);
  await create(page, 'Hidden');
  const ghost = ghosts(page).first();
  await ghost.dispatchEvent('click');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.effect && (a.effect as KeyframeEffect).target?.classList.contains('ghost-button')).length))
    .toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expectOnStage(page, ghost);
});

test('减少动态：选中瞬移到舞台，关闭瞬移回去，没有任何位移动画', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await ready(page);
  await create(page, 'Quiet');
  const ghost = ghosts(page).first();
  await ghost.dispatchEvent('click');
  await expect(card(page)).toBeVisible();
  await expectOnStage(page, ghost);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await card(page).getByRole('button', { name: 'Close' }).click();
  await expect(card(page)).toHaveCount(0);
  await expectAtHome(ghost);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await context.close();
});

test('确认完成：从舞台上的实际位置起飞，准确飞到门厅的书，随后舞台与屋里都没有它', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await ready(page);
  await create(page, 'Leave');
  const ghost = ghosts(page).first();
  await openGhost(ghost);
  await setCriteria(page, 'Done');
  await addStep(page, 'one');
  await card(page).getByRole('checkbox').nth(0).check();
  await expect(ghost).toHaveAttribute('data-pending', 'true');
  await expect(ghost).not.toHaveAttribute('data-chore', /.*/, { timeout: 4000 });
  await expectOnStage(page, ghost);
  const g = (await ghost.boundingBox())!;
  const stagePoint = { x: g.x + g.width / 2, y: g.y + g.height };
  await page.evaluate(() => {
    const frames: { phase: string; box: number[]; star: number[] | null }[] = [];
    (window as unknown as { __f: typeof frames }).__f = frames;
    const tick = () => {
      const f = document.querySelector('.celebration-ghost');
      const c = document.querySelector('.celebration');
      if (f && c) {
        const r = f.getBoundingClientRect();
        const s = f.querySelector('.fly-star')?.getBoundingClientRect();
        frames.push({ phase: c.getAttribute('data-phase')!, box: [r.left, r.top, r.width, r.height], star: s ? [s.left + s.width / 2, s.top + s.height / 2] : null });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await card(page).getByRole('button', { name: 'Confirm complete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm complete' }).click();
  await expect(page.locator('.celebration')).toHaveAttribute('data-phase', 'stamp', { timeout: 5000 });
  await expect(page.locator('.celebration')).toHaveAttribute('data-phase', 'fly', { timeout: 4000 });
  await expect(page.locator('.celebration')).toHaveCount(0, { timeout: 4000 });
  const frames = await page.evaluate(() => (window as unknown as { __f: { phase: string; box: number[]; star: number[] | null }[] }).__f);
  const gold = frames.find((f) => f.phase === 'gold')!;
  // 演出从舞台上的实际位置开始（盒子的底边中点）
  // （抽屉收起后页面底部的留白也收起，页面可能回弹几个像素，所以允许 8 像素的误差）
  expect(Math.abs(gold.box[0]! + gold.box[2]! / 2 - stagePoint.x)).toBeLessThan(8);
  expect(Math.abs(gold.box[1]! + gold.box[3]! - stagePoint.y)).toBeLessThan(8);
  // 飞到书：最后几帧里星星的中心靠近书的中心（书的热区取中心）
  const book = await page.evaluate(() => {
    const r = document.querySelector('.archive-book')!.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  });
  const flying = frames.filter((f) => f.phase === 'fly' && f.star);
  const last = flying[flying.length - 1]!.star!;
  expect(Math.hypot(last[0]! - book[0]!, last[1]! - book[1]!)).toBeLessThan(40);
  await expect(ghosts(page)).toHaveCount(0);
  await expect(page.locator('[data-staged]')).toHaveCount(0);
  await expect(page.locator('.ghost-sprite')).toHaveCount(0);
});

test('删除（搬走）：舞台上不留任何东西', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await ready(page);
  await create(page, 'Bye');
  await create(page, 'Stay');
  await expect(page.locator('.ghost-enter')).toHaveCount(0);
  await openGhost(ghosts(page).first());
  await expectOnStage(page, ghosts(page).first());
  await card(page).getByRole('button', { name: 'Say goodbye' }).click();
  await page.getByRole('dialog').getByRole('button').first().click();
  await expect(ghosts(page)).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator('[data-staged]')).toHaveCount(0);
  await expect.poll(() => page.locator('.residents-leaving .ghost-sprite').count(), { timeout: 5000 }).toBe(0);
  await expect(page.locator('.ghost-sprite')).toHaveCount(1);
});
