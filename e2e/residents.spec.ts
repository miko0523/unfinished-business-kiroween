import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { card, create, ghosts, openGhost, ready, titleInput } from './helpers/app';

const R15 = /显示文案“(The house is full\.[^”]*)”/.exec(readFileSync('.kiro/specs/unfinished-business/requirements.md', 'utf8'))![1]!;
const SAY_GOODBYE_OPEN = 'Say goodbye';

const residentsList = (page: Page) => page.getByRole('list', { name: 'Residents' });

/** 页面坐标（含滚动）。 */
const pageBox = (loc: ReturnType<Page['locator']>) =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
  });

async function createMany(page: Page, n: number) {
  for (let i = 1; i <= n; i++) await create(page, `Task ${i}`);
  await expect(ghosts(page)).toHaveCount(n);
}

test('10 只住满后第 11 次：温柔提示（原文）、草稿保留；去看看住客 → 焦点在列表，再 Tab 依次是楼层从高到低、同层从左到右', async ({ page }) => {
  await ready(page);
  await createMany(page, 10);
  await create(page, 'The eleventh');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#full-house-text')).toHaveText(R15);
  await expect(titleInput(page)).toHaveValue('The eleventh');
  await expect(ghosts(page)).toHaveCount(10);

  await dialog.getByRole('button', { name: 'Visit residents' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(residentsList(page)).toBeFocused();
  await expect(titleInput(page)).toHaveValue('The eleventh');

  const seen: string[] = [];
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    seen.push(await page.evaluate(() => `${document.activeElement?.getAttribute('data-floor')}:${document.activeElement?.getAttribute('data-slot')}`));
  }
  expect(seen).toEqual(['6:0', '6:1', '5:0', '5:1', '4:0', '4:1', '3:0', '3:1', '2:0', '2:1']);
});

test('“Come back later”：只关闭提示，草稿还在；腾出一个家后，同一份草稿可以入住', async ({ page }) => {
  await ready(page);
  await createMany(page, 10);
  await create(page, 'Waiting at the door');
  await page.getByRole('dialog').getByRole('button', { name: 'Come back later' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(titleInput(page)).toHaveValue('Waiting at the door');
  await expect(ghosts(page)).toHaveCount(10);

  // 让 Task 5（二楼右 / 三楼…）搬走，空出它的家
  const target = page.locator('[data-ghost][aria-label*="Task 5"]');
  const floor = await target.getAttribute('data-floor');
  const side = await target.getAttribute('data-slot');
  await openGhost(target);
  await card(page).getByRole('button', { name: SAY_GOODBYE_OPEN }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Wave goodbye', exact: true }).click();
  await expect(ghosts(page)).toHaveCount(9);
  await expect(titleInput(page)).toBeFocused();
  await page.getByRole('button', { name: 'Welcome a little ghost' }).click();
  await expect(ghosts(page)).toHaveCount(10);
  const fresh = page.locator('[data-ghost][aria-label*="Waiting at the door"]');
  await expect(fresh).toHaveAttribute('data-floor', floor!);
  await expect(fresh).toHaveAttribute('data-slot', side!);
  await expect(titleInput(page)).toHaveValue('');
});

test('语义结构：Residents → 每个有住客的楼层一项（有名称）→ 内层列表 → Ghost 按钮；不复制按钮', async ({ page }) => {
  await ready(page);
  await createMany(page, 5);
  const top = residentsList(page);
  await expect(top.locator(':scope > li')).toHaveCount(3);
  await expect(top.getByRole('listitem', { name: 'Floor 4' })).toHaveCount(1);
  await expect(top.getByRole('listitem', { name: 'Floor 3' })).toHaveCount(1);
  await expect(top.getByRole('listitem', { name: 'Floor 2' })).toHaveCount(1);
  expect(await top.locator('button').count()).toBe(5);
  expect(await page.locator('button[data-ghost]').count()).toBe(5);
  expect(await top.locator(':scope > li > ul > li > button').count()).toBe(5);
  // 每个楼层名对应的内层列表里恰有应有的 Ghost
  expect(await top.getByRole('listitem', { name: 'Floor 2' }).locator('button').count()).toBe(2);
  expect(await top.getByRole('listitem', { name: 'Floor 4' }).locator('button').count()).toBe(1);
});

test('楼长高：第 3 / 5 / 7 / 9 只入住时屋顶相对门厅上移、新楼层在屏幕上可见、Ghost 在自己那层里；只升不降', async ({ page }) => {
  await ready(page);
  const module = (id: string) => page.locator(`.static-layer [data-module="${id}"]`);
  const span = async () => (await pageBox(module('lobby'))).y - (await pageBox(module('roof'))).y;
  const grewAt: Record<number, string> = { 3: 'floor-02', 5: 'floor-03', 7: 'floor-04', 9: 'floor-05' };
  let before = await span();
  let floors = 1;
  const width = page.viewportSize()!.width;
  for (let n = 1; n <= 9; n++) {
    await create(page, `Task ${n}`);
    await expect(ghosts(page)).toHaveCount(n);
    // 此处核对最终布局：等长楼动画（≤1s）收口后再量
    await expect(page.locator('.house')).not.toHaveAttribute('data-growing', 'true');
    const now = await span();
    const newFloor = grewAt[n];
    if (newFloor) {
      floors += 1;
      // 屋顶相对门厅上移；新楼层在下一层的正上方，完整在屏幕之内
      expect(now).toBeGreaterThan(before + 100);
      const newest = await pageBox(module(newFloor));
      const below = await pageBox(module(`floor-0${floors - 1}`));
      expect(newest.y).toBeLessThan(below.y);
      expect(newest.y).toBeGreaterThanOrEqual(0);
      expect(newest.h).toBeGreaterThan(100);
      expect(newest.x).toBeGreaterThanOrEqual(0);
      expect(newest.x + newest.w).toBeLessThanOrEqual(width);
      const roof = await pageBox(module('roof'));
      expect(roof.y + roof.h).toBeLessThanOrEqual(newest.y + newest.h);
    } else {
      expect(Math.abs(now - before)).toBeLessThan(1);
    }
    before = now;
    await expect(page.locator('.house')).toHaveAttribute('data-grown-floors', String(floors + 1));
    await expect(page.locator('.static-layer [data-module^="floor-"]')).toHaveCount(floors);
  }

  // 每只 Ghost 在它自己那层里
  for (let n = 1; n <= 9; n++) {
    const g = page.locator(`[data-ghost][aria-label*="Task ${n},"]`);
    const floor = Number(await g.getAttribute('data-floor'));
    const m = await pageBox(module(`floor-0${floor - 1}`));
    const b = await pageBox(g);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    expect(cx).toBeGreaterThanOrEqual(m.x);
    expect(cx).toBeLessThanOrEqual(m.x + m.w);
    expect(cy).toBeGreaterThanOrEqual(m.y);
    expect(cy).toBeLessThanOrEqual(m.y + m.h);
  }

  // 只升不降：全部搬走，楼层不塌回
  for (let i = 0; i < 9; i++) {
    await openGhost(ghosts(page).first());
    await card(page).getByRole('button', { name: SAY_GOODBYE_OPEN }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Wave goodbye', exact: true }).click();
    await expect(ghosts(page)).toHaveCount(8 - i);
  }
  await expect(page.locator('.house')).toHaveAttribute('data-grown-floors', '6');
  await expect(page.locator('.static-layer [data-module^="floor-"]')).toHaveCount(5);
});

test('Reduced Motion：第 3 只入住直接是最终布局，没有动画', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await createMany(page, 3);
  await expect(page.locator('.house')).toHaveAttribute('data-grown-floors', '3');
  await expect(page.locator('.static-layer [data-module="floor-02"]')).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('搬走：中性的话；不进纪念册；室友的数据与位置不变；刷新后不会回来；空出的家立即可用', async ({ page }) => {
  await ready(page);
  await create(page, 'Going away');
  await create(page, 'Staying put');
  const leaver = page.locator('[data-ghost][aria-label*="Going away"]');
  const mate = page.locator('[data-ghost][aria-label*="Staying put"]');
  const homeFloor = await leaver.getAttribute('data-floor');
  const homeSlot = await leaver.getAttribute('data-slot');
  await expect(page.locator('.ghost-enter')).toHaveCount(0);

  await openGhost(leaver);
  await card(page).getByRole('button', { name: SAY_GOODBYE_OPEN }).click();
  const dialog = page.getByRole('dialog');
  const text = (await dialog.innerText()).toLowerCase();
  expect(text).not.toMatch(/give up|fail|abandon|quit|放弃|失败/);
  expect(text).toContain('suitcase');
  const mateNameBefore = await mate.getAttribute('aria-label');
  await dialog.getByRole('button', { name: 'Wave goodbye', exact: true }).click();

  // 离场演员出现，不是控件；住客列表里立刻只剩室友
  await expect(page.locator('.residents-leaving .is-leaving')).toHaveCount(1);
  await expect(page.locator('.residents-leaving button')).toHaveCount(0);
  await expect(ghosts(page)).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveText('The little ghost packed its suitcase and moved out quietly.');
  expect(await mate.getAttribute('aria-label')).toBe(mateNameBefore);

  // 搬走期间（约 1.5 秒）室友停在原地一动不动
  const still1 = await pageBox(mate);
  await page.waitForTimeout(900);
  const still2 = await pageBox(mate);
  expect(Math.abs(still1.x - still2.x)).toBeLessThan(1);
  expect(Math.abs(still1.y - still2.y)).toBeLessThan(1);

  // 离场演员与室友全程不重叠（用身体盒）
  const actorBox = await page.locator('.residents-leaving .is-leaving').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left, r: r.right, t: r.top, b: r.bottom };
  }).catch(() => null);
  if (actorBox) {
    const m = await mate.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom };
    });
    const w = (b: { l: number; r: number }) => b.r - b.l;
    const body = (b: { l: number; r: number; t: number; b: number }) => ({ l: b.l + (w(b) * 14) / 140, r: b.l + (w(b) * 126) / 140, t: b.b - ((b.b - b.t) * 137) / 180, b: b.b });
    const A = body(actorBox);
    const B = body(m);
    expect(A.r <= B.l || B.r <= A.l || A.b <= B.t || B.b <= A.t).toBe(true);
  }

  await expect(page.locator('.residents-leaving .is-leaving')).toHaveCount(0, { timeout: 3000 });

  // 空出的家立即可用：下一只就住进去
  await create(page, 'Next guest');
  const next = page.locator('[data-ghost][aria-label*="Next guest"]');
  await expect(next).toHaveAttribute('data-floor', homeFloor!);
  await expect(next).toHaveAttribute('data-slot', homeSlot!);

  // 纪念册还是空的；没有纪念
  await page.goto('/#/archive');
  await expect(page.getByText('The keepsake book is waiting, wide open.')).toBeVisible();
  await expect(page.locator('.warm-lamp')).toHaveCount(0);

  // 刷新后搬走的不会回来
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('[data-ghost]').length > 0);
  const names = await ghosts(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(names.some((n) => n!.includes('Going away'))).toBe(false);
  expect(names.some((n) => n!.includes('Staying put'))).toBe(true);
  expect(names.some((n) => n!.includes('Next guest'))).toBe(true);
});

