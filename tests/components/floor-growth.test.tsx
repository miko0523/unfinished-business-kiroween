// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/preact';
import { App } from '../../src/components/App';
import { createStore } from '../../src/store/store';
import { createUiStore } from '../../src/store/uiStore';
import { createMemoryPort } from '../../src/store/storagePort';
import { browserEnv } from '../../src/store/env';
import { FLOOR_GROWTH_MS } from '../../src/animation/floorGrowth';
import type { AppContext } from '../../src/store/StoreContext';

interface Fake {
  el: Element;
  module: string | null;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  cancelled: boolean;
}
let fakes: Fake[] = [];

function makeContext(): AppContext {
  return { store: createStore({ env: browserEnv(), port: createMemoryPort() }), ui: createUiStore(), roam: { positionOf: () => null } };
}
const modules = () => [...document.querySelectorAll('.static-layer [data-module]')].map((e) => e.getAttribute('data-module'));
const stars = () => document.querySelectorAll('.grow-sparkle');
const create = (ctx: AppContext, n: number) => act(() => void ctx.store.dispatch({ type: 'CreateTask', title: `Task ${n}` }));
// 这里只核长楼动画；幽灵漫游会在 1.5 秒后独立启动，不能算成长楼的残留。
const live = () => fakes.filter((f) => !f.cancelled && (f.module !== null || f.el.classList.contains('grow-sparkle')));
const byModule = (id: string) => fakes.filter((f) => f.module === id);

function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
}
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

beforeEach(() => {
  vi.useFakeTimers();
  fakes = [];
  reducedMotion(false);
  setHidden(false);
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    const fake: Fake = { el: this, module: this.getAttribute('data-module'), keyframes, options, cancelled: false };
    fakes.push(fake);
    return { cancel: () => void (fake.cancelled = true), finished: Promise.resolve() };
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (document as unknown as { hidden?: boolean }).hidden;
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
});

