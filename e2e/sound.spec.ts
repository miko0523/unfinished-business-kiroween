import { expect, test, type Page } from '@playwright/test';
import { forLanguage } from '../src/i18n/t';
import { BGM_GAIN } from '../src/sound/engine';
import { BGM_SECONDS } from '../src/sound/loop';
import { create, ghosts, ready } from './helpers/app';

// R14：声音开关、渐入渐出、每次加载都是关（开关不记住、不碰 ub:sound）、后台暂停与恢复、加载失败静默回到关。
// 不靠听：页面脚本之前装一层记录器，包住 AudioContext、声源的 start/stop 和 AudioParam 的 ramp，并读 GainNode 的当前值。
// Chromium 实测；Safari 与真耳朵的听感验收另由发起人做（R14.6、R14.11）。

const t = forLanguage('en');
const soundSwitch = (page: Page) => page.getByRole('button', { name: t('sound.label') });

interface Probe {
  contexts: number;
  starts: { loop: boolean; duration: number | null; when: number; offset: number; at: number }[];
  ramps: { value: number; dt: number }[];
  bgmStops: number;
  /** 页面对 ub:sound 的每一次读、写、删（测试自己播种的那一下不算）。 */
  soundKey: string[];
  state: string | null;
  gain: number | null;
  loopStart: number | null;
  loopEnd: number | null;
}

async function instrument(page: Page) {
  await page.addInitScript(() => {
    type W = typeof window & { __audio: Record<string, unknown> & { ctx?: AudioContext; bgm?: AudioBufferSourceNode; bgmGain?: GainNode } };
    const w = window as W;
    const rec = (w.__audio = { contexts: 0, starts: [] as unknown[], ramps: [] as unknown[], bgmStops: 0, soundKey: [] as string[] } as W['__audio']);
    const Orig = window.AudioContext;
    class Spy extends Orig {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        (rec.contexts as number)++;
        rec.ctx = this;
      }
    }
    window.AudioContext = Spy as typeof AudioContext;
    const proto = AudioBufferSourceNode.prototype;
    const start = proto.start;
    proto.start = function (this: AudioBufferSourceNode, when?: number, offset?: number) {
      (rec.starts as unknown[]).push({ loop: this.loop, duration: this.buffer?.duration ?? null, when: when ?? 0, offset: offset ?? 0, at: this.context.currentTime });
      if (this.loop) rec.bgm = this;
      return start.apply(this, [when, offset] as never);
    } as typeof proto.start;
    const stop = proto.stop;
    proto.stop = function (this: AudioBufferSourceNode, when?: number) {
      if (this.loop) (rec.bgmStops as number)++;
      return stop.apply(this, [when] as never);
    } as typeof proto.stop;
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (this: AudioNode, dest: AudioNode, ...rest: number[]) {
      if (this instanceof AudioBufferSourceNode && this.loop) rec.bgmGain = dest as GainNode;
      return connect.apply(this, [dest, ...rest] as never);
    } as typeof AudioNode.prototype.connect;
    const ramp = AudioParam.prototype.linearRampToValueAtTime;
    AudioParam.prototype.linearRampToValueAtTime = function (this: AudioParam, value: number, time: number) {
      if (rec.bgmGain && this === rec.bgmGain.gain) (rec.ramps as unknown[]).push({ value, dt: time - (rec.ctx?.currentTime ?? 0) });
      return ramp.call(this, value, time);
    };
    // 测试播种旧值时置 __seeding，那一下不记。
    const seeding = () => (window as unknown as { __seeding?: boolean }).__seeding === true;
    const note = (what: string) => {
      if (!seeding()) (rec.soundKey as string[]).push(what);
    };
    const { getItem, setItem, removeItem } = Storage.prototype;
    Storage.prototype.getItem = function (this: Storage, key: string) {
      if (key === 'ub:sound') note('get');
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (key === 'ub:sound') note(`set:${value}`);
      return setItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function (this: Storage, key: string) {
      if (key === 'ub:sound') note('remove');
      return removeItem.call(this, key);
    };
  });
}