test('搬走与新住客并发：新住客先不露面，约 1.5 秒后才走进来；全程不与室友重叠', async ({ page }) => {
  await ready(page);
  await create(page, 'Leaver');
  await create(page, 'Mate');
  await expect(page.locator('.ghost-enter')).toHaveCount(0);
  await openGhost(page.locator('[data-ghost][aria-label*="Leaver"]'));
  await card(page).getByRole('button', { name: SAY_GOODBYE_OPEN }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Wave goodbye', exact: true }).click();
  await create(page, 'Newcomer');
  const newcomer = page.locator('[data-ghost][aria-label*="Newcomer"]');
  await expect(page.locator('li.resident[data-waiting="true"]')).toHaveCount(1);
  await expect(newcomer).toBeHidden(); // 看不见，也不可操作
  await expect(page.locator('li.resident[data-waiting="true"]')).toHaveCount(0, { timeout: 4000 });
  await expect(newcomer).toBeVisible();
  // 之后两只照常活动，不重叠
  for (let i = 0; i < 20; i++) {
    const boxes = await ghosts(page).evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        const w = r.width;
        const h = r.height;
        return { l: r.left + (w * 14) / 140, r: r.left + (w * 126) / 140, t: r.bottom - (h * 137) / 180, b: r.bottom };
      }),
    );
    const [a, b] = boxes as [(typeof boxes)[0], (typeof boxes)[0]];
    expect(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t).toBe(true);
    await page.waitForTimeout(150);
  }
});

