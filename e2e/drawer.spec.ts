import { expect, test, type Locator, type Page } from '@playwright/test';
import { addStep, card, create, ghosts, openGhost, ready, setCriteria } from './helpers/app';

const moduleCount = (page: Page) => page.locator('.static-layer [data-module]').count();

async function rects(page: Page, ghost: Locator) {
  const g = (await ghost.boundingBox())!;
  const d = (await card(page).boundingBox())!;
  const vh = await page.evaluate(() => window.innerHeight);
  return { g, d, vh };
}

/** 被选中的 Ghost（含它下面的步数小标签）完整露在抽屉上方的可视区。 */
async function expectAboveDrawer(page: Page, ghost: Locator) {
  await expect
    .poll(async () => {
      const { g, d } = await rects(page, ghost);
      return g.y >= 0 && g.y + g.height <= d.y && g.height > 0;
    }, { timeout: 5000 })
    .toBe(true);
}

test('首页初始层数：空房与前两位住客只有门厅 + 一层住宅 + 屋顶；3/5/7/9 位时各长一层', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  expect(await moduleCount(page)).toBe(3);
  const expected = [3, 3, 4, 4, 5, 5, 6, 6, 7, 7];
  for (let n = 1; n <= 10; n++) {
    await create(page, `Task ${n}`);
    await expect(ghosts(page)).toHaveCount(n);
    expect(await moduleCount(page), `${n} 位住客`).toBe(expected[n - 1]);
  }
  // 第三、四位住在三楼
  await expect(page.locator('[data-ghost][data-floor="3"]')).toHaveCount(2);
});

for (const [width, height] of [[1280, 720], [320, 640]] as const) {
  test(`抽屉（${width} 宽）：从底部滑出、不遮住被选中的 Ghost、100% 缩放`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await ready(page);
    await create(page, 'Sort the photos');
    await create(page, 'Call the bank');
    await expect(page.locator('.ghost-enter')).toHaveCount(0);

    await openGhost(ghosts(page).first());
    await expect(card(page)).toBeVisible();
    await expectAboveDrawer(page, ghosts(page).first());

    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);

    const style = await card(page).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { position: cs.position, backdrop: cs.backdropFilter || cs.getPropertyValue('-webkit-backdrop-filter'), bg: cs.backgroundColor, radius: cs.borderTopLeftRadius };
    });
    expect(style.position).toBe('fixed');
    expect(style.backdrop).toContain('blur');
    expect(style.bg).toMatch(/rgba\(/); // 半透明
    expect(parseFloat(style.radius)).toBeGreaterThanOrEqual(16);

    await expect.poll(async () => (await rects(page, ghosts(page).first())).d.y + (await rects(page, ghosts(page).first())).d.height).toBeLessThanOrEqual(height);
    const { d, vh } = await rects(page, ghosts(page).first());
    expect(d.width).toBeLessThanOrEqual(761);
    expect(d.height).toBeLessThanOrEqual(vh * 0.58 + 1);
    expect(d.y + d.height).toBeGreaterThan(vh - 20); // 贴着底部
    if (width === 1280) {
      expect(Math.abs(d.x + d.width / 2 - width / 2)).toBeLessThanOrEqual(2); // 宽屏居中
    } else {
      expect(d.x).toBeLessThanOrEqual(10); // 窄屏贴近两侧
      expect(width - (d.x + d.width)).toBeLessThanOrEqual(10);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    // 选另一只：同样露在抽屉上方
    await openGhost(ghosts(page).nth(1));
    await expectAboveDrawer(page, ghosts(page).nth(1));
  });
}

