import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { BAD_SAVES, INVALID_JSON } from '../tests/helpers/badSaves';
import { create, ghosts } from './helpers/app';

type Fault = 'backup-write' | 'backup-mismatch' | 'primary-write' | 'primary-mismatch' | null;

/** 记录每次 localStorage 写入的键；可在点击前临时武装一种故障（启动读取之后才生效）。 */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __writes: string[]; __fault: Fault; __raw: string | null };
    w.__writes = [];
    w.__fault = null;
    const set = Storage.prototype.setItem;
    const get = Storage.prototype.getItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      const f = w.__fault;
      w.__writes.push(k);
      const full = () => new DOMException('full', 'QuotaExceededError');
      if (f === 'backup-write' && k.startsWith('ub:backup:')) throw full();
      // 主键写入失败只针对新空存档；对原文的尽力还原放行
      if (f === 'primary-write' && k === 'ub:save' && v !== w.__raw) throw full();
      return set.call(this, k, v);
    };
    Storage.prototype.getItem = function (k: string) {
      const real = get.call(this, k);
      const f = w.__fault;
      if (real !== null && ((f === 'backup-mismatch' && k.startsWith('ub:backup:')) || (f === 'primary-mismatch' && k === 'ub:save'))) return `${real}~`;
      return real;
    };
  });
}

const writes = (page: Page) => page.evaluate(() => (window as unknown as { __writes: string[] }).__writes);
const arm = (page: Page, fault: Fault, raw: string | null = null) =>
  page.evaluate(([f, r]) => {
    const w = window as unknown as { __fault: Fault; __raw: string | null };
    w.__fault = f as Fault;
    w.__raw = r as string | null;
  }, [fault, raw] as const);
/** 读真实存储内容（读之前临时解除读回故障）。 */
const read = (page: Page, key: string) =>
  page.evaluate((k) => {
    const w = window as unknown as { __fault: Fault };
    const f = w.__fault;
    w.__fault = null;
    const v = localStorage.getItem(k);
    w.__fault = f;
    return v;
  }, key);
const storedKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage).sort());

/** 先写入坏存档（这一步不算页面的写入），再重新打开。 */
async function open(page: Page, raw: string, extra: Record<string, string> = {}) {
  await instrument(page);
  await page.goto('/');
  await page.evaluate(([r, e]) => {
    localStorage.setItem('ub:save', r as string);
    for (const [k, v] of Object.entries(e as Record<string, string>)) localStorage.setItem(k, v);
  }, [raw, extra] as const);
  await page.goto('/');
  await expect(heading(page)).toBeVisible();
}

const heading = (page: Page) => page.getByRole('heading', { name: 'The old notebook got smudged' });
const copyButton = (page: Page) => page.getByRole('button', { name: 'Keep a copy of the old notebook' });
const blankButton = (page: Page) => page.getByRole('button', { name: 'Carry on with a blank page' });
const freshButton = (page: Page) => page.getByRole('button', { name: 'Back up the old save and start fresh' });
const confirmFresh = (page: Page) => page.locator('dialog').getByRole('button', { name: 'Tuck it away and begin anew' });
const houseVisible = async (page: Page) => {
  await expect(page.getByLabel('What is still waiting for you?')).toBeVisible();
};

async function runFresh(page: Page) {
  await freshButton(page).click();
  await confirmFresh(page).click();
}