test('Reduced Motion 的搬走：直接移除并播报；室友的 bounding box 与数据逐像素不变；没有离场演员', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await create(page, 'Going');
  await create(page, 'Staying');
  const mate = page.locator('[data-ghost][aria-label*="Staying"]');
  const before = await pageBox(mate);
  const nameBefore = await mate.getAttribute('aria-label');
  await openGhost(page.locator('[data-ghost][aria-label*="Going"]'));
  await card(page).getByRole('button', { name: SAY_GOODBYE_OPEN }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Wave goodbye', exact: true }).click();
  await expect(ghosts(page)).toHaveCount(1);
  await expect(page.locator('.residents-leaving')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('The little ghost packed its suitcase and moved out quietly.');
  expect(await pageBox(mate)).toEqual(before);
  expect(await mate.getAttribute('aria-label')).toBe(nameBefore);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await create(page, 'Right away');
  await expect(page.locator('li.resident[data-waiting="true"]')).toHaveCount(0);
  await expect(page.locator('[data-ghost][aria-label*="Right away"]')).toBeVisible();
});

test('示例里同样可用：满员提示与搬走都带着 Exit demo；退出后真实数据原样回来', async ({ page }) => {
  await ready(page);
  await create(page, 'Real one');
  await page.getByRole('button', { name: 'Try sample' }).click();
  for (let i = 0; i < 9; i++) await create(page, `Demo ${i}`);
  await expect(ghosts(page)).toHaveCount(10);
  await create(page, 'Too many');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Exit demo' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Come back later' }).click();
  await openGhost(page.locator('[data-ghost][aria-label*="Demo 3"]'));
  await card(page).getByRole('button', { name: SAY_GOODBYE_OPEN }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Exit demo' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Wave goodbye', exact: true }).click();
  await expect(ghosts(page)).toHaveCount(9);
  await page.locator('.demo-bar').getByRole('button', { name: 'Exit demo' }).click();
  await expect(ghosts(page)).toHaveCount(1);
  await expect(ghosts(page).first()).toHaveAttribute('aria-label', /Real one/);
});