test('抽屉内部滚动：很多步骤时抽屉不超过 58dvh，滚动发生在抽屉里，页面不动', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await ready(page);
  await create(page, 'Big job');
  const ghost = ghosts(page).first();
  await openGhost(ghost);
  await setCriteria(page, 'Everything is sorted');
  for (let i = 1; i <= 12; i++) await addStep(page, `Step number ${i}`);
  await expectAboveDrawer(page, ghost);

  const { d, vh } = await rects(page, ghost);
  expect(d.height).toBeLessThanOrEqual(vh * 0.58 + 1);
  const scroller = card(page).locator('.card-scroll');
  const m = await scroller.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  expect(m.sh).toBeGreaterThan(m.ch);
  const before = await page.evaluate(() => window.scrollY);
  await scroller.evaluate((el) => (el.scrollTop = el.scrollHeight));
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  const after = (await card(page).boundingBox())!;
  expect(Math.abs(after.y - d.y)).toBeLessThanOrEqual(1);
  // 标题与关闭按钮始终留在抽屉里
  await expect(card(page).getByRole('button', { name: 'Close' })).toBeInViewport();
});

test('住满九位：低楼层与高楼层的 Ghost 被选中后都完整露在抽屉上方（1280×720）', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await ready(page);
  for (let i = 1; i <= 9; i++) await create(page, `Task ${i}`);
  const low = ghosts(page).first();
  await low.scrollIntoViewIfNeeded();
  await openGhost(low);
  await expectAboveDrawer(page, low);
  const high = ghosts(page).nth(8);
  await high.scrollIntoViewIfNeeded();
  await openGhost(high);
  await expectAboveDrawer(page, high);
  // 关闭后焦点回到原 Ghost
  await card(page).getByRole('button', { name: 'Close' }).click();
  await expect(high).toBeFocused();
  await expect(card(page)).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.night-sky')!).paddingBottom))
    .toBe('8px');
});

test('Reduced Motion：抽屉与露出 Ghost 的滚动都是即时的，没有动画', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 600 });
  await ready(page);
  for (let i = 1; i <= 9; i++) await create(page, `Task ${i}`);
  const low = ghosts(page).first();
  await low.scrollIntoViewIfNeeded();
  await openGhost(low);
  await expectAboveDrawer(page, low);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  const behavior = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
  expect(behavior).not.toBe('smooth');
});

test('Ghost 热区不小于 44×44；视觉上比第一版小，眼睛更大', async ({ page }) => {
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await ready(page);
    await create(page, `Small ${width}`);
    await expect(page.locator('.ghost-enter')).toHaveCount(0);
    const ghost = ghosts(page).first();
    const box = (await ghost.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    const m = await ghost.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const body = el.querySelector('.ghost-body')!.getBoundingClientRect();
      const eye = el.querySelector('.ghost-eyes ellipse')!.getBoundingClientRect();
      return { bw: b.width, bodyW: body.width, bodyH: body.height, eyeH: eye.height };
    });
    // 第一版 Gray 身体宽 = 112/140 × 0.9 ≈ 0.72 的容器宽；现在应更小
    expect(m.bodyW / m.bw).toBeLessThan(0.72);
    expect(m.eyeH / m.bodyH).toBeGreaterThan(0.14);
    await page.reload();
  }
});

test('四态颜色与光晕：Gray → White → Green → Pending → Gold', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await ready(page);
  await create(page, 'Colours');
  const ghost = ghosts(page).first();
  const fill = () => ghost.locator('.ghost-body').getAttribute('fill');
  const glow = async () => Number(await ghost.locator('radialGradient stop').first().getAttribute('stop-opacity'));
  expect(await fill()).toBe('#B8C1CB');
  expect(await glow()).toBe(0);
  await openGhost(ghost);
  await setCriteria(page, 'Looks tidy');
  await addStep(page, 'One');
  await addStep(page, 'Two');
  await expect.poll(fill).toBe('#F6F1E4');
  const white = await glow();
  expect(white).toBeGreaterThanOrEqual(0.3);
  await card(page).getByRole('checkbox').first().check();
  await expect.poll(fill).toMatch(/^hsl\(106, /);
  const green = await glow();
  expect(green).toBeGreaterThan(white - 0.05);
  await card(page).getByRole('checkbox').nth(1).check();
  await expect(ghost.locator('.ghost-ring')).toHaveCount(1);
  expect(await glow()).toBeGreaterThan(green);
  await card(page).getByRole('button', { name: 'Confirm complete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm complete' }).click();
  await expect(page.locator('.celebration-ghost .ghost-body')).toHaveAttribute('fill', '#F2D27E');
});
