import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { seedSave } from './helpers/save';
import { SHOTS_DIR } from './helpers/shots';
import type { MemorialEntry, SlotId, Task } from '../src/domain/types';
import { serializeSave } from '../src/persistence/serialize';

// README 用的截图构图（英文界面，自然的示例数据，2026-10 的日期）。全部是隔离的一次性浏览器上下文与合成存档，不碰任何真实数据。
// 没有设置 SHOTS_DIR 时只检查构图本身成立，不写文件；要重新生成：
//   SHOTS_DIR=<目录> npx playwright test e2e/readme-screenshots.spec.ts --project=chromium --workers=1
// 这些图的构图是否好看由视觉负责人挑选；这里的断言只保证“拍到的是该拍的东西，且没有焦点框、悬停和测试用标题”。

const NOTES = [
  'Booked the dentist at last. Tea was earned.',
  'Sent the thank-you card that had been waiting on the desk.',
  'Watered every plant, even the sulky fern.',
  'Cleared one drawer and found a lost button.',
  'Finally replied to the long email.',
  'Took the library books back, a little late and very proud.',
  'Paid the electricity bill before the weekend.',
  'Hung the shelf that had leaned against the wall since spring.',
  'Called my sister back. We talked for an hour.',
  'Booked the passport photo for Thursday morning.',
  'Folded the laundry mountain into three small hills.',
  'Wrote the first page of the proposal, badly, and it counts.',
] as const;
const TITLES = ['Dentist', 'Thank-you card', 'Plants', 'Drawer', 'Long email', 'Library books', 'Electricity bill', 'Shelf', 'Call back', 'Passport photo', 'Laundry', 'Proposal'] as const;

const NIGHT = '#0a0f24';

const at = (floor: SlotId['floor'], slot: SlotId['slot']): SlotId => ({ floor, slot });

function task(i: number, slot: SlotId, title: string, criteria: string, steps: [string, boolean][]): Task {
  return {
    id: `r${i}`,
    ghostNo: i + 1,
    title,
    criteria,
    steps: steps.map(([text, done], k) => ({ id: `r${i}s${k}`, title: text, done })),
    slot,
    createdAt: '2026-10-20T08:00:00.000Z',
  };
}

function archiveOf(n: number): MemorialEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `entry-${i}`,
    title: TITLES[i % TITLES.length]!,
    titleVisible: false,
    completedOn: `2026-10-${String(i + 1).padStart(2, '0')}`,
    stepCount: 2 + (i % 3),
    memo: NOTES[i % NOTES.length]!,
    confirmedAt: new Date(Date.UTC(2026, 9, i + 1, 9, 0, 0)).toISOString(),
  }));
}

async function seed(page: Page, tasks: Task[], completed: number, grownFloors: 2 | 3 | 4 | 5 | 6, collection?: boolean) {
  await seedSave(
    page,
    serializeSave({
      tasks,
      archive: archiveOf(completed),
      house: { grownFloors, completedCount: completed },
      settings: { lang: 'en' },
      nextGhostNo: tasks.length + 1,
      ...(collection ? { collection: { lanternWelcomed: true } } : {}),
    }),
  );
}

async function loaded(page: Page, path = '/') {
  await page.goto(path);
  await page.waitForFunction(() => [...document.querySelectorAll('.static-layer img')].every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0));
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
}

/** 拍照前的清场：没有焦点框、没有悬停（鼠标挪到角落）、没有页面里的光标。返回此刻有焦点的元素描述，供断言。 */
async function quiet(page: Page): Promise<string> {
  await page.mouse.move(0, 0);
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body && active.blur) active.blur();
    const ringed = [...document.querySelectorAll<HTMLElement>('*')].filter((el) => {
      if (!el.matches(':focus-visible') && !el.matches(':focus')) return false;
      return getComputedStyle(el).outlineStyle !== 'none';
    });
    return ringed.map((el) => el.tagName + '.' + el.className).join(',');
  });
}

async function save(name: string, body: Buffer): Promise<void> {
  if (!SHOTS_DIR) return;
  await mkdir(SHOTS_DIR, { recursive: true });
  await writeFile(`${SHOTS_DIR}/${name}.png`, body);
}