const probe = (page: Page): Promise<Probe> =>
  page.evaluate(() => {
    const rec = (window as unknown as { __audio: Record<string, unknown> & { ctx?: AudioContext; bgm?: AudioBufferSourceNode; bgmGain?: GainNode } }).__audio;
    return {
      contexts: rec.contexts as number,
      starts: rec.starts as Probe['starts'],
      ramps: rec.ramps as Probe['ramps'],
      bgmStops: rec.bgmStops as number,
      soundKey: rec.soundKey as string[],
      state: rec.ctx?.state ?? null,
      gain: rec.bgmGain ? rec.bgmGain.gain.value : null,
      loopStart: rec.bgm?.loopStart ?? null,
      loopEnd: rec.bgm?.loopEnd ?? null,
    };
  });

function embeddedAudioRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (r) => {
    if (/\/assets\/embeddedAudio-[^/]+\.js(?:\?|$)/.test(r.url())) urls.push(r.url());
  });
  return urls;
}

function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

const lastRamp = async (page: Page) => (await probe(page)).ramps.at(-1);

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

test('加载后完全安静：没有音频环境、没有声源、没有加载内嵌音频模块；开关为关', async ({ page }) => {
  const requests = embeddedAudioRequests(page);
  await ready(page);
  await page.waitForTimeout(800);
  await expect(soundSwitch(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'off');
  const p = await probe(page);
  expect(p.contexts).toBe(0);
  expect(p.starts).toEqual([]);
  expect(requests).toEqual([]);
  // 普通交互（创建一只幽灵）不会打开声音。
  await create(page, 'Water the plants');
  await expect(ghosts(page)).toHaveCount(1);
  expect((await probe(page)).contexts).toBe(0);
  expect(requests).toEqual([]);
});

test('打开：循环的背景音乐从 0 起约 2 秒渐入到偏低的目标；关闭：约 0.5 秒渐出后停止', async ({ page }) => {
  const errors = pageErrors(page);
  const requests = embeddedAudioRequests(page);
  await ready(page);
  await soundSwitch(page).click();
  await expect(soundSwitch(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'playing');
  let p = await probe(page);
  expect(p.contexts).toBe(1);
  expect(p.state).toBe('running');
  const bgm = p.starts.filter((s) => s.loop);
  expect(bgm).toHaveLength(1);
  // Chromium 按 LAME 头去掉填充，解码后正好是一圈；真实内嵌字节另由 sound-file.test.ts 核对。
  expect(bgm[0]!.duration).toBeCloseTo(BGM_SECONDS, 2);
  expect(requests).toHaveLength(1);
  expect(bgm[0]!.offset).toBe(0);
  expect(p.loopStart).toBe(0);
  expect(p.loopEnd).toBe(0);
  const fadeIn = p.ramps.at(-1)!;
  expect(fadeIn.value).toBeCloseTo(BGM_GAIN, 5);
  expect(fadeIn.dt).toBeGreaterThan(1.8);
  expect(fadeIn.dt).toBeLessThanOrEqual(2.01);
  // 渐入途中：已经大于 0，但还没到目标；不会一开始就是目标音量。
  await expect.poll(async () => (await probe(page)).gain ?? 0).toBeGreaterThan(0.005);
  const mid = (await probe(page)).gain!;
  expect(mid).toBeLessThan(BGM_GAIN - 0.01);
  await expect.poll(async () => (await probe(page)).gain ?? 0, { timeout: 5000 }).toBeGreaterThan(BGM_GAIN - 0.001);

  await soundSwitch(page).click();
  await expect(soundSwitch(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'off');
  const fadeOut = (await lastRamp(page))!;
  expect(fadeOut.value).toBe(0);
  expect(fadeOut.dt).toBeGreaterThan(0.4);
  expect(fadeOut.dt).toBeLessThanOrEqual(0.51);
  p = await probe(page);
  expect(p.bgmStops).toBe(1);
  await expect.poll(async () => (await probe(page)).gain ?? 1, { timeout: 3000 }).toBeLessThan(0.001);
  await expect.poll(async () => (await probe(page)).state, { timeout: 3000 }).toBe('suspended');
  expect((await probe(page)).soundKey).toEqual([]);
  expect(errors).toEqual([]);
});

test('音效：开着时新幽灵入住有一声；关着时没有；音效不循环', async ({ page }) => {
  await ready(page);
  await soundSwitch(page).click();
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'playing');
  // 音效与背景音乐一起开始加载，等它们解码完。
  await page.waitForTimeout(800);
  await create(page, 'Tidy the desk');
  await expect.poll(async () => (await probe(page)).starts.filter((s) => !s.loop).length).toBe(1);
  const sfx = (await probe(page)).starts.find((s) => !s.loop)!;
  expect(sfx.duration).toBeGreaterThan(0.9);
  expect(sfx.duration).toBeLessThan(1.1); // move-in 约 1 秒
  await soundSwitch(page).click();
  await create(page, 'Call the dentist');
  await page.waitForTimeout(300);
  expect((await probe(page)).starts.filter((s) => !s.loop)).toHaveLength(1);
});

test('浏览器里留着旧的 ub:sound=on：加载后开关是关、完全安静；只有点小喇叭才渐入；刷新与新标签页又是关；从不碰 ub:sound', async ({ page }) => {
  const requests = embeddedAudioRequests(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      const w = window as unknown as { __seeding?: boolean };
      w.__seeding = true;
      localStorage.setItem('ub:sound', 'on');
      w.__seeding = false;
      sessionStorage.setItem('seeded', '1');
    }
  });
  await ready(page);
  await page.waitForTimeout(800);
  await expect(soundSwitch(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'off');
  let p = await probe(page);
  expect(p.contexts).toBe(0);
  expect(p.starts).toEqual([]);
  expect(requests).toEqual([]);
  // 普通交互与前后台切换都不会打开声音。
  await page.locator('h1').click();
  await setHidden(page, true);
  await setHidden(page, false);
  await page.waitForTimeout(300);
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'off');
  expect((await probe(page)).contexts).toBe(0);
  expect(requests).toEqual([]);
  // 第一下点小喇叭：立即起播，从 0 起约 2 秒渐入。
  await soundSwitch(page).click();
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'playing');
  await expect(soundSwitch(page)).toHaveAttribute('aria-pressed', 'true');
  p = await probe(page);
  expect(p.contexts).toBe(1);
  expect(p.state).toBe('running');
  expect(p.starts.filter((s) => s.loop)).toHaveLength(1);
  const fadeIn = p.ramps.at(-1)!;
  expect(fadeIn.value).toBeCloseTo(BGM_GAIN, 5);
  expect(fadeIn.dt).toBeGreaterThan(1.8);
  expect(fadeIn.dt).toBeLessThanOrEqual(2.01);
  await expect.poll(async () => (await probe(page)).gain ?? 0).toBeGreaterThan(0.005);
  expect(p.soundKey).toEqual([]);
  // 开着刷新：回到关，不自动出声。
  await page.reload();
  await page.waitForTimeout(800);
  await expect(soundSwitch(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'off');
  p = await probe(page);
  expect(p.contexts).toBe(0);
  expect(p.soundKey).toEqual([]);
  // 新开一个标签页：同样是关。
  const tab = await page.context().newPage();
  await instrument(tab);
  await ready(tab);
  await expect(soundSwitch(tab)).toHaveAttribute('aria-pressed', 'false');
  await expect(soundSwitch(tab)).toHaveAttribute('data-sound-state', 'off');
  expect((await probe(tab)).contexts).toBe(0);
  expect((await probe(tab)).soundKey).toEqual([]);
  await tab.close();
  // 旧值原样留着：不读、不改、不删。
  const left = await page.evaluate(() => {
    (window as unknown as { __seeding?: boolean }).__seeding = true;
    return localStorage.getItem('ub:sound');
  });
  expect(left).toBe('on');
});