async function expectStillRecovering(page: Page, raw: string) {
  await expect(heading(page)).toBeVisible();
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(page.getByLabel('What is still waiting for you?')).toHaveCount(0);
  for (const b of [copyButton(page), blankButton(page), freshButton(page)]) await expect(b).toBeEnabled();
  expect(await read(page, 'ub:save')).toBe(raw);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

for (const [name, raw] of Object.entries(BAD_SAVES)) {
  test(`坏存档（${name}）：专用恢复界面，启动零写入，原文不动，不泄露技术内容`, async ({ page }) => {
    await open(page, raw);
    await page.waitForTimeout(800);
    await expect(page.getByText(/Oh dear, the old notebook got smudged/)).toBeVisible();
    for (const b of [copyButton(page), blankButton(page), freshButton(page)]) await expect(b).toBeVisible();
    // 不是看似正常的空房子
    await expect(page.getByLabel('What is still waiting for you?')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Welcome a little ghost' })).toHaveCount(0);
    await expect(ghosts(page)).toHaveCount(0);
    expect(await writes(page)).toEqual([]);
    expect(await read(page, 'ub:save')).toBe(raw);
    expect(await storedKeys(page)).toEqual(['ub:save']);
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/ub:|schema|JSON|SyntaxError|Unexpected|ghostNo/);
    expect(body).not.toContain(raw.slice(0, 15));
    // 刷新后依旧如此
    await page.reload();
    await expect(heading(page)).toBeVisible();
    expect(await writes(page)).toEqual([]);
    expect(await read(page, 'ub:save')).toBe(raw);
  });

  test(`选项一（${name}）：下载的副本与原字符串逐字符相同，不写任何键`, async ({ page }) => {
    await open(page, raw);
    const downloading = page.waitForEvent('download');
    await copyButton(page).click();
    const file = await downloading;
    expect(file.suggestedFilename()).toMatch(/^unfinished-business-old-notebook-\d{8}\.txt$/);
    expect(readFileSync((await file.path())!, 'utf8')).toBe(raw);
    await expect(page.getByText('The copy is packed. The old notebook stays right where it was.')).toBeVisible();
    await expectStillRecovering(page, raw);
    expect(await writes(page)).toEqual([]);
  });
}

test('选项二：内存里继续，提示与导出入口常在；所有操作零写入；主键不动，刷新又回到恢复界面', async ({ page }) => {
  await open(page, INVALID_JSON);
  await blankButton(page).click();
  await houseVisible(page);
  await expect(heading(page)).toHaveCount(0);
  // exact：读屏播报区里那句 “A blank page is open. Just for now: …” 也含这段字，随时可能挂上，只认常驻的存储提示本身。
  await expect(page.getByText('Just for now: nothing will be tucked away this time.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep a copy', exact: true })).toBeVisible();

  await create(page, '整理书桌 tidy');
  await expect(ghosts(page)).toHaveCount(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
  });
  await page.waitForTimeout(800);
  expect(await writes(page)).toEqual([]);
  expect(await read(page, 'ub:save')).toBe(INVALID_JSON);
  expect(await storedKeys(page)).toEqual(['ub:save']);

  // 导出的是当前内存里的游戏数据
  await page.getByRole('button', { name: 'Keep a copy', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Pack the keepsake' }).click();
  const exported = JSON.parse(readFileSync((await (await downloading).path())!, 'utf8'));
  expect(exported.tasks.map((t: { title: string }) => t.title)).toEqual(['整理书桌 tidy']);
  expect(await writes(page)).toEqual([]);

  await page.reload();
  await expect(heading(page)).toBeVisible();
  expect(await read(page, 'ub:save')).toBe(INVALID_JSON);
  expect(await storedKeys(page)).toEqual(['ub:save']);
});

test('选项三：取消与 Esc 不写任何键；确认后先备份再写主键，刷新是正常房子', async ({ page }) => {
  await open(page, INVALID_JSON, { 'ub:backup:1': 'older notebook' });
  await freshButton(page).click();
  await expect(page.locator('dialog')).toContainText('Tuck the old notebook away safely, then open a fresh one?');
  expect(await writes(page)).toEqual([]);
  await page.locator('dialog').getByRole('button', { name: 'Not yet' }).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(freshButton(page)).toBeFocused();
  await freshButton(page).click();
  await expect(page.locator('dialog').getByRole('button', { name: 'Tuck it away and begin anew' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog')).toHaveCount(0);
  expect(await writes(page)).toEqual([]);
  expect(await read(page, 'ub:save')).toBe(INVALID_JSON);

  await runFresh(page);
  await houseVisible(page);
  await expect(heading(page)).toHaveCount(0);
  await expect(page.getByText('Just for now: nothing will be tucked away this time.')).toHaveCount(0);
  expect(await writes(page)).toEqual(['ub:backup:2', 'ub:save']);
  expect(await read(page, 'ub:backup:2')).toBe(INVALID_JSON);
  expect(await read(page, 'ub:backup:1')).toBe('older notebook');
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/ub:|backup:/);

  await create(page, 'Fresh start');
  await expect(ghosts(page)).toHaveCount(1);
  await page.waitForTimeout(800);
  await page.reload();
  await houseVisible(page);
  await expect(heading(page)).toHaveCount(0);
  await expect(ghosts(page)).toHaveCount(1);
  expect(await writes(page)).toEqual([]);
});

const FAULTS: { fault: Exclude<Fault, null>; message: string; backups: number }[] = [
  { fault: 'backup-write', message: "The old notebook didn't fit in the drawer this time", backups: 0 },
  { fault: 'backup-mismatch', message: "The old notebook didn't fit in the drawer this time", backups: 1 },
  { fault: 'primary-write', message: 'the new one wouldn\'t open this time', backups: 1 },
  { fault: 'primary-mismatch', message: 'the new one wouldn\'t open this time', backups: 1 },
];

for (const { fault, message, backups } of FAULTS) {
  test(`选项三失败（${fault}）：不报成功，仍在恢复界面，主键保持原文；选项一二可用；重试成功时旧备份不被覆盖`, async ({ page }) => {
    await open(page, INVALID_JSON);
    await arm(page, fault, INVALID_JSON);
    await runFresh(page);
    await expect(page.getByRole('alert')).toContainText(message);
    await expectStillRecovering(page, INVALID_JSON);
    await expect(page.getByText('A fresh notebook is open.')).toHaveCount(0);
    const keys = await storedKeys(page);
    expect(keys.filter((k) => k.startsWith('ub:backup:'))).toHaveLength(backups);
    if (fault === 'backup-write') expect(await writes(page)).not.toContain('ub:save');
    if (fault === 'backup-mismatch') expect(await writes(page)).toEqual(['ub:backup:1']);
    if (backups === 1) expect(await read(page, 'ub:backup:1')).toBe(INVALID_JSON);

    // 选项一仍可用
    const downloading = page.waitForEvent('download');
    await copyButton(page).click();
    expect(readFileSync((await (await downloading).path())!, 'utf8')).toBe(INVALID_JSON);

    // 故障消失后重试：新备份取下一个序号，旧备份不动，成功才进入房子
    await arm(page, null);
    await runFresh(page);
    await houseVisible(page);
    await expect(heading(page)).toHaveCount(0);
    expect(await read(page, `ub:backup:${backups + 1}`)).toBe(INVALID_JSON);
    if (backups === 1) expect(await read(page, 'ub:backup:1')).toBe(INVALID_JSON);
    const saved = JSON.parse((await read(page, 'ub:save'))!);
    expect(saved.tasks).toEqual([]);
  });
}

test('选项三失败后选项二仍可用，之后零新增写入', async ({ page }) => {
  await open(page, INVALID_JSON);
  await arm(page, 'backup-write');
  await runFresh(page);
  await expect(page.getByRole('alert')).toBeVisible();
  const before = (await writes(page)).length;
  await blankButton(page).click();
  await houseVisible(page);
  await create(page, 'Still here');
  await page.waitForTimeout(800);
  expect((await writes(page)).length).toBe(before);
  expect(await read(page, 'ub:save')).toBe(INVALID_JSON);
});