/** 屏幕上不该出现的东西：测试用标题、转义样例、调试标记。 */
async function expectCleanText(page: Page) {
  const text = await page.evaluate(() => document.body.innerText + [...document.querySelectorAll('*')].flatMap((e) => [...e.attributes].map((a) => a.value)).join('\n'));
  for (const bad of ['<b>', '&amp;', 'onerror', 'data-debug', 'Secret', 'The last one']) expect(text, bad).not.toContain(bad);
}

test.describe('README 截图', () => {
  test('首图：夜景里完整的整座小屋（屋顶到门厅底边，门和书都在），灰、白、绿的住客和已亮的暖灯，静止、没有任何动画和焦点', async ({ browser }) => {
    test.setTimeout(90_000);
    // 整座四层小屋加顶栏、页脚约 1660 CSS 像素高，放不进 1280×720 的 1:1 画面。用 3200×1800 的画框配 0.4 的像素比，
    // 拍出 1280×720 的真实画面：布局、比例和夜景是产品本来的样子，只是整体缩小；不改任何产品样式。
    // 夜空里的星点是固定在视口百分比位置的背景，而 “Try sample” 按钮的背景是透明的：16:9 的视口里，第一颗星总是恰好落在这颗按钮的上沿，
    // 像一个小白点（视口宽 1540 到 6280 都如此，量过）。星点的纵向位置随视口高度变化，所以把视口拉高到星点落到按钮下面，
    // 再只截取视口最上面的 3200×1800：房子、顶栏、月亮和星点都在，只是远处的树影在被裁掉的下半部分。
    const stage = [
      task(0, at(2, 0), 'Plan the weekend trip', '', []),
      task(1, at(2, 1), 'Write the thank-you card', 'The card is in the post box.', [['Pick a card', false], ['Write two lines', false]]),
      task(2, at(3, 0), 'Water the plants', 'Every pot has had a drink.', [['Fill the can', true], ['Water the ferns', true], ['Wipe the leaves', false]]),
      task(3, at(3, 1), 'Tidy the bookshelf', 'Books are in rows and the dust is gone.', [['Take everything out', true], ['Dust the shelves', false], ['Put books back', false]]),
      task(4, at(4, 0), 'Renew the library card', 'The new card is in my wallet.', [['Find the old card', false]]),
      task(5, at(4, 1), 'Send the invoice', 'The invoice is sent and logged.', [['Fill in the hours', true], ['Press send', false]]),
    ];
    const CONTROLS = 'h1, .lang-switch button, .keep-copy, .demo-try, #create-title, .create-form button, .footer-link';
    let chosen: { width: number; height: number; context: BrowserContext; page: Page } | null = null;
    const tried: string[] = [];
    const FRAME = { width: 3200, height: 1800 };
    for (const height of [1800, 3000, 3100, 3300, 3600]) {
      const width = FRAME.width;
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1280 / FRAME.width, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await seed(page, stage, 5, 4);
      await loaded(page);
      const overlaps = await page.evaluate((selector) => {
        const boxes = [...document.querySelectorAll(selector)].map((e) => ({ name: e.tagName + '.' + e.className, r: e.getBoundingClientRect() })).filter((b) => b.r.width > 0);
        const sky = [...document.querySelectorAll('.sky circle, .firefly, .sky-moon')].map((e) => e.getBoundingClientRect());
        return boxes.filter((b) => sky.some((k) => k.left < b.r.right && k.right > b.r.left && k.top < b.r.bottom && k.bottom > b.r.top)).map((b) => b.name);
      }, CONTROLS);
      tried.push(`${width}x${height} (frame ${FRAME.width}x${FRAME.height}): ${overlaps.length === 0 ? 'clean' : overlaps.join(' | ')}`);
      if (overlaps.length === 0) {
        chosen = { width, height, context, page };
        break;
      }
      await context.close();
    }
    console.log('hero viewports tried:', tried.join(' ; '));
    expect(chosen, `没有一个视口让星点避开所有控件：${tried.join(' ; ')}`).not.toBeNull();
    const { width, context, page } = chosen!;

    await expect(page.locator('[data-ghost]')).toHaveCount(6);
    // 清场：点一下空白处、让一切失焦、鼠标移出画面，再等两个渲染帧让样式落稳。
    await page.mouse.click(30, Math.round(FRAME.height / 2));
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.mouse.move(0, 0);
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    const audit = await page.evaluate(() => {
      const all = [...document.querySelectorAll<HTMLElement>('*')];
      const q = (el: Element) => el.tagName.toLowerCase() + '.' + (el.getAttribute('class') ?? '');
      return {
        active: document.activeElement === document.body,
        focused: all.filter((e) => e.matches(':focus, :focus-visible, :focus-within')).map(q),
        outlines: all.filter((e) => getComputedStyle(e).outlineStyle !== 'none').map(q),
        controlShadows: [...document.querySelectorAll<HTMLElement>('button, input, a, textarea, select')].filter((e) => getComputedStyle(e).boxShadow !== 'none').map(q),
        // 鼠标停在画面角落，只会碰到最外层的空容器；任何控件、住客、书都不能处在悬停态。
        hover: all.filter((e) => e.matches(':hover') && e.matches('button, input, a, textarea, select, [data-ghost], .ghost-button, .archive-book, .warm-lamp')).map(q),
        running: document.getAnimations().filter((a) => a.playState === 'running').length,
        celebration: document.querySelectorAll('.celebration, .skip-animation, .grow-sparkles').length,
      };
    });
    expect(audit.active, '没有任何元素拿着焦点').toBe(true);
    expect(audit.focused, '没有 :focus / :focus-visible / :focus-within').toEqual([]);
    expect(audit.outlines, '没有任何可见轮廓').toEqual([]);
    expect(audit.controlShadows, '控件上没有 box-shadow（焦点柔光也没有）').toEqual([]);
    expect(audit.hover, '没有任何控件处在悬停态').toEqual([]);
    expect(audit.running, '没有任何动画在跑').toBe(0);
    expect(audit.celebration, '没有庆祝层、跳过按钮或长楼火花').toBe(0);

    // 整座房子完整入镜：屋顶到门厅底边、门厅里的书。
    const rect = (sel: string) => page.locator(sel).boundingBox();
    const house = (await rect('.house'))!;
    const roof = (await rect('.static-layer [data-module="roof"]'))!;
    const lobby = (await rect('.static-layer [data-module="lobby"]'))!;
    const book = (await rect('.archive-book'))!;
    expect(roof.y, '屋顶顶边在画面里').toBeGreaterThanOrEqual(0);
    expect(lobby.y + lobby.height, '门厅底边在截取的画框里').toBeLessThanOrEqual(FRAME.height - 40);
    expect(house.x).toBeGreaterThanOrEqual(0);
    expect(house.x + house.width).toBeLessThanOrEqual(width);
    expect(book.y + book.height, '书完整在画框里').toBeLessThanOrEqual(FRAME.height);
    expect(book.y, '书在门厅里').toBeGreaterThan(lobby.y);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), '整页没有纵向滚动').toBe(true);
    await expect(page.locator('.warm-lamp')).toHaveCount(5);
    const states = await page.locator('[data-ghost]').evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLElement).dataset.state))].sort());
    expect(states, '灰、白、绿的住客同时在屋里').toEqual(['gray', 'green', 'white']);
    const moon = (await rect('.sky-moon'))!;
    expect(moon.x + moon.width).toBeLessThanOrEqual(width);
    expect(moon.y).toBeGreaterThanOrEqual(0);
    await expectCleanText(page);

    const footer = (await rect('.app-footer'))!;
    expect(footer.y + footer.height, '页脚也在画框里').toBeLessThanOrEqual(FRAME.height);
    const body = await page.screenshot({ clip: { x: 0, y: 0, width: FRAME.width, height: FRAME.height } });
    expect(body.readUInt32BE(16), '输出宽 1280').toBe(1280);
    expect(body.readUInt32BE(20), '输出高 720').toBe(720);
    await save('hero-en', body);

    // 给复核者的证据：创建框与顶栏工具在 2 倍清晰度下的样子（不进 README）。这里没有焦点，细看是固有的边框与填充。
    if (SHOTS_DIR) {
      const detail = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
      const dp = await detail.newPage();
      await seed(dp, stage, 5, 4);
      await loaded(dp);
      await dp.mouse.move(0, 0);
      const form = (await dp.locator('.create-form').boundingBox())!;
      const tools = (await dp.locator('.top-tools').boundingBox())!;
      const area = { x: Math.max(0, Math.min(form.x, tools.x) - 12), y: Math.max(0, tools.y - 12), width: Math.max(form.width, tools.width) + 24, height: form.y + form.height - tools.y + 24 };
      await save('diag-create-form-and-tools-2x', await dp.screenshot({ clip: area }));
      await detail.close();
    }
    await context.close();
  });

  test('一桩心事：打开一只小幽灵的任务卡，四个小步骤勾了一半（只拍卡片和它旁边那只幽灵）', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const dentist = task(0, at(2, 0), 'Call the dentist', 'The appointment is booked and in my calendar.', [
      ["Look up the clinic's number", true],
      ['Call and ask for a morning slot', true],
      ['Put the date in my calendar', false],
      ['Text the details to myself', false],
    ]);
    await seed(page, [dentist, task(1, at(2, 1), 'Return the library books', 'The books are back on the shelf at the library.', [['Find the books', true], ['Walk them over', false]])], 3, 2);
    await loaded(page);
    await page.locator('[data-ghost][data-floor="2"][data-slot="0"]').dispatchEvent('click');
    await expect(page.locator('.task-card')).toBeVisible();
    await expect(page.locator('.step-check input')).toHaveCount(4);
    await expect(page.locator('.step-check input:checked')).toHaveCount(2);
    await expect(page.locator('.task-card h2')).toHaveText('Call the dentist');
    await expect(page.locator('.criteria-text')).toHaveText('The appointment is booked and in my calendar.');
    await expect(page.locator('[data-staged]')).toHaveCount(1);
    expect(await quiet(page), '没有焦点框').toBe('');
    const card = (await page.locator('.task-card').boundingBox())!;
    const ghost = (await page.locator('[data-staged] .ghost-button').boundingBox())!;
    const pad = 16;
    const x = Math.max(0, card.x - pad);
    const y = Math.max(0, ghost.y - pad);
    const clip = { x, y, width: Math.min(1280, card.x + card.width + pad) - x, height: Math.min(900, card.y + card.height + pad) - y };
    expect(clip.height).toBeGreaterThan(card.height);
    await expectCleanText(page);
    await save('task-card-en', await page.screenshot({ clip }));
  });

  test('纪念册：十二枚章集齐，提灯小幽灵的贴纸完整入镜，十二条纪念各不相同', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seed(page, [], 12, 2, true);
    await loaded(page, '/#/archive');
    await expect(page.locator('.archive-entry')).toHaveCount(12);
    await expect(page.locator('.collection-grid [data-unlocked="true"]')).toHaveCount(12);
    await expect(page.locator('.mist-tile[data-open="true"]')).toHaveCount(12);
    const memos = await page.locator('.archive-memo').allInnerTexts();
    expect(new Set(memos).size, '十二条纪念互不相同').toBe(12);
    expect(new Set(await page.locator('.archive-line').allInnerTexts()).size, '十二个日期互不相同').toBe(12);
    for (const line of await page.locator('.archive-line').allInnerTexts()) expect(line).toMatch(/2026-10-\d\d$/);
    expect(await quiet(page), '没有焦点框').toBe('');
    // 贴纸完整在书里，横跨两页（书脊在贴纸后面，不切幽灵）。
    const book = (await page.locator('.book').boundingBox())!;
    const sticker = (await page.locator('.reveal-sticker').boundingBox())!;
    expect(sticker.x).toBeGreaterThan(book.x);
    expect(sticker.x + sticker.width).toBeLessThan(book.x + book.width);
    expect(sticker.y).toBeGreaterThanOrEqual(book.y);
    expect(sticker.y + sticker.height).toBeLessThan(book.y + book.height);
    await expectCleanText(page);
    // README 采用：十二枚章的图鉴格 + 提灯小幽灵的贴纸（书页下半部分）。另存一张封面、目录加十二条纪念的上半部分，供视觉负责人对比，不采用。
    const grid = (await page.locator('.collection-grid').boundingBox())!;
    const page0 = await page.evaluate(() => scrollY);
    const top = grid.y + page0 - 56;
    const bookTop = book.y + page0;
    await save('archive-en', await page.screenshot({ fullPage: true, clip: { x: book.x, y: top, width: book.width, height: bookTop + book.height - top } }));
    // 对比图：封面、顶部目录和十二条紧凑的横排纪念（到列表底边再多留一点）。
    const list = (await page.locator('.archive-entries').boundingBox())!;
    const listBottom = list.y + page0 + list.height + 24;
    await save('archive-entries-en', await page.screenshot({ fullPage: true, clip: { x: book.x, y: bookTop, width: book.width, height: listBottom - bookTop } }));
  });

  test('手机：两张 320 宽并排，左边是小屋，右边是纪念册，中间 24px 深色缝（输出宽 664）', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
    const page = await context.newPage();
    const tasks = [
      task(0, at(2, 0), 'Plan the weekend trip', '', []),
      task(1, at(2, 1), 'Write the thank-you card', 'The card is in the post box.', [['Pick a card', false], ['Write two lines', false]]),
      task(2, at(3, 0), 'Water the plants', 'Every pot has had a drink.', [['Fill the can', true], ['Water the ferns', true], ['Wipe the leaves', false]]),
      task(3, at(3, 1), 'Tidy the bookshelf', 'Books are in rows and the dust is gone.', [['Take everything out', true], ['Dust the shelves', false], ['Put books back', false]]),
    ];
    await seed(page, tasks, 12, 3, true);
    await loaded(page);
    await expect(page.locator('[data-ghost]')).toHaveCount(4);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await quiet(page), '没有焦点框').toBe('');
    await expectCleanText(page);
    const left = await page.screenshot();
    await page.goto('/#/archive');
    await expect(page.locator('.archive-entry')).toHaveCount(12);
    expect(await quiet(page), '没有焦点框').toBe('');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const right = await page.screenshot();
    await context.close();

    // 在另一张空白页里把两张拼起来：24px 深色缝。
    const stitchCtx = await browser.newContext({ viewport: { width: 664, height: 640 } });
    const stitch = await stitchCtx.newPage();
    const url = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
    await stitch.setContent(`<body style="margin:0;background:${NIGHT};display:flex;gap:24px"><img src="${url(left)}" width="320" height="640"><img src="${url(right)}" width="320" height="640"></body>`);
    await stitch.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth === 320));
    const joined = await stitch.screenshot();
    expect(joined.readUInt32BE(16), '输出宽 664').toBe(664);
    await save('phone-en', joined);
    await stitchCtx.close();
  });

  test('无障碍（可选）：减少动态下的静止盖章，同一句话与印章直接显示', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seed(page, [task(0, at(2, 0), 'Call the dentist', 'The appointment is booked.', [["Look up the clinic's number", true], ['Call and ask for a morning slot', true]])], 3, 2);
    await loaded(page);
    await page.locator('[data-ghost]').dispatchEvent('click');
    await page.locator('.pending-box .primary').click();
    await page.getByRole('dialog').locator('.primary').click();
    await expect(page.locator('.celebration')).toHaveAttribute('data-still', 'true');
    await expect(page.locator('.stamp-page')).toHaveCSS('visibility', 'visible');
    expect(await page.evaluate(() => document.getAnimations().filter((a) => !(a.effect as KeyframeEffect | null)?.target?.closest('.sky')).length), '没有任何动画在跑').toBe(0);
    expect(await quiet(page), '没有焦点框').toBe('');
    const card = (await page.locator('.stamp-page').boundingBox())!;
    const ghost = (await page.locator('.celebration-ghost').boundingBox())!;
    const pad = 24;
    const x = Math.max(0, Math.min(card.x, ghost.x) - pad);
    const y = Math.max(0, Math.min(card.y, ghost.y) - pad);
    const clip = { x, y, width: Math.min(1280, Math.max(card.x + card.width, ghost.x + ghost.width) + pad) - x, height: Math.min(900, Math.max(card.y + card.height, ghost.y + ghost.height) + pad) - y };
    await expectCleanText(page);
    await save('reduced-motion-stamp-en', await page.screenshot({ clip }));
  });

  test('Try sample 的亮黄描边是它固有的边框，不是焦点残留（不聚焦、不悬停时同样存在）', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seed(page, [], 0, 2);
    await loaded(page);
    await page.mouse.move(0, 0);
    const probe = await page.locator('.demo-try').evaluate((el) => {
      const s = getComputedStyle(el);
      return { focused: document.activeElement === el, focusVisible: el.matches(':focus-visible'), hover: el.matches(':hover'), borderWidth: s.borderTopWidth, borderColor: s.borderTopColor, outlineStyle: s.outlineStyle };
    });
    expect(probe).toEqual({ focused: false, focusVisible: false, hover: false, borderWidth: '2px', borderColor: 'rgb(255, 212, 121)', outlineStyle: 'none' });
    // 键盘聚焦时才多出一圈外轮廓（3px、偏移 2px），那是焦点框；平时只有这条 2px 的边。
    await page.keyboard.press('Shift');
    await page.locator('.demo-try').focus();
    expect(await page.locator('.demo-try').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  });
});
