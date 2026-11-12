// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { App } from '../../src/components/App';
import { isActivationGesture } from '../../src/components/useSound';
import { createSoundController } from '../../src/sound/controller';
import type { CueName } from '../../src/sound/cues';
import type { SoundEngine } from '../../src/sound/engine';
import { createStore } from '../../src/store/store';
import { createUiStore } from '../../src/store/uiStore';
import { createMemoryPort } from '../../src/store/storagePort';
import { browserEnv } from '../../src/store/env';
import { en } from '../../src/i18n/en';
import { zhCN } from '../../src/i18n/zh-CN';
import type { AppContext } from '../../src/store/StoreContext';

/** 记录调用的假引擎：起播立刻成功，音效只记名字与延迟。 */
function fakeEngine() {
  const cues: [CueName, number][] = [];
  const calls: string[] = [];
  const engine: SoundEngine = {
    start: () => (calls.push('start'), Promise.resolve('started')),
    resume: () => (calls.push('resume'), Promise.resolve('started')),
    stop: () => void calls.push('stop'),
    pause: () => void calls.push('pause'),
    cue: (name, delayMs = 0) => (cues.push([name, delayMs]), { cancel: () => false }),
  };
  return { engine, cues, calls };
}

function makeContext(): AppContext {
  return { store: createStore({ env: browserEnv(), port: createMemoryPort() }), ui: createUiStore(), roam: { positionOf: () => null } };
}

const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));
const switchButton = () => screen.getByRole('button', { name: en['sound.label'] });
const type = (label: RegExp, value: string, scope: HTMLElement = document.body) => fireEvent.input(within(scope).getByLabelText(label), { target: { value } });
const click = (name: RegExp | string, scope: HTMLElement = document.body) => fireEvent.click(within(scope).getByRole('button', { name }));
const card = () => screen.getByRole('complementary', { name: /details/i });

