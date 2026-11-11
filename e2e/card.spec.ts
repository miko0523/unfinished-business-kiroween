import { expect, test, type Page } from '@playwright/test';
import { addStep, card, create, ghosts, openGhost, ready, saturation, setCriteria, criteriaEdit, criteriaField } from './helpers/app';

async function pendingGhost(page: Page, steps: string[]) {
  await create(page, 'Sort the photos');
  const ghost = ghosts(page).first();
  await openGhost(ghost);
  await setCriteria(page, 'One album per year');
  for (const s of steps) await addStep(page, s);
  return ghost;
}

test('320 宽度：详情卡无水平滚动，按钮不小于 44×44，正文不小于 16px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await ready(page);
  await pendingGhost(page, ['Gather the boxes', 'Scan them']);
  await card(page).getByRole('checkbox').first().check();
  await card(page).getByRole('checkbox').nth(1).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const small = await card(page).evaluate((el) => {
    const bad: string[] = [];
    for (const b of el.querySelectorAll('button')) {
      const r = b.getBoundingClientRect();
      if (r.width < 44 - 0.5 || r.height < 44 - 0.5) bad.push(`${b.textContent}:${r.width}x${r.height}`);
    }
    for (const t of el.querySelectorAll('p, label, span, h3')) {
      if (parseFloat(getComputedStyle(t).fontSize) < 16) bad.push(`font:${t.textContent}`);
    }
    return bad;
  });
  expect(small).toEqual([]);
  // 确认对话框在 320 宽度下同样可用
  await card(page).getByRole('button', { name: 'Confirm complete' }).click();
  const dialog = page.getByRole('dialog');
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
});

test('Reduced Motion：家务与橡皮擦只切换姿态、文字与颜色，没有位移或旋转动画', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  const ghost = await pendingGhost(page, ['One', 'Two', 'Three']);
  const boxes = card(page).getByRole('checkbox');
  await boxes.nth(0).check();
  await expect(ghost).toHaveAttribute('data-chore', 'sweep');
  await expect(page.getByRole('status')).toContainText('Swept the floor.');
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await boxes.nth(0).uncheck();
  await expect(ghost).toHaveAttribute('data-anim', 'erase');
  await expect(page.getByRole('status')).toContainText('Oops, let me fix that');
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('连续快速点击 10 次：最终颜色、进度与数据一致', async ({ page }) => {
  await ready(page);
  const ghost = await pendingGhost(page, ['Only step', 'Second step']);
  const box = card(page).getByRole('checkbox').first();
  for (let i = 0; i < 10; i++) await box.click({ force: true, noWaitAfter: true });
  await expect(box).not.toBeChecked();
  await expect(card(page)).toContainText('0 of 2 done');
  await expect(ghost).toHaveAttribute('data-state', 'white');
  expect(await saturation(ghost)).toBe(0);
  await box.check();
  await expect(card(page)).toContainText('1 of 2 done');
  await expect(ghost).toHaveAttribute('data-state', 'green');
  await expect.poll(() => saturation(ghost)).toBeGreaterThan(30);
});

test('只有 1 个步骤的 Task 也有家务反馈、变色与等待确认', async ({ page }) => {
  await ready(page);
  const ghost = await pendingGhost(page, ['The only step']);
  await card(page).getByRole('checkbox').check();
  await expect(ghost).toHaveAttribute('data-chore', 'sweep');
  await expect(ghost).toHaveAttribute('data-pending', 'true');
});

test('确认时写下留言，盖章页显示留言；“跳过动画”直接到稳态', async ({ page }) => {
  await ready(page);
  await pendingGhost(page, ['Just one']);
  await card(page).getByRole('checkbox').check();
  await card(page).getByRole('button', { name: 'Confirm complete' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('A little note to keep (optional)').fill('Done, and a little proud');
  await dialog.getByRole('button', { name: 'Confirm complete' }).click();
  await expect(page.locator('.celebration')).toHaveAttribute('data-phase', 'stamp', { timeout: 4000 });
  await expect(page.locator('.stamp-page')).toContainText('Done, and a little proud');
  await expect(page.locator('.warm-lamp')).toHaveCount(0);
  await page.getByRole('button', { name: 'Skip animation' }).click();
  await expect(page.locator('.celebration')).toHaveCount(0);
  await expect(page.locator('.warm-lamp')).toHaveCount(1);
  await expect(ghosts(page)).toHaveCount(0);
  await page.locator('.archive-book').click();
  await expect(page.locator('.archive-entry')).toContainText('Done, and a little proud');
  await expect(page.locator('.archive-entry')).toContainText('A little ghost, complete on');
});

test('门厅的纪念册按钮不小于 44×44（宽屏与 320 宽度都是）', async ({ page }) => {
  await ready(page);
  const book = (await page.locator('.archive-book').boundingBox())!;
  expect(book.width).toBeGreaterThanOrEqual(44);
  expect(book.height).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 320, height: 800 });
  const narrow = (await page.locator('.archive-book').boundingBox())!;
  expect(narrow.width).toBeGreaterThanOrEqual(44);
  expect(narrow.height).toBeGreaterThanOrEqual(44);
});

test('只有 Ghost 是点击目标：点家具、墙面、空位置不会打开任何详情', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await create(page, 'Solo');
  const ghost = ghosts(page).first();
  const floor = (await page.locator('.static-layer [data-module="floor-01"]').boundingBox())!;
  for (const [fx, fy] of [[0.8, 0.6], [0.05, 0.8], [0.9, 0.9], [0.5, 0.1]] as const) {
    await page.mouse.click(floor.x + floor.width * fx, floor.y + floor.height * fy);
  }
  await expect(card(page)).toHaveCount(0);
  await expect(ghost).toHaveAttribute('aria-pressed', 'false');
});

test('完成条件：保存后收成文本 + Edit；Edit/Cancel/清空；抽屉变短且 Ghost 仍露出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await ready(page);
  await create(page, 'Sort the photos');
  const ghost = ghosts(page).first();
  await openGhost(ghost);
  const field = criteriaField(page);
  const edit = criteriaEdit(page);
  await expect(field).toBeVisible();
  await expect(card(page).getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  const tall = (await card(page).boundingBox())!.height;

  await field.fill('One album per year');
  await card(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(field).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(card(page).locator('.criteria-text')).toHaveText('One album per year');
  await expect(edit).toBeFocused();
  const box = await edit.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await expect.poll(async () => (await card(page).boundingBox())!.height).toBeLessThan(tall - 40);
  await expect
    .poll(async () => {
      const d = (await card(page).boundingBox())!;
      const g = (await ghost.boundingBox())!;
      return g.y >= 0 && g.y + g.height <= d.y;
    })
    .toBe(true);

  await edit.click();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('One album per year');
  await field.fill('Two albums per year');
  await card(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card(page).locator('.criteria-text')).toHaveText('Two albums per year');

  await edit.click();
  await field.fill('Discard me');
  await card(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(field).toHaveCount(0);
  await expect(card(page).locator('.criteria-text')).toHaveText('Two albums per year');
  await expect(edit).toBeFocused();

  await edit.click();
  await field.fill('');
  await card(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(field).toBeVisible();
  await expect(edit).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  await expect(ghosts(page).first()).toHaveAttribute('data-state', 'gray');
});
