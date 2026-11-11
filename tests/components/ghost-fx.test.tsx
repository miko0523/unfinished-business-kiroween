// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/preact';
import { CHORE_MS } from '../../src/animation/choreography';
import { GhostButton } from '../../src/components/GhostButton';
import { useGhostPlays, type GhostPlay } from '../../src/components/useGhostPlays';
import type { Task } from '../../src/domain/types';
import type { Store } from '../../src/store/store';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Listener = (e: readonly unknown[]) => void;

function setup() {
  let listener: Listener | null = null;
  const store = { subscribeEvents: (fn: Listener) => ((listener = fn), () => {}) } as unknown as Store;
  const readies: ((ok: boolean) => void)[] = [];
  const hook = renderHook(() => useGhostPlays(store, (_i, _m, r) => void readies.push(r)));
  return { hook, emit: (...e: unknown[]) => act(() => listener!(e)), readies };
}

const play = (hook: ReturnType<typeof setup>['hook'], id = 'x'): GhostPlay | undefined => hook.result.current.get(id);

describe('小星星的时机', () => {
  beforeEach(() => vi.useFakeTimers());

  it('入住落地之后才冒几颗；平时不撒粒子', () => {
    const { hook, emit } = setup();
    expect(play(hook)).toBeUndefined();
    emit({ type: 'GhostMovedIn', taskId: 'x' });
    act(() => void vi.advanceTimersByTime(1000));
    expect(play(hook)?.burst ?? null).toBeNull();
    act(() => void vi.advanceTimersByTime(200));
    expect(play(hook)?.burst?.kind).toBe('few');
  });

  it('变白冒几颗星', () => {
    const { hook, emit } = setup();
    emit({ type: 'ClarifiedTransition', taskId: 'x' });
    act(() => void vi.advanceTimersByTime(500));
    expect(play(hook)?.burst?.kind).toBe('few');
  });

  it('淡出后清理星星，旧一轮的清理不会移除新一轮', () => {
    const { hook, emit, readies } = setup();
    emit({ type: 'GhostMovedIn', taskId: 'x' });
    act(() => void vi.advanceTimersByTime(3200));
    expect(play(hook)?.burst).toBeNull();
    emit({ type: 'StepChecked', taskId: 'x', chore: 'water' }, { type: 'StateChanged', taskId: 'x', from: 'white', to: 'green' });
    act(() => readies[0]!(true));
    act(() => void vi.advanceTimersByTime(3500));
    expect(play(hook)?.burst?.kind).toBe('few');
    act(() => void vi.advanceTimersByTime(1300));
    expect(play(hook)?.burst).toBeNull();
  });

  it('变绿：家务开始后等它演完，再接一轮星星', () => {
    const { hook, emit, readies } = setup();
    emit({ type: 'StepChecked', taskId: 'x', chore: 'water' }, { type: 'StateChanged', taskId: 'x', from: 'white', to: 'green' });
    act(() => readies[0]!(true));
    expect(play(hook)?.kind).toBe('water');
    expect(play(hook)?.expression).toBe('focused');
    act(() => void vi.advanceTimersByTime(1500));
    expect(play(hook)?.expression).toBe('happy');
    expect(play(hook)?.burst?.kind).toBe('chore');
    act(() => void vi.advanceTimersByTime(CHORE_MS - 1500));
    expect(play(hook)?.kind).toBeNull();
    expect(play(hook)?.burst?.kind).toBe('chore'); // 动作收尾后星星还在淡出
    act(() => void vi.advanceTimersByTime(800));
    expect(play(hook)?.burst?.kind).toBe('few');
  });

  it('新事件取消旧动作：橡皮擦接管后，迟到的家务星星与变绿星星都不再出现', () => {
    const { hook, emit, readies } = setup();
    emit({ type: 'StepChecked', taskId: 'x', chore: 'sweep' }, { type: 'StateChanged', taskId: 'x', from: 'white', to: 'green' });
    act(() => readies[0]!(true));
    act(() => void vi.advanceTimersByTime(600));
    emit({ type: 'EraserScribble', taskId: 'x' });
    expect(play(hook)?.kind).toBe('erase');
    expect(play(hook)?.burst).toBeNull();
    act(() => void vi.advanceTimersByTime(3500));
    expect(play(hook)?.burst ?? null).toBeNull();
    expect(play(hook)?.kind).toBeNull();
  });

  it('入住的星星还没冒，新的勾选来了：旧的星星作废', () => {
    const { hook, emit, readies } = setup();
    emit({ type: 'GhostMovedIn', taskId: 'x' });
    act(() => void vi.advanceTimersByTime(500));
    emit({ type: 'StepChecked', taskId: 'x', chore: 'window' });
    act(() => readies[0]!(true));
    act(() => void vi.advanceTimersByTime(700)); // 到入住星星原定的 1100ms
    expect(play(hook)?.burst ?? null).toBeNull(); // 家务的星星要到 1400ms 才冒
  });

  it('页面隐藏：进行中的动作与星星立刻收口，也不再冒新的', () => {
    const { hook, emit, readies } = setup();
    emit({ type: 'StepChecked', taskId: 'x', chore: 'sweep' });
    act(() => readies[0]!(true));
    act(() => void vi.advanceTimersByTime(1500));
    expect(play(hook)?.burst?.kind).toBe('chore');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(play(hook)?.kind).toBeNull();
    expect(play(hook)?.burst).toBeNull();
    act(() => void vi.advanceTimersByTime(5000));
    expect(play(hook)?.burst).toBeNull();
    emit({ type: 'ClarifiedTransition', taskId: 'x' });
    expect(play(hook)?.kind).toBeNull(); // 隐藏时来的事件不起新动画
  });

  it('减少动态：不冒星星，表情照常切换', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {}, media: q }));
    const { hook, emit, readies } = setup();
    emit({ type: 'GhostMovedIn', taskId: 'x' });
    emit({ type: 'StepChecked', taskId: 'x', chore: 'sweep' });
    act(() => readies[0]!(true));
    act(() => void vi.advanceTimersByTime(1500));
    expect(play(hook)?.expression).toBe('happy');
    expect(play(hook)?.burst ?? null).toBeNull();
  });
});

