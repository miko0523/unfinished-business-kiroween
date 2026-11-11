import { expect, test } from '@playwright/test';
import { addStep, card, create, ghosts, openGhost, ready, saturation, setCriteria } from './helpers/app';

const TITLE = 'Plan the garden party';
const CHORES = ['sweep', 'water', 'window'] as const;

test('回归：完成条件为空而步骤全勾时不可确认；保存完成条件后立即可确认', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await create(page, 'Sort the shelf');
  const ghost = ghosts(page).first();
  await openGhost(ghost);
  await addStep(page, 'Pick one shelf');
  await card(page).getByRole('checkbox').check();
  await expect(ghost).toHaveAttribute('data-state', 'gray');
  await expect(ghost).toHaveAttribute('data-pending', 'false');
  await expect(ghost.locator('.ghost-eyes')).toHaveAttribute('data-expression', 'puzzled');
  expect(await ghost.getAttribute('aria-label')).toContain('Not clear yet');
  await expect(card(page)).toContainText('One last thing: what does done look like?');
  await expect(card(page)).not.toContainText('Ready to confirm');
  await expect(card(page).getByRole('button', { name: 'Confirm complete' })).toHaveCount(0);
  await setCriteria(page, 'The shelf is tidy');
  await expect(ghost).toHaveAttribute('data-state', 'green');
  await expect(ghost).toHaveAttribute('data-pending', 'true');
  await expect(card(page)).toContainText('Ready to confirm');
  await expect(card(page).getByRole('button', { name: 'Confirm complete' })).toBeVisible();
});