beforeEach(() => {
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('声音开关', () => {
  it('右上角一个按钮：默认关（aria-pressed=false），英文名称；按下后开、再按关；不写任何存储', async () => {
    localStorage.clear();
    const { engine, calls } = fakeEngine();
    render(<App context={makeContext()} sound={createSoundController({ engine })} />);
    const header = document.querySelector('header')!;
    expect(within(header).getByRole('button', { name: en['sound.label'] })).toBe(switchButton());
    // 在语言切换之后：同一行的最右边。
    const buttons = [...header.querySelectorAll('button')];
    expect(buttons.at(-1)).toBe(switchButton());
    expect(switchButton().getAttribute('aria-pressed')).toBe('false');
    expect(switchButton().getAttribute('type')).toBe('button');
    fireEvent.click(switchButton());
    await settle();
    expect(switchButton().getAttribute('aria-pressed')).toBe('true');
    expect(switchButton().dataset.soundState).toBe('playing');
    fireEvent.click(switchButton());
    expect(switchButton().getAttribute('aria-pressed')).toBe('false');
    expect(calls).toEqual(['start', 'stop']);
    expect(localStorage.length).toBe(0);
  });

  it('中文名称来自文案资源', async () => {
    render(<App context={makeContext()} sound={createSoundController({ engine: fakeEngine().engine })} />);
    fireEvent.click(screen.getByRole('button', { name: '简体中文' }));
    expect(screen.getByRole('button', { name: zhCN['sound.label'] }).getAttribute('aria-pressed')).toBe('false');
  });

  it('浏览器里留着旧的 ub:sound=on：开关仍显示关，不起播；旧值不读、不改、不删', () => {
    localStorage.clear();
    localStorage.setItem('ub:sound', 'on');
    const { engine, calls } = fakeEngine();
    render(<App context={makeContext()} sound={createSoundController({ engine })} />);
    expect(switchButton().getAttribute('aria-pressed')).toBe('false');
    expect(switchButton().dataset.soundState).toBe('off');
    expect(calls).toEqual([]);
    expect(localStorage.getItem('ub:sound')).toBe('on');
    localStorage.clear();
  });

  it('示例里开关同样在', () => {
    render(<App context={makeContext()} sound={createSoundController({ engine: fakeEngine().engine })} />);
    click(en['demo.try']);
    expect(switchButton()).toBeTruthy();
  });

  it('手势认定：只认真实的鼠标按下、触控抬起、触摸结束与非修饰键；开关自身不算', () => {
    const ev = (type: string, extra: Record<string, unknown> = {}, target: Element | null = document.body) => ({ type, isTrusted: true, target, ...extra }) as unknown as Event;
    expect(isActivationGesture(ev('pointerdown', { pointerType: 'mouse' }))).toBe(true);
    expect(isActivationGesture(ev('pointerdown', { pointerType: 'touch' }))).toBe(false);
    expect(isActivationGesture(ev('pointerup', { pointerType: 'touch' }))).toBe(true);
    expect(isActivationGesture(ev('pointerup', { pointerType: 'mouse' }))).toBe(false);
    expect(isActivationGesture(ev('touchend'))).toBe(true);
    expect(isActivationGesture(ev('keydown', { key: 'a' }))).toBe(true);
    expect(isActivationGesture(ev('keydown', { key: 'Tab' }))).toBe(true);
    for (const key of ['Escape', 'Shift', 'Control', 'Alt', 'Meta']) expect(isActivationGesture(ev('keydown', { key }))).toBe(false);
    expect(isActivationGesture(ev('keydown', { key: 'a', repeat: true }))).toBe(false);
    expect(isActivationGesture({ ...ev('pointerdown', { pointerType: 'mouse' }), isTrusted: false } as Event)).toBe(false);
    const sw = document.createElement('button');
    sw.setAttribute('data-sound-switch', '');
    const icon = document.createElement('span');
    sw.append(icon);
    expect(isActivationGesture(ev('pointerdown', { pointerType: 'mouse' }, icon))).toBe(false);
    expect(isActivationGesture(ev('scroll'))).toBe(false);
  });
});

describe('音效接线', () => {
  async function playing() {
    const fake = fakeEngine();
    const ctx = makeContext();
    render(<App context={ctx} sound={createSoundController({ engine: fake.engine })} />);
    fireEvent.click(switchButton());
    await settle();
    expect(switchButton().dataset.soundState).toBe('playing');
    return { ...fake, ctx };
  }

  it('入住一声噗；勾选第 1/2/3 步依次扫地、浇水、擦窗；取消勾选没有声音', async () => {
    const { cues } = await playing();
    type(/still waiting/i, 'Tidy the desk');
    click(/welcome a little ghost/i);
    expect(cues).toEqual([['move-in', 0]]);
    fireEvent.click(document.querySelector<HTMLElement>('[data-ghost]')!);
    type(/what does/i, 'Clear', card());
    click(/^save$/i, card());
    for (const s of ['one', 'two', 'three', 'four']) {
      type(/add a small step/i, s, card());
      click(/add step/i, card());
    }
    expect(cues).toHaveLength(1);
    const boxes = () => within(card()).getAllByRole('checkbox');
    fireEvent.click(boxes()[0]!);
    fireEvent.click(boxes()[0]!); // 取消勾选：橡皮擦，不配音
    fireEvent.click(boxes()[0]!);
    fireEvent.click(boxes()[1]!);
    fireEvent.click(boxes()[2]!);
    fireEvent.click(boxes()[3]!);
    expect(cues.map((c) => c[0])).toEqual(['move-in', 'sweep', 'sweep', 'water', 'wipe', 'sweep']);
  });

  it('非法输入与普通按钮不配音', async () => {
    const { cues } = await playing();
    type(/still waiting/i, '   ');
    click(/welcome a little ghost/i);
    type(/still waiting/i, 'x'.repeat(81));
    click(/welcome a little ghost/i);
    click(en['keep.button']);
    expect(cues).toEqual([]);
  });

  it('确认送别：盖章在前、灯亮在后，对准告别动画', async () => {
    const { cues } = await playing();
    type(/still waiting/i, 'Tidy the desk');
    click(/welcome a little ghost/i);
    fireEvent.click(document.querySelector<HTMLElement>('[data-ghost]')!);
    type(/what does/i, 'Clear', card());
    click(/^save$/i, card());
    type(/add a small step/i, 'one', card());
    click(/add step/i, card());
    fireEvent.click(within(card()).getByRole('checkbox'));
    click(en['confirm.button'], card());
    click(en['confirm.yes'], screen.getByRole('dialog'));
    const farewell = cues.filter((c) => c[0] === 'stamp' || c[0] === 'lamp');
    expect(farewell.map((c) => c[0])).toEqual(['stamp', 'lamp']);
    expect(farewell[0]![1]).toBeLessThan(farewell[1]![1]);
  });

  it('关着的时候成功事件也不出声', () => {
    const fake = fakeEngine();
    render(<App context={makeContext()} sound={createSoundController({ engine: fake.engine })} />);
    type(/still waiting/i, 'Tidy the desk');
    click(/welcome a little ghost/i);
    expect(fake.cues).toEqual([]);
  });
});