describe('GhostButton 的特效', () => {
  const task = {
    id: 't', title: 'x', criteria: 'done', steps: [{ id: 's', title: 's', done: true }], slot: { floor: 2, slot: 0 },
  } as unknown as Task;
  const base = { task, selected: false, entering: false, onSelect() {}, onEntered() {} };
  const mk = (over: Partial<GhostPlay>): GhostPlay => ({ kind: null, n: 1, choreTotal: 1, expression: 'focused', prop: 'none', burst: null, ...over });

  it('扫地：扫把和灰在身体外侧一层，不在身体分组里', () => {
    const { container } = render(<GhostButton {...base} play={mk({ kind: 'sweep', prop: 'broom' })} />);
    expect(container.querySelector('.ghost-prop rect')).not.toBeNull();
    expect(container.querySelectorAll('.fx-sweep .fx-dust').length).toBe(6);
    expect(container.querySelector('.ghost-figure .ghost-prop')).toBeNull();
    expect(container.querySelector('.ghost-figure .fx-scene')).toBeNull();
    expect(container.querySelector('.ghost-sprite')!.getAttribute('data-tool')).toBe('true');
  });

  it('浇花三滴水加花盆小芽；擦窗两个圈加亮光；橡皮擦有灰屑', () => {
    const w = render(<GhostButton {...base} play={mk({ kind: 'water', prop: 'can' })} />);
    expect(w.container.querySelectorAll('.fx-drop').length).toBe(3);
    expect(w.container.querySelector('.fx-pot')).not.toBeNull();
    expect(w.container.querySelector('.fx-sprout')).not.toBeNull();
    w.unmount();
    const win = render(<GhostButton {...base} play={mk({ kind: 'window', prop: 'cloth' })} />);
    expect(win.container.querySelectorAll('.fx-ring').length).toBe(2);
    expect(win.container.querySelector('.fx-glint')).not.toBeNull();
    win.unmount();
    const er = render(<GhostButton {...base} play={mk({ kind: 'erase', prop: 'eraser' })} />);
    expect(er.container.querySelectorAll('.fx-crumb').length).toBeGreaterThanOrEqual(3);
    expect(er.container.textContent).not.toMatch(/backward|regress|退步/i);
  });

  it('星星是对读屏隐藏的装饰，不进可访问名称', () => {
    const { container } = render(<GhostButton {...base} play={mk({ burst: { kind: 'few', n: 1 } })} />);
    expect(container.querySelectorAll('.fx-star').length).toBe(4);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('button')!.getAttribute('aria-label')).not.toMatch(/star/i);
  });

  it('平时没有特效、没有道具', () => {
    const { container } = render(<GhostButton {...base} />);
    expect(container.querySelector('.fx-scene, .fx-burst')).toBeNull();
    expect(container.querySelector('.ghost-prop')!.childElementCount).toBe(0);
    expect(container.querySelector('.ghost-sprite')!.getAttribute('data-tool')).toBeNull();
  });

  it('漫游朝向写在按钮上，供样式挪脸、前倾、飘裙边', () => {
    const { container } = render(<GhostButton {...base} walk={1} />);
    expect(container.querySelector('button')!.getAttribute('data-walk')).toBe('1');
  });

  it('减少动态：无道具、无特效、无星星、不漫游，只剩静态表情', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {}, media: q }));
    const { container } = render(<GhostButton {...base} walk={1} pose="greet" play={mk({ kind: 'sweep', prop: 'broom', burst: { kind: 'few', n: 1 } })} />);
    expect(container.querySelector('.ghost-prop')!.childElementCount).toBe(0);
    expect(container.querySelector('.fx-scene, .fx-burst, .fx-star')).toBeNull();
    expect(container.querySelector('button')!.getAttribute('data-walk')).toBe('0');
    expect(container.querySelector('.ghost-eyes')!.getAttribute('data-expression')).toBe('focused');
    expect(container.querySelector('.ghost-hand-right')!.getAttribute('transform')).toContain('rotate(0');
  });
});