test('开局被记成后台（预加载的新标签页）、激活时没有 visibilitychange：第一下点喇叭也直接起播', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __hidden: boolean };
    w.__hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => w.__hidden });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (w.__hidden ? 'hidden' : 'visible') });
  });
  await ready(page);
  // 悄悄变回可见，不发任何事件：模拟激活时没有可靠的 visibilitychange。
  await page.evaluate(() => void ((window as unknown as { __hidden: boolean }).__hidden = false));
  await soundSwitch(page).click();
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'playing');
  const p = await probe(page);
  expect(p.state).toBe('running');
  expect(p.ramps.at(-1)!.value).toBeCloseTo(BGM_GAIN, 5);
});

test('键盘：开关可聚焦，Enter 打开，Space 关闭', async ({ page }) => {
  await ready(page);
  await soundSwitch(page).focus();
  await page.keyboard.press('Enter');
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'playing');
  await page.keyboard.press('Space');
  await expect(soundSwitch(page)).toHaveAttribute('aria-pressed', 'false');
});

test('切到后台暂停，回到前台约 2 秒渐入恢复，同一个声源继续', async ({ page }) => {
  await ready(page);
  await soundSwitch(page).click();
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'playing');
  await setHidden(page, true);
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'paused');
  await expect(soundSwitch(page)).toHaveAttribute('aria-pressed', 'true');
  expect((await lastRamp(page))!.value).toBe(0);
  await expect.poll(async () => (await probe(page)).state, { timeout: 3000 }).toBe('suspended');
  await setHidden(page, false);
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'playing');
  const p = await probe(page);
  expect(p.state).toBe('running');
  expect(p.ramps.at(-1)!.value).toBeCloseTo(BGM_GAIN, 5);
  expect(p.ramps.at(-1)!.dt).toBeGreaterThan(1.8);
  expect(p.starts.filter((s) => s.loop)).toHaveLength(1);
  expect(p.soundKey).toEqual([]);
});