test('第一只幽灵走完整条主线：变白、三种家务、橡皮擦、等确认、确认、纪念册', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await ready(page);
  await create(page, TITLE);
  const ghost = ghosts(page).first();
  await expect(ghost).toHaveAttribute('data-state', 'gray');
  await openGhost(ghost);
  await expect(card(page).getByRole('heading', { name: TITLE })).toBeFocused();
  await expect(card(page)).toContainText('Not clear yet');
  await expect(card(page)).not.toContainText('0 of 0');

  // 只填完成条件：仍是灰色，并提示还缺什么
  await setCriteria(page, 'The invitations are out');
  await expect(ghost).toHaveAttribute('data-state', 'gray');
  await expect(card(page)).toContainText('add a first small step');

  // 加入第一步：Clarified，变白
  await addStep(page, 'Write the list');
  await expect(ghost).toHaveAttribute('data-state', 'white');
  expect(await ghost.getAttribute('aria-label')).toContain('Ready to start');
  await expect(card(page)).toContainText('Ready to start');
  await addStep(page, 'Buy paper lanterns');
  await addStep(page, 'Send the invitations');
  await expect(card(page).getByRole('checkbox')).toHaveCount(3);

  // 依次勾选：扫地、浇花、擦窗，各播放恰好一次；饱和度单调不减
  let previous = 0;
  for (const [i, chore] of CHORES.entries()) {
    await card(page).getByRole('checkbox').nth(i).check();
    await expect(ghost).toHaveAttribute('data-chore', chore);
    await expect(ghost).toHaveAttribute('data-chore-total', String(i + 1));
    await expect(ghost).not.toHaveAttribute('data-chore', /.*/, { timeout: 4000 });
    await expect(ghost).toHaveAttribute('data-chore-total', String(i + 1));
    const s = await saturation(ghost);
    expect(s).toBeGreaterThanOrEqual(previous);
    previous = s;
  }
  await expect(ghost).toHaveAttribute('data-state', 'green');
  await expect(ghost).toHaveAttribute('data-pending', 'true');
  expect(await ghost.getAttribute('aria-label')).toContain('Ready to confirm');
  await expect(ghost.locator('.ghost-ring')).toHaveCount(1);
  await expect(card(page).getByRole('button', { name: 'Confirm complete' })).toBeVisible();

  // 取消第 2 步：橡皮擦，进度如实回退，等确认的标记一并消失
  await card(page).getByRole('checkbox').nth(1).uncheck();
  await expect(ghost).toHaveAttribute('data-anim', 'erase');
  await expect(page.getByRole('status')).toContainText('Oops, let me fix that');
  await expect(page.getByRole('status')).toContainText('2 of 3 done');
  await expect(ghost).toHaveAttribute('data-pending', 'false');
  await expect(ghost.locator('.ghost-ring')).toHaveCount(0);
  await expect(card(page).getByRole('button', { name: 'Confirm complete' })).toHaveCount(0);
  expect(await saturation(ghost)).toBeLessThan(previous);
  await expect(ghost).not.toHaveAttribute('data-chore', /.*/);

  // 重新勾选 → 再次等确认；快进 7 天什么都不变
  await card(page).getByRole('checkbox').nth(1).check();
  await expect(ghost).toHaveAttribute('data-pending', 'true');
  await expect(ghost).not.toHaveAttribute('data-chore', /.*/, { timeout: 4000 });
  await page.clock.install();
  await page.clock.fastForward(7 * 24 * 60 * 60 * 1000);
  await expect(ghost).toHaveAttribute('data-state', 'green');
  await expect(ghost).toHaveAttribute('data-pending', 'true');
  await expect(card(page)).toContainText('3 of 3 done');
  const text = (await page.locator('body').innerText()).toLowerCase();
  for (const word of ['streak', 'overdue', 'late', 'hurry', 'countdown']) expect(text).not.toContain(word);
  await page.clock.resume();

  // 确认对话框：Esc 保持不变，焦点回到按钮
  const confirmButton = card(page).getByRole('button', { name: 'Confirm complete' });
  await confirmButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(ghost).toHaveAttribute('data-pending', 'true');
  await expect(confirmButton).toBeFocused();

  // 确认（留言为空）
  await confirmButton.click();
  const started = Date.now();
  await dialog.getByRole('button', { name: 'Confirm complete' }).click();
  await expect(ghosts(page)).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
  const celebration = page.locator('.celebration');
  const seen: string[] = [];
  for (const phase of ['gold', 'wave', 'stamp', 'fly']) {
    await expect(celebration).toHaveAttribute('data-phase', phase, { timeout: 4000 });
    seen.push(phase);
    if (phase === 'stamp') {
      const stamp = await page.locator('.stamp-page').innerText();
      expect(stamp).toMatch(/A little ghost, complete on \d{4}-\d{2}-\d{2}/);
      expect(stamp).not.toContain('Steps done');
      expect(stamp).not.toContain(TITLE);
    }
    if (phase === 'fly') {
      // 飞行动画在阶段属性变化后的下一次提交里才创建；高负载下可能晚一两帧。
      await expect
        .poll(() =>
          page.evaluate(() =>
            document.getAnimations().some((a) => (a as CSSAnimation).effect && (a.effect as KeyframeEffect).target?.classList.contains('celebration-ghost')),
          ),
        )
        .toBe(true);
    }
  }
  expect(seen).toEqual(['gold', 'wave', 'stamp', 'fly']);
  await expect(celebration).toHaveCount(0, { timeout: 4000 });
  expect(Date.now() - started).toBeLessThan(5500);
  await expect(page.locator('.warm-lamp')).toHaveCount(1);

  // 纪念册：1 条，标题默认隐藏，URL 只含固定 hash
  await page.locator('.archive-book').click();
  await expect(page).toHaveURL(/#\/archive$/);
  const entries = page.locator('.archive-entry');
  await expect(entries).toHaveCount(1);
  await expect(page.locator('main')).not.toContainText(TITLE);
  expect(await page.title()).not.toContain(TITLE);
  await entries.getByRole('button', { name: 'Show the title' }).click();
  await expect(entries).toContainText(TITLE);
  expect(page.url()).not.toContain('garden');
  await entries.getByRole('button', { name: 'Hide the title' }).click();
  await expect(page.locator('main')).not.toContainText(TITLE);
  await page.getByRole('link', { name: 'Back to the house' }).click();
  await expect(ghosts(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});
