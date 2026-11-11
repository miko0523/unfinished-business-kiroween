import { expect, test } from '@playwright/test';
import { forLanguage } from '../src/i18n/t';
import { ghosts } from './helpers/app';

// 回归：页面刚画出来、框架还没来得及执行“下一帧”的副作用时，玩家（或很快的键盘输入）就搬进了第一只小幽灵。
// 读屏播报订阅放在下一帧才执行的副作用里，这一刻的事件就没有人听，状态区一直是空的，读屏用户听不到“搬进来了”。
// 订阅必须在界面提交的同一刻就位。测试里用变更观察器（微任务，早于任何一帧与定时器）在第一次出现创建框的瞬间提交表单。

test('第一次渲染后立刻搬进一只：读屏播报没有漏掉', async ({ page }) => {
  const t = forLanguage('en');
  await page.addInitScript(() => {
    const watch = new MutationObserver(async () => {
      const input = document.querySelector<HTMLInputElement>('#create-title');
      const form = input?.closest('form');
      if (!input || !form) return;
      watch.disconnect();
      input.value = 'Early bird';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // 等输入那轮渲染提交（微任务），仍然早于任何一帧与定时器。
      for (let i = 0; i < 5; i++) await Promise.resolve();
      form.requestSubmit();
    });
    watch.observe(document, { childList: true, subtree: true });
  });
  await page.goto('/');
  await expect(ghosts(page)).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveText(t('create.movedIn'));
});