test('内嵌音频模块加载失败（404）：静默回到关，不弹错误、不重试，游戏照常可用', async ({ page }) => {
  const errors = pageErrors(page);
  const requests = embeddedAudioRequests(page);
  await page.route(/\/assets\/embeddedAudio-[^/]+\.js(?:\?|$)/, (route) => route.fulfill({ status: 404, body: '' }));
  await ready(page);
  await soundSwitch(page).click();
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'off');
  await expect(soundSwitch(page)).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(1500);
  // 整个内嵌模块只请求一次；失败后不重试。
  expect(requests).toHaveLength(1);
  expect((await probe(page)).starts).toEqual([]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // 游戏照常：创建、打开详情。
  await create(page, 'Water the plants');
  await expect(ghosts(page)).toHaveCount(1);
  await ghosts(page).first().dispatchEvent('click');
  await expect(ghosts(page).first()).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
  // 开关不记住：既不写 on，失败也不写任何东西。下次打开页面仍是关。
  expect((await probe(page)).soundKey).toEqual([]);
});

test('恢复界面里开关同样可用，但不写任何键', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('ub:save', '{not json');
      sessionStorage.setItem('seeded', '1');
    }
  });
  await ready(page);
  await expect(page.getByRole('button', { name: t('recovery.copy.button') })).toBeVisible();
  await soundSwitch(page).click();
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'playing');
  await soundSwitch(page).click();
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'off');
  expect((await probe(page)).soundKey).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['ub:save']);
});

test('示例里开关同样可用；进出示例不打断背景音乐', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: t('demo.try'), exact: true }).click();
  await soundSwitch(page).click();
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'playing');
  await page.getByRole('button', { name: t('demo.exit'), exact: true }).click();
  // 声音是页面级的：进出示例不打断。
  await expect(soundSwitch(page)).toHaveAttribute('data-sound-state', 'playing');
  expect((await probe(page)).starts.filter((s) => s.loop)).toHaveLength(1);
});
