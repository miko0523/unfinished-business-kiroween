import { expect, test } from '@playwright/test';
import { addStep, card, create, ghosts, openGhost, ready, setCriteria } from './helpers/app';

// 抽屉变高（例如勾完最后一步多出“确认完成”）后，被选的幽灵仍整只露在抽屉上方。
// 320 宽时文字折行、内容更高，需要更高的视口抽屉才不会先触到 58% 的上限。
for (const [width, height] of [[1280, 900], [320, 1500]] as const) {
  test(`抽屉变高后重新露出整只幽灵（${width} 宽）`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height });
    await ready(page);
    await create(page, 'Grow');
    const ghost = ghosts(page).first();
    await openGhost(ghost);
    await setCriteria(page, 'Done');
    for (const name of ['a', 'b', 'c']) await addStep(page, name);
    const visibleAbove = async () => {
      const g = (await ghost.boundingBox())!;
      const d = (await card(page).boundingBox())!;
      return { gBottom: g.y + g.height, gTop: g.y, dTop: d.y };
    };
    await expect.poll(async () => { const v = await visibleAbove(); return v.gBottom <= v.dTop && v.gTop >= 0; }, { timeout: 4000 }).toBe(true);
    const before = (await card(page).boundingBox())!.height;
    for (let i = 0; i < 3; i++) await card(page).getByRole('checkbox').nth(i).check();
    await expect(card(page).getByRole('button', { name: 'Confirm complete' })).toBeVisible();
    await expect.poll(async () => (await card(page).boundingBox())!.height, { timeout: 3000 }).toBeGreaterThan(before);
    await expect
      .poll(async () => { const v = await visibleAbove(); return v.gBottom <= v.dTop + 1 && v.gTop >= 0; }, { timeout: 4000 })
      .toBe(true);
  });
}