describe('FloorGrown 长楼动画', () => {
  it('第 3 只：屋顶位移 + 新层 reveal + 少量星星各一次；≤1s 后全部清理，接缝为最终布局', () => {
    const ctx = makeContext();
    render(<App context={ctx} />);
    create(ctx, 1);
    create(ctx, 2);
    expect(fakes).toHaveLength(0); // 前两只不长楼
    create(ctx, 3);

    const roof = byModule('roof');
    expect(roof).toHaveLength(1);
    const lift = String(roof[0]!.keyframes[0]!.transform);
    expect(lift).toMatch(/translate\(-?[\d.]+%, [\d.]+%\)/);
    expect(roof[0]!.keyframes[1]!.transform).toBe('translate(0%, 0%)');
    expect(roof[0]!.options.duration).toBeLessThanOrEqual(1000);

    const floor = byModule('floor-02');
    expect(floor).toHaveLength(1);
    expect(floor[0]!.keyframes[0]).toMatchObject({ opacity: 0, clipPath: 'inset(100% 0 0 0)' });
    expect(floor[0]!.keyframes[1]).toMatchObject({ opacity: 1, clipPath: 'inset(0% 0 0 0)' });
    expect(byModule('floor-01')).toHaveLength(0);
    expect(byModule('lobby')).toHaveLength(0);

    const sparkles = fakes.filter((f) => f.el.classList.contains('grow-sparkle'));
    expect(sparkles.length).toBeGreaterThanOrEqual(3);
    expect(sparkles.length).toBeLessThanOrEqual(5);
    expect(stars()).toHaveLength(sparkles.length);
    const host = document.querySelector('.grow-sparkles')!;
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.textContent).toBe('');
    expect(host.querySelectorAll('button, a, [tabindex], [role]')).toHaveLength(0);
    for (const s of sparkles) {
      expect(Number(s.options.delay ?? 0) + Number(s.options.duration)).toBeLessThanOrEqual(FLOOR_GROWTH_MS);
      expect(s.keyframes.map((k) => k.opacity)).toEqual([0, 1, 0]); // 淡入淡出，不闪烁
    }
    expect(document.querySelector('.house')!.getAttribute('data-growing')).toBe('true');

    act(() => void vi.advanceTimersByTime(FLOOR_GROWTH_MS));
    expect(stars()).toHaveLength(0);
    expect(document.querySelector('.grow-sparkles')).toBeNull();
    expect(document.querySelector('.house')!.hasAttribute('data-growing')).toBe(false);
    expect(live()).toHaveLength(0);
    expect(modules()).toEqual(['lobby', 'floor-01', 'floor-02', 'roof']);
    // 没有残留的内联样式或临时 class
    for (const el of document.querySelectorAll('.static-layer [data-module]')) {
      expect(el.getAttribute('class')).toBe(el.tagName === 'IMG' ? 'static-module' : 'static-plate');
      expect(el.getAttribute('style') ?? '').not.toMatch(/transform|clip-path|opacity/);
    }
    expect(FLOOR_GROWTH_MS).toBeLessThanOrEqual(1000);
  });

  it('第 5 只再播一次，揭开的是新的一层而不是旧层', () => {
    const ctx = makeContext();
    render(<App context={ctx} />);
    for (let n = 1; n <= 3; n++) create(ctx, n);
    act(() => void vi.advanceTimersByTime(FLOOR_GROWTH_MS));
    fakes = [];
    create(ctx, 4);
    expect(fakes).toHaveLength(0);
    create(ctx, 5);
    expect(byModule('floor-03')).toHaveLength(1);
    expect(byModule('floor-02')).toHaveLength(0);
    expect(byModule('roof')).toHaveLength(1);
    expect(stars().length).toBeGreaterThan(0);
    act(() => void vi.advanceTimersByTime(FLOOR_GROWTH_MS));
    expect(stars()).toHaveLength(0);
    expect(modules()).toEqual(['lobby', 'floor-01', 'floor-02', 'floor-03', 'roof']);
  });

  it('刷新加载已有三层：不补播', () => {
    const ctx = makeContext();
    for (let n = 1; n <= 3; n++) ctx.store.dispatch({ type: 'CreateTask', title: `Task ${n}` });
    render(<App context={ctx} />);
    expect(modules()).toEqual(['lobby', 'floor-01', 'floor-02', 'roof']);
    expect(fakes).toHaveLength(0);
    expect(stars()).toHaveLength(0);
    expect(document.querySelector('.house')!.hasAttribute('data-growing')).toBe(false);
  });

  it('Reduced Motion：直接最终布局，不动画、无粒子', () => {
    reducedMotion(true);
    const ctx = makeContext();
    render(<App context={ctx} />);
    for (let n = 1; n <= 3; n++) create(ctx, n);
    expect(modules()).toEqual(['lobby', 'floor-01', 'floor-02', 'roof']);
    expect(fakes).toHaveLength(0);
    expect(stars()).toHaveLength(0);
    expect(document.querySelector('.house')!.hasAttribute('data-growing')).toBe(false);
  });

  it('页面隐藏：直接最终布局，不动画、无粒子', () => {
    setHidden(true);
    const ctx = makeContext();
    render(<App context={ctx} />);
    for (let n = 1; n <= 3; n++) create(ctx, n);
    expect(modules()).toHaveLength(4);
    expect(fakes).toHaveLength(0);
    expect(stars()).toHaveLength(0);
  });

  it('播放中页面被隐藏：立刻取消并清掉粒子', () => {
    const ctx = makeContext();
    render(<App context={ctx} />);
    for (let n = 1; n <= 3; n++) create(ctx, n);
    expect(stars().length).toBeGreaterThan(0);
    setHidden(true);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(stars()).toHaveLength(0);
    expect(live()).toHaveLength(0);
  });

  it('播放中组件卸载：动画全部取消，计时器不残留', () => {
    const ctx = makeContext();
    const { unmount } = render(<App context={ctx} />);
    for (let n = 1; n <= 3; n++) create(ctx, n);
    expect(live().length).toBeGreaterThan(0);
    unmount();
    expect(live()).toHaveLength(0);
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
  });

  it('快速连续增长（第 3、5 只相隔 <1s）：旧动画被收口，只留新的一组，结束后无残留', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // 固定最早的漫游启动时间，覆盖与长楼清理并行的情况。
    const ctx = makeContext();
    render(<App context={ctx} />);
    for (let n = 1; n <= 3; n++) create(ctx, n);
    const firstRun = fakes.length;
    const firstStars = stars().length;
    act(() => void vi.advanceTimersByTime(300));
    create(ctx, 4);
    create(ctx, 5);
    // 第一轮全部被取消；第二轮的星星只有一组
    expect(fakes.slice(0, firstRun).every((f) => f.cancelled)).toBe(true);
    expect(stars()).toHaveLength(firstStars);
    expect(byModule('floor-03')).toHaveLength(1);
    expect(live().filter((f) => f.module === 'floor-02')).toHaveLength(0);
    // 新一轮的总时长从事件起算：旧计时器（再过 600ms）不会提前掐断它
    act(() => void vi.advanceTimersByTime(700));
    expect(stars().length).toBeGreaterThan(0);
    act(() => void vi.advanceTimersByTime(FLOOR_GROWTH_MS));
    expect(stars()).toHaveLength(0);
    // 此时漫游已经启动，仍可运行；它不属于本用例要清理的长楼动画。
    expect(fakes.some((f) => !f.cancelled && f.el.classList.contains('resident'))).toBe(true);
    expect(live()).toHaveLength(0);
    expect(modules()).toEqual(['lobby', 'floor-01', 'floor-02', 'floor-03', 'roof']);
  });
});
