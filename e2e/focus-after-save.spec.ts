import { expect, test } from '@playwright/test';
import { card, create, ghosts, openGhost, ready } from './helpers/app';

// 回归：保存完成条件后，表单换成只读行，焦点交给“编辑”按钮（原来的提交键已被移除）。
// 这次移焦必须和界面更新发生在同一次提交里，原来它放在“渲染后的下一帧”才执行的副作用里，带来两种真实缺陷：
//   1. 抢焦点：机器忙时副作用迟到，玩家已经 Tab 到步骤框开始输入，它还会把焦点抢回“编辑”，
//      后面敲的字落到按钮上，回车重新打开编辑（a11y-keyboard 偶发失败：步骤框停在 “Pull the”）。
//   2. 丢焦点：玩家刚输入完就保存，上一轮渲染还没执行的副作用会在保存那轮渲染开始时被抢先执行，
//      它把“要去编辑键”的标记取走，却因为编辑键还没出现而什么也没做，焦点于是掉到页面空处。
// 下面不用任何固定等待：只等渲染帧，让该跑的副作用都跑完。

/** 等两个渲染帧：此前登记的下一帧副作用一定已经执行。 */
const settle = (page: import('@playwright/test').Page) =>
  page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));

test('保存完成条件后，立刻移到步骤框的焦点不会被迟到的移焦抢走，接着输入的步骤完整加入', async ({ page }) => {
  await ready(page);
  await create(page, 'Focus race');
  await openGhost(ghosts(page).first());
  await expect(card(page).getByRole('heading', { name: 'Focus race' })).toBeFocused();
  await card(page).getByLabel('What does "done" look like?').fill('The focus stays where I put it');
  await settle(page); // 输入那轮渲染的副作用已执行，场上没有悬着的旧副作用

  // 界面一换好（变更观察器的微任务，早于任何一帧），就把焦点移到步骤框；再等渲染帧让所有迟到的副作用跑完。
  const activeId = await page.evaluate(async () => {
    const drawer = document.querySelector('.task-card')!;
    const stepField = document.querySelector<HTMLInputElement>('#step-new')!;
    const moved = new Promise<void>((done) => {
      const watch = new MutationObserver(() => {
        if (!drawer.querySelector('.criteria-text')) return;
        watch.disconnect();
        stepField.focus();
        done();
      });
      watch.observe(drawer, { childList: true, subtree: true });
    });
    drawer.querySelector<HTMLButtonElement>('.criteria button[type="submit"]')!.click();
    await moved;
    await new Promise<void>((frame) => requestAnimationFrame(() => requestAnimationFrame(() => frame())));
    return document.activeElement?.id ?? document.activeElement?.tagName ?? '';
  });
  expect(activeId).toBe('step-new');

  await page.keyboard.type('Pull the weeds');
  await page.keyboard.press('Enter');
  await expect(card(page).locator('.step-check span')).toHaveText('Pull the weeds');
  await expect(card(page).locator('#criteria')).toHaveCount(0); // 没有被误触“编辑”而重新打开表单
});

test('刚输入完就保存：焦点仍然落在“编辑”按钮上，不掉进页面空处', async ({ page }) => {
  await ready(page);
  await create(page, 'Focus quick');
  await openGhost(ghosts(page).first());
  await expect(card(page).getByRole('heading', { name: 'Focus quick' })).toBeFocused();
  await settle(page);
  // 输入那轮渲染一提交（字数提示变了，变更观察器的微任务，早于任何一帧），保存就来了：
  // 此刻输入那轮渲染的副作用还悬着。
  await page.evaluate(() => {
    const box = document.querySelector<HTMLTextAreaElement>('#criteria')!;
    const count = document.querySelector('.count')!;
    const watch = new MutationObserver(() => {
      watch.disconnect();
      document.querySelector<HTMLButtonElement>('.criteria button[type="submit"]')!.click();
    });
    watch.observe(count, { childList: true, characterData: true, subtree: true });
    box.focus();
    box.value = 'Typed and saved in one breath';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(card(page).locator('.criteria-text')).toHaveText('Typed and saved in one breath');
  await settle(page);
  await expect(card(page).getByRole('button', { name: 'Edit', exact: true })).toBeFocused();
});

test('保存后玩家什么都不动：焦点落在“编辑”按钮上，不掉进空处', async ({ page }) => {
  await ready(page);
  await create(page, 'Focus rest');
  await openGhost(ghosts(page).first());
  await card(page).getByLabel('What does "done" look like?').fill('Resting focus');
  await card(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card(page).getByRole('button', { name: 'Edit', exact: true })).toBeFocused();
});
